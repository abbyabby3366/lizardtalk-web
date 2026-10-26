/**
 * Tier 2 Boundary Tests: Abrupt Disconnects & Stress
 * Verifies server socket cleanup, rapid connect/disconnect bursts, and resource reclamation
 */

import { registerTest, assert, assertEquals, sleep } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier2DisconnectTests() {
  // Test 1: Immediate disconnect right after WebSocket opens
  registerTest(2, 'Boundary: Disconnects & Stress', 'T2.3.1: Immediate client disconnect after open is handled cleanly', async () => {
    const client = new WsMtproxyClient();
    await client.connect(2);
    // Immediately close before any data
    client.close();
    await sleep(200);

    // Verify bridge remains responsive by making a fresh connection
    const client2 = new WsMtproxyClient();
    try {
      await client2.connect(2);
      assertEquals(client2.isConnected, true, 'Subsequent connection must succeed');
    } finally {
      client2.close();
    }
  });

  // Test 2: Rapid connect/disconnect burst
  registerTest(2, 'Boundary: Disconnects & Stress', 'T2.3.2: Handles rapid connect-disconnect bursts without socket exhaustion', async () => {
    for (let i = 0; i < 5; i++) {
      const client = new WsMtproxyClient();
      await client.connect(2);
      client.close();
    }
    await sleep(300);

    // Verify healthy state
    const client = new WsMtproxyClient();
    try {
      await client.connect(2);
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 6000);
      assertEquals(resPq.constructorId, 0x05162463, 'Server must remain functional after burst');
    } finally {
      client.close();
    }
  });

  // Test 3: Truncated frame / incomplete length
  registerTest(2, 'Boundary: Disconnects & Stress', 'T2.3.3: Incomplete transport frame does not crash server', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2);
      // Send 2 bytes of garbage (incomplete frame)
      client.send(Buffer.from([0xef, 0x10]));
      await sleep(300);
    } finally {
      client.close();
    }

    // Verify server survived
    const client2 = new WsMtproxyClient();
    try {
      await client2.connect(2);
      const { resPq } = await client2.sendReqPqAndExpectResPq('intermediate', 6000);
      assertEquals(resPq.constructorId, 0x05162463, 'Server must survive incomplete frame');
    } finally {
      client2.close();
    }
  });
}
