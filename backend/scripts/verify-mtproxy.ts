/**
 * Programmatic MTProxy & MTProto 2.0 Verification Script
 *
 * Verifies:
 * 1. REST API endpoints (/api/health, /api/proxies)
 * 2. WebSocket bridge (/mtproxy) to 54.255.212.228:443
 * 3. Complete MTProto 2.0 DH Key Exchange across DC1 through DC5:
 *    - req_pq_multi (#be7e8ef1) -> resPQ (#05162463)
 *    - Pollard's rho PQ factorization
 *    - req_DH_params (#d712e4be) -> server_DH_params_ok (#d0e8075c)
 *    - AES-256-IGE answer decryption & DH exponentiation
 *    - set_client_DH_params (#f5045f1f) -> dh_gen_ok (#3bcbf734)
 * 4. Dual-mode verification (Bridge Obfuscated2 mode + Raw pass-through ?raw=1)
 */

import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { executeMTProtoDH } from '../src/crypto/mtproto-dh.js';
import { createHandshake, PROTOCOL_INTERMEDIATE } from '../src/crypto/obfuscated2.js';

const BRIDGE_PORT = parseInt(process.env.PORT || '8081', 10);
const BRIDGE_WS_BASE = `ws://localhost:${BRIDGE_PORT}/mtproxy`;
const BRIDGE_HTTP_BASE = `http://localhost:${BRIDGE_PORT}`;

