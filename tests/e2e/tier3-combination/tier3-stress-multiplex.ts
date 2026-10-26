/**
 * Tier 3 Cross-Feature Combination Tests: Stress & Multiplexing
 * Tests continuous REST health check polling concurrent with MTProto WebSocket streaming
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier3StressMultiplexTests() {
  const api = new ApiClient();

  registerTest(3, 'Combination: Stress & Multiplexing', 'T3.3: High-frequency REST polling concurrent with MTProto relay traffic', async () => {
    const wsClient = new WsMtproxyClient();
    await wsClient.connect(2);

    try {
      // Launch 10 parallel REST polling requests
      const pollPromises = Array.from({ length: 10 }, () => api.getProxies());

      // Concurrently run MTProto req_pq_multi
      const wsPromise = wsClient.sendReqPqAndExpectResPq('intermediate', 8000);

      const [wsResult, ...pollResults] = await Promise.all([wsPromise, ...pollPromises]);

      assertEquals(wsResult.resPq.constructorId, 0x05162463, 'MTProto query succeeded under load');
      for (const res of pollResults) {
        assertEquals(res.status, 200, 'REST poll returned 200 under load');
        assert(res.body.proxies.length > 0, 'Proxies list non-empty');
      }
    } finally {
      wsClient.close();
    }
  });
}
