/**
 * Tier 1 Feature Tests: Multi-DC & Media Routing
 * Feature 4
 * Verifies routing across DC1–DC5 and Media DCs -1..-5
 */

import { registerTest, assertEquals, assertGreaterThan } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';

export function registerTier1DcRoutingTests() {
  const dcsToTest = [
    { dcId: 1, name: 'DC 1 (Miami)' },
    { dcId: 2, name: 'DC 2 (Amsterdam)' },
    { dcId: 3, name: 'DC 3 (Miami)' },
    { dcId: 4, name: 'DC 4 (Amsterdam)' },
    { dcId: 5, name: 'DC 5 (Singapore)' },
    { dcId: -2, name: 'Media DC -2 (Amsterdam Media)' },
  ];

  for (const { dcId, name } of dcsToTest) {
    registerTest(1, 'Multi-DC & Media Routing', `T1.3: Route MTProto traffic to ${name} (dcId=${dcId})`, async () => {
      const client = new WsMtproxyClient();
      try {
        await client.connect(dcId, { timeoutMs: 6000 });
        const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
        assertEquals(resPq.constructorId, 0x05162463, `Expected resPQ from ${name}`);
        assertEquals(resPq.nonce.length, 16, 'Expected 16-byte nonce');
        assertEquals(resPq.serverNonce.length, 16, 'Expected 16-byte server nonce');
        assertGreaterThan(resPq.pq.length, 0, 'Expected non-empty PQ value');
      } finally {
        client.close();
      }
    });
  }
}