// Helper: Ensure backend service is running, start in-process if not running
async function ensureServerRunning(): Promise<() => void> {
  try {
    const res = await fetch(`${BRIDGE_HTTP_BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      console.log(`[Verify] Connected to existing backend server on port ${BRIDGE_PORT}`);
      return () => {};
    }
  } catch {
    // Server not running yet, start it
  }

  console.log(`[Verify] Launching local backend server on port ${BRIDGE_PORT}...`);
  const { server, healthManager, startServer } = await import('../src/server.js');
  await startServer(BRIDGE_PORT);

  return () => {
    healthManager.stop();
    server.close();
  };
}

/**
 * Runs MTProto 2.0 DH key exchange through ws://localhost:8081/mtproxy?dcId=${dcId}
 */
async function verifyDCKeyExchange(dcId: number): Promise<{
  dcId: number;
  durationMs: number;
  authKeyIdHex: string;
  serverTime: number;
}> {
  const wsUrl = `${BRIDGE_WS_BASE}?dcId=${dcId}`;
  const startTime = Date.now();

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket connection timeout to ${wsUrl}`)), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Reassembly stream buffer for intermediate framed packets
  let streamBuf = Buffer.alloc(0);
  const pendingResolvers: Array<(pkt: Buffer) => void> = [];

  ws.on('message', (data: Buffer) => {
    streamBuf = Buffer.concat([streamBuf, Buffer.isBuffer(data) ? data : Buffer.from(data as any)]);

    while (streamBuf.length >= 4) {
      const payloadLen = streamBuf.readUInt32LE(0);
      if (streamBuf.length < 4 + payloadLen) {
        break;
      }
      const packet = streamBuf.subarray(4, 4 + payloadLen);
      streamBuf = streamBuf.subarray(4 + payloadLen);

      if (pendingResolvers.length > 0) {
        const resolvePkt = pendingResolvers.shift()!;
        resolvePkt(packet);
      }
    }
  });

  const sendPacket = (payload: Buffer): Promise<Buffer> => {
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Packet response timeout for DC ${dcId}`));
      }, 7000);

      pendingResolvers.push((pkt) => {
        clearTimeout(timeout);
        resolve(pkt);
      });

      // Frame with 4-byte LE length
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32LE(payload.length, 0);
      payload.copy(frame, 4);

      ws.send(frame, { binary: true });
    });
  };

  try {
    const result = await executeMTProtoDH({ sendPacket, dcId });
    const durationMs = Date.now() - startTime;
    ws.close();

    return {
      dcId,
      durationMs,
      authKeyIdHex: result.authKeyId.toString('hex'),
      serverTime: result.serverTime,
    };
  } catch (err) {
    ws.close();
    throw err;
  }
}

/**
 * Tests Media DC routing with signed negative dcId (-1..-5)
 * Verifies that the bridge connects with signed 16-bit negative dcId and receives resPQ#05162463
 */
async function verifyMediaDCRouting(mediaDc: number): Promise<{
  mediaDc: number;
  durationMs: number;
}> {
  const wsUrl = `${BRIDGE_WS_BASE}?dcId=${mediaDc}`;
  const startTime = Date.now();

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket connection timeout to ${wsUrl}`)), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for resPQ from Media DC ${mediaDc}`));
    }, 7000);

    let streamBuf = Buffer.alloc(0);

    ws.on('message', (data: Buffer) => {
      streamBuf = Buffer.concat([streamBuf, Buffer.isBuffer(data) ? data : Buffer.from(data as any)]);

      while (streamBuf.length >= 4) {
        const payloadLen = streamBuf.readUInt32LE(0);
        if (streamBuf.length < 4 + payloadLen) {
          break;
        }
        const packet = streamBuf.subarray(4, 4 + payloadLen);
        streamBuf = streamBuf.subarray(4 + payloadLen);

        if (packet.length >= 24) {
          const ctor = packet.readUInt32LE(20);
          if (ctor === 0x05162463) {
            clearTimeout(timeout);
            const durationMs = Date.now() - startTime;
            ws.close();
            resolve({ mediaDc, durationMs });
            return;
          }
        }
      }
    });

    // Send req_pq_multi
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

    const frame = Buffer.alloc(4 + reqPqMsg.length);
    frame.writeUInt32LE(reqPqMsg.length, 0);
    reqPqMsg.copy(frame, 4);

    ws.send(frame, { binary: true });
  });
}

/**
 * Tests raw pass-through mode ?raw=1
 */
async function verifyRawPassThrough(): Promise<void> {
  const wsUrl = `${BRIDGE_WS_BASE}?raw=1`;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timeout for raw pass-through')), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', reject);
  });

  const handshake = createHandshake('6c465965316ffd1afb2f0e2b3ea90a86', 5, PROTOCOL_INTERMEDIATE);
  const { initialPacket, encryptCipher, decryptCipher } = handshake;

  // Send Obfuscated2 handshake over raw WebSocket
  ws.send(initialPacket, { binary: true });

  // Send req_pq_multi
  const nonce = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const now = Date.now();
  const msgId = (BigInt(Math.floor(now / 1000)) << 32n) | (BigInt((now % 1000) * 1000) << 12n);
  const reqPqMsg = Buffer.alloc(40);
  reqPqMsg.fill(0, 0, 8);
  reqPqMsg.writeBigInt64LE(msgId, 8);
  reqPqMsg.writeUInt32LE(20, 16);
  reqPqMsg.writeUInt32LE(0xbe7e8ef1, 20);
  nonce.copy(reqPqMsg, 24);

  const frame = Buffer.alloc(4 + reqPqMsg.length);
  frame.writeUInt32LE(reqPqMsg.length, 0);
  reqPqMsg.copy(frame, 4);

  const encFrame = (encryptCipher as any).update(frame);
  ws.send(encFrame, { binary: true });

  let rawBuf = Buffer.alloc(0);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for raw response')), 5000);

    ws.on('message', (chunk: Buffer) => {
      const dec = (decryptCipher as any).update(Buffer.from(chunk));
      rawBuf = Buffer.concat([rawBuf, dec]);
      if (rawBuf.length >= 24) {
        const ctor = rawBuf.readUInt32LE(24);
        if (ctor === 0x05162463) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      }
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('  LizardTalk Web — MTProxy & MTProto 2.0 Cryptographic Suite   ');
  console.log('================================================================');

  const shutdown = await ensureServerRunning();

  try {
    // 1. Verify REST API
    console.log('\n[1/4] Verifying REST API endpoints...');
    const healthRes = await fetch(`${BRIDGE_HTTP_BASE}/api/health`);
    if (!healthRes.ok) throw new Error(`Health check returned status ${healthRes.status}`);
    const healthJson = (await healthRes.json()) as any;
    console.log(`  ✓ GET /api/health -> status: ${healthJson.status}, active: ${healthJson.activeProxy.host}:${healthJson.activeProxy.port}`);

    const proxiesRes = await fetch(`${BRIDGE_HTTP_BASE}/api/proxies`);
    if (!proxiesRes.ok) throw new Error(`Proxies endpoint returned status ${proxiesRes.status}`);
    const proxiesJson = (await proxiesRes.json()) as any;
    console.log(`  ✓ GET /api/proxies -> activeId: ${proxiesJson.activeId}, count: ${proxiesJson.proxies.length}`);

    // Verify primary proxy default deletion protection (403 Forbidden)
    const delRes = await fetch(`${BRIDGE_HTTP_BASE}/api/proxies/default-primary`, { method: 'DELETE' });
    if (delRes.status === 403) {
      console.log('  ✓ DELETE /api/proxies/default-primary -> correctly rejected with 403 Forbidden (Primary protected)');
    } else {
      throw new Error(`Expected 403 when deleting default proxy, received: ${delRes.status}`);
    }

    // Verify malformed JSON error handling (400 Bad Request)
    const malformedRes = await fetch(`${BRIDGE_HTTP_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"invalid": json',
    });
    if (malformedRes.status === 400) {
      const errJson = (await malformedRes.json()) as any;
      if (errJson.error === 'Invalid JSON payload') {
        console.log('  ✓ POST /api/proxies (malformed JSON) -> correctly returned 400 Bad Request');
      } else {
        throw new Error(`Unexpected error message: ${JSON.stringify(errJson)}`);
      }
    } else {
      throw new Error(`Expected 400 for malformed JSON, received: ${malformedRes.status}`);
    }

    // 2. Verify MTProto 2.0 DH key exchange across DC1 through DC5
    console.log('\n[2/4] Verifying MTProto 2.0 Diffie-Hellman Key Exchange across DCs...');
    const dcs = [1, 2, 3, 4, 5];
    for (const dc of dcs) {
      const result = await verifyDCKeyExchange(dc);
      console.log(
        `  ✓ DC ${result.dcId} Handshake SUCCESS -> auth_key_id: 0x${result.authKeyIdHex}, latency: ${result.durationMs}ms, server_time: ${result.serverTime}`
      );
    }

    // 3. Verify Media DC connection (DC -2 and DC -5)
    console.log('\n[3/4] Verifying Media DC routing (signed negative dcId)...');
    for (const mediaDc of [-2, -5]) {
      const result = await verifyMediaDCRouting(mediaDc);
      console.log(
        `  ✓ Media DC ${result.mediaDc} SUCCESS -> received resPQ#05162463 in ${result.durationMs}ms`
      );
    }

    // 4. Verify Raw Pass-Through Mode (?raw=1)
    console.log('\n[4/4] Verifying Raw Pass-Through Bridge (?raw=1)...');
    await verifyRawPassThrough();
    console.log('  ✓ Raw binary pass-through (?raw=1) verified successfully');

    console.log('\n================================================================');
    console.log('  ALL VERIFICATIONS PASSED: 100% MTProto 2.0 End-to-End Success  ');
    console.log('================================================================\n');

    shutdown();
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Verification FAILED:', err.message);
    shutdown();
    process.exit(1);
  }
}

main();
