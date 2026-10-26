/**
 * Tier 4 Real-World Scenario: Telegram Login & QR Token Emulation
 * Simulates GramJS login session initiation over the bridge
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier4LoginTokenTests() {
  registerTest(4, 'Scenario: Telegram Login Flow', 'T4.2: Telegram Login initiation and transport setup over bridge', async () => {
    // Connect to Telegram DC 2 (default registration/login DC)
    const client = new WsMtproxyClient();
    try {
      await client.connect(2, { timeoutMs: 8000 });

      // Emulate initial GramJS connection packet exchange
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
      assertEquals(resPq.constructorId, 0x05162463, 'GramJS initial handshake succeeded');
      assert(resPq.serverNonce.length === 16, 'Server nonce received for login challenge');
    } finally {
      client.close();
    }
  });
}
