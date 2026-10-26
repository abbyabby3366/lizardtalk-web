/**
 * Tier 3 Cross-Feature Combination Tests: Concurrent Media & Chat DCs
 * Tests simultaneous media DC (-2) and chat DC (2) WebSocket streams
 */

import { registerTest, assertEquals } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier3ConcurrentDcsTests() {
  registerTest(3, 'Combination: Concurrent DCs', 'T3.2: Concurrent Chat DC (2) and Media DC (-2) sessions execute in parallel', async () => {
    const chatClient = new WsMtproxyClient();
    const mediaClient = new WsMtproxyClient();

    try {
      // Connect both simultaneously
      await Promise.all([
        chatClient.connect(2, { timeoutMs: 8000 }),
        mediaClient.connect(-2, { timeoutMs: 8000 }),
      ]);

      // Execute req_pq_multi on both concurrently
      const [chatRes, mediaRes] = await Promise.all([
        chatClient.sendReqPqAndExpectResPq('intermediate', 8000),
        mediaClient.sendReqPqAndExpectResPq('intermediate', 8000),
      ]);

      assertEquals(chatRes.resPq.constructorId, 0x05162463, 'Chat DC 2 returned resPQ');
      assertEquals(mediaRes.resPq.constructorId, 0x05162463, 'Media DC -2 returned resPQ');

      // Verify nonces are distinct and matching their own requests
      assertEquals(
        chatRes.resPq.nonce.toString('hex'),
        chatRes.originalNonce.toString('hex'),
        'Chat nonce matches original'
      );
      assertEquals(
        mediaRes.resPq.nonce.toString('hex'),
        mediaRes.originalNonce.toString('hex'),
        'Media nonce matches original'
      );
    } finally {
      chatClient.close();
      mediaClient.close();
    }
  });
}
