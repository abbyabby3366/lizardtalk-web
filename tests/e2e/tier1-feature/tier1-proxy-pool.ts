/**
 * Tier 1 Feature Tests: Proxy Pool Management & Failover
 * Features 8, 9, 13
 * REST API: GET/POST /api/proxies, POST /api/proxies/active, DELETE /api/proxies/:id
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier1ProxyPoolTests() {
  const api = new ApiClient();

  // Test 1: Add a new proxy candidate
  registerTest(1, 'Proxy Pool Management', 'T1.5.1: POST /api/proxies adds new proxy candidate to pool', async () => {
    const newProxy = {
      host: '1.2.3.4',
      port: 443,
      secret: '00112233445566778899aabbccddeeff',
    };
    const { status, body } = await api.addProxy(newProxy);
    assert(status === 201 || status === 200, `Expected 201 or 200 status when adding proxy, got ${status}`);
    assert('id' in body && typeof body.id === 'string', 'Expected returned proxy to have an ID');
    assertEquals((body as any).host, newProxy.host, 'Host must match');
    assertEquals((body as any).port, newProxy.port, 'Port must match');

    // Clean up
    await api.deleteProxy((body as any).id);
  });

  // Test 2: Switch active proxy
  registerTest(1, 'Proxy Pool Management', 'T1.5.2: POST /api/proxies/active switches the active proxy', async () => {
    // 1. Get current list
    const { body: initial } = await api.getProxies();
    const originalActiveId = initial.activeId;

    // 2. Add temporary proxy
    const { body: added } = await api.addProxy({
      host: '8.8.8.8',
      port: 443,
      secret: '112233445566778899aabbccddeeff00',
    });
    const tempId = (added as any).id;

    try {
      // 3. Switch active to tempId
      const { status, body: switchRes } = await api.setActiveProxy(tempId);
      assertEquals(status, 200, 'Expected 200 on switching proxy');
      assertEquals(switchRes.activeId, tempId, 'Active ID should be updated');

      // 4. Verify in GET /api/proxies
      const { body: updated } = await api.getProxies();
      assertEquals(updated.activeId, tempId, 'Active ID must be persisted');
    } finally {
      // Switch back to original
      await api.setActiveProxy(originalActiveId);
      // Clean up temp proxy
      await api.deleteProxy(tempId);
    }
  });

  // Test 3: Delete non-default proxy
  registerTest(1, 'Proxy Pool Management', 'T1.5.3: DELETE /api/proxies/:id removes non-default proxy', async () => {
    const { body: added } = await api.addProxy({
      host: '9.9.9.9',
      port: 443,
      secret: 'aabbccddeeff00112233445566778899',
    });
    const tempId = (added as any).id;

    const { status, body: deleteRes } = await api.deleteProxy(tempId);
    assertEquals(status, 200, 'Expected 200 on deleting non-default proxy');
    assertEquals(deleteRes.success, true, 'Expected success === true');

    // Verify it is no longer in pool
    const { body: list } = await api.getProxies();
    const found = list.proxies.find((p) => p.id === tempId);
    assertEquals(found, undefined, 'Deleted proxy should not exist in pool');
  });

  // Test 4: Delete default proxy is strictly forbidden (403)
  registerTest(1, 'Proxy Pool Management', 'T1.5.4: DELETE /api/proxies/:id rejects default proxy deletion with 403', async () => {
    const { body: list } = await api.getProxies();
    const defaultProxy = list.proxies.find((p) => p.isDefault);
    assert(defaultProxy, 'Default proxy must exist in pool');

    const { status, body } = await api.deleteProxy(defaultProxy.id);
    assertEquals(status, 403, 'Expected 403 Forbidden when deleting default proxy');
    assert('error' in body && body.error.length > 0, 'Expected error message in response');
  });

  // Test 5: Proxy pool state persistence
  registerTest(1, 'Proxy Pool Management', 'T1.5.5: Proxy pool retains state across multiple sequential operations', async () => {
    const { body: initial } = await api.getProxies();
    const initialCount = initial.proxies.length;

    const { body: added } = await api.addProxy({
      host: '4.4.4.4',
      port: 443,
      secret: 'abcdefabcdefabcdefabcdefabcdefab',
    });
    const tempId = (added as any).id;

    const { body: midList } = await api.getProxies();
    assertEquals(midList.proxies.length, initialCount + 1, 'Proxy count should increase by 1');

    await api.deleteProxy(tempId);

    const { body: finalList } = await api.getProxies();
    assertEquals(finalList.proxies.length, initialCount, 'Proxy count should return to initial');
  });
}
