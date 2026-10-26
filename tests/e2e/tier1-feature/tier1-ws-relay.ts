/**
 * Tier 1 Feature Tests: Binary WebSocket Relay
 * Features 5, 7
 * Entry points: ws://localhost:8081/mtproxy
 */

import { registerTest, assert, assertEquals, assertGreaterThan } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';
import { MtprotoCodec } from '../harness/mtproto-codec.js';
import { CONFIG } from '../harness/config.js';

export function registerTier1WsRelayTests() {
  // Test 1: WebSocket connection establishes successfully
  registerTest(1, 'Binary WebSocket Relay', 'T1.2.1: WebSocket handshake to /mtproxy?dcId=2 succeeds', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2, { timeoutMs: 5000 });
      assertEquals(client.isConnected, true, 'WebSocket should be connected');
    } finally {
      client.close();
    }
  });

  // Test 2: WebSocket operates in binary mode
  registerTest(1, 'Binary WebSocket Relay', 'T1.2.2: WebSocket relay operates in binary mode', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2, { binaryType: 'arraybuffer' });
      assertEquals(client.ws?.binaryType, 'arraybuffer', 'Expected binaryType arraybuffer');
    } finally {
      client.close();
    }
  });

  // Test 3: Padded Intermediate transport framing support
  registerTest(1, 'Binary WebSocket Relay', 'T1.2.3: Bridge handles Padded Intermediate transport framing', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2, { customUrl: `${CONFIG.BACKEND_WS_URL}?protocol=padded` });
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 6000);
      assertEquals(resPq.constructorId, 0x05162463, 'Expected resPQ constructor ID');
      assertEquals(resPq.nonce.length, 16, 'Nonce must be 16 bytes');
      assertEquals(resPq.serverNonce.length, 16, 'Server nonce must be 16 bytes');
      assertGreaterThan(resPq.pq.length, 0, 'PQ must not be empty');
    } finally {
      client.close();
    }
  });

  // Test 4: Intermediate transport framing support
  registerTest(1, 'Binary WebSocket Relay', 'T1.2.4: Bridge handles Intermediate transport framing', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2);
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 6000);
      assertEquals(resPq.constructorId, 0x05162463, 'Expected resPQ constructor ID');
    } finally {
      client.close();
    }
  });

  // Test 5: Raw pass-through mode (?raw=1)
  registerTest(1, 'Binary WebSocket Relay', 'T1.2.5: Raw pass-through mode (?raw=1) streams transparent TCP bytes', async () => {
    const client = new WsMtproxyClient();
    try {
      // With ?raw=1, client must perform Obfuscated2 handshake directly
      await client.connect(2, { raw: true });
      const { header, encryptCipher, decryptCipher } = MtprotoCodec.createObfuscated2Header(
        2,
        CONFIG.PRIMARY_PROXY.secret,
        0xeeeeeeee
      );

      // Send Obfuscated2 64-byte handshake
      client.send(header);

      // Create req_pq_multi and encrypt with AES-256-CTR
      const { buffer: unencPq } = MtprotoCodec.createReqPqMulti();
      const intermediateFrame = MtprotoCodec.wrapIntermediate(unencPq, false);
      const encryptedFrame = encryptCipher.update(intermediateFrame);

      client.send(encryptedFrame);

      // Await encrypted response
      const rawChunk = await client.waitForMessage(6000);
      const decrypted = decryptCipher.update(rawChunk);

      // Verify payload contains resPQ constructor
      assert(decrypted.length >= 24, `Decrypted response too short: ${decrypted.length}`);
      const packet = decrypted.subarray(4); // strip intermediate 4-byte length
      const resPq = MtprotoCodec.parseResPq(packet);
      assertEquals(resPq.constructorId, 0x05162463, 'Expected resPQ constructor ID in raw mode');
    } finally {
      client.close();
    }
  });
}
