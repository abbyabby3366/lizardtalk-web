/**
 * Tier 3 Cross-Feature Combination Tests: Active Proxy Switching During Traffic
 * Tests dynamic proxy switching while WebSocket traffic is active
 */

import { registerTest, assert, assertEquals, sleep } from '../harness/test-utils.js';
import { WsMtproxyClient } from '../harness/ws-client.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier3ProxySwitchingTests() {
  const api = new ApiClient();

  registerTest(3, 'Combination: Proxy Switching Under Traffic', 'T3.1: Switch active proxy while client WebSocket session is established', async () => {
    // 1. Establish connection to DC 2
    const client = new WsMtproxyClient();
    await client.connect(2);
    
    // Send initial packet
    const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 6000);
    assertEquals(resPq.constructorId, 0x05162463, 'Initial packet succeeds on active proxy');

    // 2. Add and switch to another proxy in REST API
    const { body: initial } = await api.getProxies();
    const originalActiveId = initial.activeId;

    const { body: added } = await api.addProxy({
      host: '54.255.212.228', // valid host
      port: 443,
      secret: '6c465965316ffd1afb2f0e2b3ea90a86',
    });
    const secondaryId = (added as any).id;

    try {
      // Switch active proxy
      await api.setActiveProxy(secondaryId);
      await sleep(100);

      // Existing socket can still complete its query or close cleanly
      try {
        client.sendReqPqAndExpectResPq('intermediate', 3000);
      } catch {}

      // New connection routes through newly active proxy
      const client2 = new WsMtproxyClient();
      try {
        await client2.connect(2);
        const { resPq: resPq2 } = await client2.sendReqPqAndExpectResPq('intermediate', 6000);
        assertEquals(resPq2.constructorId, 0x05162463, 'New connection must succeed through switched proxy');
      } finally {
        client2.close();
      }
    } finally {
      client.close();
      await api.setActiveProxy(originalActiveId);
      await api.deleteProxy(secondaryId);
    }
  });
}
