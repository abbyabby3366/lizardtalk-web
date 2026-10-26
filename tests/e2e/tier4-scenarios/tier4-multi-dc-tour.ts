/**
 * Tier 4 Real-World Scenario: Multi-DC Production Tour
 * Consecutively connects and executes MTProto queries against all production DCs
 */

import { registerTest, assert, assertEquals, assertLessThan } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier4MultiDcTourTests() {
  registerTest(4, 'Scenario: Multi-DC Tour', 'T4.3: Consecutively ping all 5 Telegram DCs and Media DC over bridge', async () => {
    const dcs = [1, 2, 3, 4, 5, -2];
    const latencies: Record<number, number> = {};

    for (const dcId of dcs) {
      const client = new WsMtproxyClient();
      const start = Date.now();
      try {
        await client.connect(dcId, { timeoutMs: 8000 });
        const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
        const elapsed = Date.now() - start;
        latencies[dcId] = elapsed;

        assertEquals(resPq.constructorId, 0x05162463, `DC ${dcId} must return resPQ`);
        assertLessThan(elapsed, 6000, `DC ${dcId} response must complete within 6000ms (took ${elapsed}ms)`);
      } finally {
        client.close();
      }
    }

    assert(Object.keys(latencies).length === dcs.length, 'All DCs must have recorded latency');
  });
}
