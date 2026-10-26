/**
 * Tier 4 Real-World Scenario: Complete Proxy Management Lifecycle
 * Simulates a user adding, testing, activating, protecting, and removing proxies in the UI
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier4ProxyLifecycleTests() {
  const api = new ApiClient();

  registerTest(4, 'Scenario: Proxy Lifecycle', 'T4.4: Complete proxy CRUD, switching, and default protection lifecycle', async () => {
    // 1. Snapshot initial state
    const { body: initial } = await api.getProxies();
    const defaultProxy = initial.proxies.find((p) => p.isDefault);
    assert(defaultProxy, 'Default proxy must exist');
    const initialActiveId = initial.activeId;

    // 2. Add custom candidate proxy
    const customProxy = {
      host: '54.255.212.228',
      port: 443,
      secret: '6c465965316ffd1afb2f0e2b3ea90a86',
    };
    const { status: addStatus, body: added } = await api.addProxy(customProxy);
    assert(addStatus === 201 || addStatus === 200, 'Adding proxy should return 201 or 200');
    const customId = (added as any).id;
    assert(typeof customId === 'string' && customId.length > 0, 'New proxy must have valid ID');

    try {
      // 3. Verify it is listed in GET /api/proxies
      const { body: list1 } = await api.getProxies();
      const foundInList = list1.proxies.find((p) => p.id === customId);
      assert(foundInList !== undefined, 'Custom proxy must appear in proxies list');

      // 4. Activate the custom proxy
      const { status: switchStatus, body: switchRes } = await api.setActiveProxy(customId);
      assertEquals(switchStatus, 200, 'Switching active proxy must return 200');
      assertEquals(switchRes.activeId, customId, 'Active ID should be updated');

      // 5. Attempt to delete default proxy while custom is active -> must fail with 403
      const { status: deleteDefaultStatus } = await api.deleteProxy(defaultProxy.id);
      assertEquals(deleteDefaultStatus, 403, 'Default proxy cannot be deleted even when inactive');

      // 6. Switch back to original active proxy
      await api.setActiveProxy(initialActiveId);
      const { body: list2 } = await api.getProxies();
      assertEquals(list2.activeId, initialActiveId, 'Active proxy returned to original');
    } finally {
      // 7. Delete custom proxy
      const { status: deleteStatus } = await api.deleteProxy(customId);
      assertEquals(deleteStatus, 200, 'Custom proxy deleted successfully');

      // 8. Verify removal
      const { body: finalList } = await api.getProxies();
      const foundAfterDelete = finalList.proxies.find((p) => p.id === customId);
      assertEquals(foundAfterDelete, undefined, 'Custom proxy must be gone from pool');
    }
  });
}
