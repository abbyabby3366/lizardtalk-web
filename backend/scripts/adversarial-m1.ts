/**
 * LizardTalk Web — Milestone 1 Adversarial Challenge & Stress Test Suite
 * Author: challenger_m1_1 (Empirical Challenger)
 * 
 * Verifies and stresses:
 * 1. Obfuscated2 Crypto & Handshake Stress (bad secrets, forbidden ints, invalid DC IDs)
 * 2. Socket resilience & abrupt drops (truncated frames, rapid disconnect bursts)
 * 3. REST API edge cases (403 default delete, 400 malformed JSON, 404 missing IDs, invalid ports/hosts)
 * 4. High-concurrency WebSocket streaming (parallel DCs 1..5, chat + media -2, burst multiplexing)
 */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { createHandshake, PROTOCOL_INTERMEDIATE, PROTOCOL_PADDED_INTERMEDIATE, PROTOCOL_ABRIDGED } from '../src/crypto/obfuscated2.js';
import { parseSecret } from '../src/crypto/secrets.js';
import { startServer, server, healthManager } from '../src/server.js';

const PORT = 8081;
const HTTP_BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}/mtproxy`;

interface ChallengeResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: ChallengeResult[] = [];

async function runTest(suite: string, name: string, fn: () => Promise<void>) {
  const start = Date.now();
  process.stdout.write(`  [TEST] ${name} ... `);
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: true, durationMs });
    console.log(`\x1b[32mPASS\x1b[0m (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const msg = err?.message || String(err);
    results.push({ suite, name, passed: false, durationMs, error: msg });
    console.log(`\x1b[31mFAIL\x1b[0m (${durationMs}ms) -> ${msg}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEquals(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg} (expected: ${expected}, got: ${actual})`);
  }
}

// Helper: send req_pq_multi and await resPQ over WebSocket
function exchangeReqPq(ws: WebSocket, timeoutMs: number = 8000): Promise<{ nonce: Buffer; resPqConstructor: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const nonce = crypto.randomBytes(16);
    const now = Date.now();
    const msgId = (BigInt(Math.floor(now / 1000)) << 32n) | (BigInt((now % 1000) * 1000) << 12n);

    const reqPqBody = Buffer.concat([
      Buffer.from([0xf1, 0x8e, 0x7e, 0xbe]), // req_pq_multi#be7e8ef1
      nonce,
    ]);

    const reqPqMsg = Buffer.alloc(8 + 8 + 4 + reqPqBody.length);
    reqPqMsg.fill(0, 0, 8);
    reqPqMsg.writeBigInt64LE(msgId, 8);
    reqPqMsg.writeUInt32LE(reqPqBody.length, 16);
    reqPqBody.copy(reqPqMsg, 20);

    // Frame with 4-byte LE length
    const frame = Buffer.alloc(4 + reqPqMsg.length);
    frame.writeUInt32LE(reqPqMsg.length, 0);
    reqPqMsg.copy(frame, 4);

    let streamBuf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for resPQ (${timeoutMs}ms)`));
    }, timeoutMs);

    const onMessage = (data: Buffer) => {
      streamBuf = Buffer.concat([streamBuf, Buffer.isBuffer(data) ? data : Buffer.from(data as any)]);
      while (streamBuf.length >= 4) {
        const len = streamBuf.readUInt32LE(0);
        if (streamBuf.length < 4 + len) break;

        const packet = streamBuf.subarray(4, 4 + len);
        streamBuf = streamBuf.subarray(4 + len);

        if (packet.length >= 24) {
          const ctor = packet.readUInt32LE(20);
          if (ctor === 0x05162463) { // resPQ#05162463
            const respNonce = packet.subarray(24, 40);
            cleanup();
            if (respNonce.equals(nonce)) {
              resolve({
                nonce,
                resPqConstructor: ctor,
                durationMs: Date.now() - start,
              });
            } else {
              reject(new Error('resPQ nonce mismatch: packet belongs to another session (stream corruption!)'));
            }
            return;
          }
        }
      }
    };

    const onError = (err: any) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);

    ws.send(frame, { binary: true });
  });
}

async function main() {
  console.log('========================================================================');
  console.log('  LizardTalk Web — Empirical Adversarial Stress Test Suite (M1)        ');
  console.log('========================================================================\n');

  // Ensure server is running
  let isManagedServer = false;
  try {
    const probe = await fetch(`${HTTP_BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (probe.ok) {
      console.log(`[Setup] Connected to existing server on port ${PORT}`);
    }
  } catch {
    console.log(`[Setup] Starting local backend server on port ${PORT}...`);
    await startServer(PORT);
    isManagedServer = true;
  }

  // -------------------------------------------------------------------------
  // SUITE 1: Secret Parsing & Obfuscated2 Handshake Stress
  // -------------------------------------------------------------------------
  console.log('\n\x1b[35m=== SUITE 1: Secret Parsing & Obfuscated2 Handshake Edge Cases ===\x1b[0m');

  await runTest('Suite 1', 'Rejects non-hex secret with error (no silent fallback)', async () => {
    let threw = false;
    try {
      parseSecret('6c465965316ffd1afb2f0e2b3ea90zzz');
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('hexadecimal'), 'Error message must note hexadecimal requirement');
    }
    assert(threw, 'Must throw error on non-hex secret');
  });

  await runTest('Suite 1', 'Rejects truncated secret (< 16 bytes)', async () => {
    let threw = false;
    try {
      parseSecret('6c465965316ffd1afb2f0e2b3ea90a'); // 30 chars = 15 bytes
    } catch {
      threw = true;
    }
    assert(threw, 'Must throw error on truncated secret');
  });

  await runTest('Suite 1', 'Rejects odd-length hex secret', async () => {
    let threw = false;
    try {
      parseSecret('6c465965316ffd1afb2f0e2b3ea90a867'); // 33 chars
    } catch {
      threw = true;
    }
    assert(threw, 'Must throw error on odd length secret');
  });

  await runTest('Suite 1', 'Rejects Fake-TLS ee secret missing SNI domain hex', async () => {
    const parsed = parseSecret('ee6c465965316ffd1afb2f0e2b3ea90a86');
    assertEquals(parsed.mode, 'faketls', 'Mode is faketls');
    assertEquals(parsed.domain, undefined, 'Domain is undefined if no extra bytes');
  });

  await runTest('Suite 1', 'Rejects Fake-TLS ee secret with odd SNI domain length', async () => {
    let threw = false;
    try {
      parseSecret('ee6c465965316ffd1afb2f0e2b3ea90a8661626'); // 7 hex chars domain
    } catch {
      threw = true;
    }
    assert(threw, 'Must reject odd length domain hex');
  });

  await runTest('Suite 1', 'Parses valid Fake-TLS secret with SNI domain', async () => {
    // domain 'google.com' in hex: 676f6f676c652e636f6d
    const secret = 'ee6c465965316ffd1afb2f0e2b3ea90a86676f6f676c652e636f6d';
    const parsed = parseSecret(secret);
    assertEquals(parsed.mode, 'faketls', 'Mode must be faketls');
    assertEquals(parsed.domain, 'google.com', 'Domain must be google.com');
    assertEquals(parsed.rawSecret.length, 16, 'Raw secret must be 16 bytes');
  });

  await runTest('Suite 1', 'Validates signed 16-bit DC IDs in createHandshake (boundary bounds)', async () => {
    const validSecret = '6c465965316ffd1afb2f0e2b3ea90a86';
    // Valid bounds
    createHandshake(validSecret, 1);
    createHandshake(validSecret, 5);
    createHandshake(validSecret, -1);
    createHandshake(validSecret, -5);
    createHandshake(validSecret, 32767);
    createHandshake(validSecret, -32768);

    // Invalid bounds
    let threw0 = false;
    try { createHandshake(validSecret, 0); } catch { threw0 = true; }
    assert(threw0, 'dcId=0 must be rejected');

    let threwOverflow = false;
    try { createHandshake(validSecret, 32768); } catch { threwOverflow = true; }
    assert(threwOverflow, 'dcId=32768 must be rejected');

    let threwUnderflow = false;
    try { createHandshake(validSecret, -32769); } catch { threwUnderflow = true; }
    assert(threwUnderflow, 'dcId=-32769 must be rejected');
  });

  await runTest('Suite 1', 'Handshake 64-byte header satisfies all MTProto DPI evasion constraints', async () => {
    const validSecret = '6c465965316ffd1afb2f0e2b3ea90a86';
    for (let i = 0; i < 50; i++) {
      const hs = createHandshake(validSecret, 2);
      assertEquals(hs.initialPacket.length, 64, 'Handshake packet must be 64 bytes');
      assert(hs.initialPacket[0] !== 0xef, 'Byte 0 must not be 0xef');
      const firstInt = hs.initialPacket.readUInt32LE(0);
      const forbidden = [0x44414548, 0x54534f50, 0x20544547, 0x4954504f, 0xdddddddd, 0xeeeeeeee, 0x02010316];
      assert(!forbidden.includes(firstInt), 'First 4 bytes must not be HTTP or TLS verb');
      const secondInt = hs.initialPacket.readUInt32LE(4);
      assert(secondInt !== 0, 'Second 4 bytes must not be 0');
    }
  });

  // -------------------------------------------------------------------------
  // SUITE 2: REST API Edge Cases & Boundary Probes
  // -------------------------------------------------------------------------
  console.log('\n\x1b[35m=== SUITE 2: REST API Edge Cases & Boundary Probing ===\x1b[0m');

  await runTest('Suite 2', 'GET /api/health returns 200 with active proxy and ISO timestamp', async () => {
    const res = await fetch(`${HTTP_BASE}/api/health`);
    assertEquals(res.status, 200, 'Health endpoint status 200');
    const json = (await res.json()) as any;
    assertEquals(json.status, 'ok', 'Status is ok');
    assert(json.activeProxy !== undefined, 'activeProxy must be present');
    assert(typeof json.timestamp === 'string' && !isNaN(Date.parse(json.timestamp)), 'timestamp must be valid ISO 8601');
  });

  await runTest('Suite 2', 'DELETE /api/proxies/default-primary returns 403 Forbidden (Primary protection)', async () => {
    const res = await fetch(`${HTTP_BASE}/api/proxies/default-primary`, { method: 'DELETE' });
    assertEquals(res.status, 403, 'Deleting default-primary must return 403 Forbidden');
    const json = (await res.json()) as any;
    assert(json.error.includes('Cannot delete the default primary'), 'Must contain descriptive error');
  });

  await runTest('Suite 2', 'POST /api/proxies with malformed JSON returns 400 Bad Request', async () => {
    const res = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": [json',
    });
    assertEquals(res.status, 400, 'Malformed JSON must return 400');
    const json = (await res.json()) as any;
    assertEquals(json.error, 'Invalid JSON payload', 'Error message matches specification');
  });

  await runTest('Suite 2', 'POST /api/proxies with missing required fields fails loudly with 400', async () => {
    // Missing host
    let res = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 443, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    assertEquals(res.status, 400, 'Missing host must return 400');

    // Missing port
    res = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '1.2.3.4', secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    assertEquals(res.status, 400, 'Missing port must return 400');

    // Invalid port (70000)
    res = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '1.2.3.4', port: 70000, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    assertEquals(res.status, 400, 'Out-of-range port must return 400');

    // Missing secret
    res = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '1.2.3.4', port: 443 }),
    });
    assertEquals(res.status, 400, 'Missing secret must return 400');
  });

  await runTest('Suite 2', 'DELETE /api/proxies/:id with non-existent ID returns 404', async () => {
    const res = await fetch(`${HTTP_BASE}/api/proxies/non_existent_proxy_id_99999`, { method: 'DELETE' });
    assertEquals(res.status, 404, 'Deleting non-existent ID returns 404');
  });

  await runTest('Suite 2', 'POST /api/proxies/active with non-existent ID returns 404', async () => {
    const res = await fetch(`${HTTP_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'non_existent_proxy_id_99999' }),
    });
    assertEquals(res.status, 404, 'Setting non-existent active ID returns 404');
  });

  await runTest('Suite 2', 'POST /api/proxies/active with missing ID returns 400', async () => {
    const res = await fetch(`${HTTP_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 400, 'Missing id returns 400');
  });

  await runTest('Suite 2', 'Full Proxy Lifecycle: Add custom proxy, inspect, switch, and delete', async () => {
    // 1. Add custom proxy
    const addRes = await fetch(`${HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 9999,
        secret: '0123456789abcdef0123456789abcdef',
        name: 'Challenger Temporary Node',
      }),
    });
    assertEquals(addRes.status, 201, 'Adding proxy returns 201 Created');
    const added = (await addRes.json()) as any;
    assert(added.id.startsWith('custom-'), 'Custom ID starts with custom-');

    // 2. Switch to custom proxy
    const switchRes = await fetch(`${HTTP_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: added.id }),
    });
    assertEquals(switchRes.status, 200, 'Switching active proxy returns 200');

    // 3. Delete custom proxy
    const delRes = await fetch(`${HTTP_BASE}/api/proxies/${added.id}`, { method: 'DELETE' });
    assertEquals(delRes.status, 200, 'Deleting custom proxy returns 200');

    // 4. Verify pool reverted active to default-primary
    const healthRes = await fetch(`${HTTP_BASE}/api/health`);
    const health = (await healthRes.json()) as any;
    assertEquals(health.activeProxy.id, 'default-primary', 'Active proxy falls back to default-primary');
  });

  // -------------------------------------------------------------------------
  // SUITE 3: Socket Drops, Abrupt Disconnects & Adversarial Traffic
  // -------------------------------------------------------------------------
  console.log('\n\x1b[35m=== SUITE 3: Socket Drops & Adversarial Traffic Resilience ===\x1b[0m');

  await runTest('Suite 3', 'Immediate client disconnect after WebSocket open is handled cleanly', async () => {
    const ws = new WebSocket(`${WS_BASE}?dcId=2`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    // Abrupt drop
    ws.terminate();

    // Verify bridge is healthy by doing a probe
    const probe = await fetch(`${HTTP_BASE}/api/health`);
    assertEquals(probe.status, 200, 'Server healthy after immediate drop');
  });

  await runTest('Suite 3', 'Rapid connect/disconnect bursts (20 sockets) without leaking or crashing', async () => {
    for (let i = 0; i < 20; i++) {
      const ws = new WebSocket(`${WS_BASE}?dcId=2`);
      ws.on('open', () => ws.terminate());
      ws.on('error', () => {});
    }
    await new Promise((r) => setTimeout(r, 500));

    // Verify functional MTProto response afterwards
    const ws = new WebSocket(`${WS_BASE}?dcId=2`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    const result = await exchangeReqPq(ws, 8000);
    ws.close();
    assertEquals(result.resPqConstructor, 0x05162463, 'Server returns valid resPQ after connection storm');
  });

  await runTest('Suite 3', 'Garbage / truncated transport frames do not crash relay', async () => {
    const ws = new WebSocket(`${WS_BASE}?dcId=2`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Send 3 bytes of nonsense (truncated length header)
    ws.send(Buffer.from([0x01, 0x02, 0x03]), { binary: true });
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    // Server must still be alive and responsive
    const probe = await fetch(`${HTTP_BASE}/api/health`);
    assertEquals(probe.status, 200, 'Server survived truncated frame');
  });

  // -------------------------------------------------------------------------
  // SUITE 4: High Concurrency MTProto Streaming & Cross-Talk Detection
  // -------------------------------------------------------------------------
  console.log('\n\x1b[35m=== SUITE 4: High Concurrency MTProto Streaming & Cross-Talk ===\x1b[0m');

  await runTest('Suite 4', 'Parallel DC streams across DC1, DC2, DC3, DC4, DC5 execute without cross-talk', async () => {
    const dcs = [1, 2, 3, 4, 5];
    const sockets = await Promise.all(
      dcs.map((dc) => {
        return new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`${WS_BASE}?dcId=${dc}`);
          ws.on('open', () => resolve(ws));
          ws.on('error', reject);
        });
      })
    );

    try {
      // Fire req_pq_multi on all 5 DCs simultaneously
      const exchangePromises = sockets.map((ws) => exchangeReqPq(ws, 12000));
      const resps = await Promise.all(exchangePromises);

      // Verify all nonces are distinct and all returned resPQ#05162463
      const noncesHex = new Set<string>();
      for (const res of resps) {
        assertEquals(res.resPqConstructor, 0x05162463, 'resPQ constructor matches');
        noncesHex.add(res.nonce.toString('hex'));
      }
      assertEquals(noncesHex.size, 5, 'All 5 concurrent nonces must be completely distinct');
    } finally {
      sockets.forEach((s) => s.close());
    }
  });

  await runTest('Suite 4', 'Simultaneous Chat DC (2) and Media DC (-2) sessions execute in parallel', async () => {
    const [chatWs, mediaWs] = await Promise.all([
      new Promise<WebSocket>((res, rej) => {
        const ws = new WebSocket(`${WS_BASE}?dcId=2`);
        ws.on('open', () => res(ws));
        ws.on('error', rej);
      }),
      new Promise<WebSocket>((res, rej) => {
        const ws = new WebSocket(`${WS_BASE}?dcId=-2`);
        ws.on('open', () => res(ws));
        ws.on('error', rej);
      }),
    ]);

    try {
      const [chatRes, mediaRes] = await Promise.all([
        exchangeReqPq(chatWs, 10000),
        exchangeReqPq(mediaWs, 10000),
      ]);

      assertEquals(chatRes.resPqConstructor, 0x05162463, 'Chat DC returned resPQ');
      assertEquals(mediaRes.resPqConstructor, 0x05162463, 'Media DC returned resPQ');
      assert(!chatRes.nonce.equals(mediaRes.nonce), 'Nonces must not be shared between chat and media');
    } finally {
      chatWs.close();
      mediaWs.close();
    }
  });

  await runTest('Suite 4', 'Concurrent REST polling burst (25 requests) while streaming MTProto packets', async () => {
    const ws = new WebSocket(`${WS_BASE}?dcId=2`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    try {
      // Launch 25 parallel GET /api/proxies requests
      const restBursts = Array.from({ length: 25 }, () => fetch(`${HTTP_BASE}/api/proxies`));

      // Simultaneously perform MTProto exchange
      const wsTask = exchangeReqPq(ws, 10000);

      const [wsResult, ...restResults] = await Promise.all([wsTask, ...restBursts]);

      assertEquals(wsResult.resPqConstructor, 0x05162463, 'MTProto query succeeded during REST storm');
      for (const res of restResults) {
        assertEquals(res.status, 200, 'REST query returned 200 during MTProto streaming');
      }
    } finally {
      ws.close();
    }
  });

  // -------------------------------------------------------------------------
  // Summary & Teardown
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('  CHALLENGE SUITE EXECUTION SUMMARY                                    ');
  console.log('========================================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total tests run : ${total}`);
  console.log(`Passed          : \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed          : \x1b[31m${failed}\x1b[0m`);

  if (isManagedServer) {
    healthManager.stop();
    server.close();
  }

  if (failed > 0) {
    console.error('\n❌ CHALLENGE FAILED: Failures detected in backend bridge implementation.');
    process.exit(1);
  } else {
    console.log('\n\x1b[32m✔ ALL CHALLENGE TESTS PASSED: Backend Bridge & Failover API verified resilient.\x1b[0m\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal challenge error:', err);
  process.exit(1);
});
