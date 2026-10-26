/**
 * Tier 2 Boundary Tests: REST API Boundaries & Strict Error Handling
 * Verifies 403 default proxy protection, 404 on missing records, 400 on malformed payloads
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier2ApiBoundaryTests() {
  const api = new ApiClient();

  // Test 1: Switch to non-existent proxy ID returns 404
  registerTest(2, 'Boundary: API Edge Cases', 'T2.4.1: Switch to non-existent proxy ID returns 404', async () => {
    const { status } = await api.setActiveProxy('non_existent_id_999999');
    assertEquals(status, 404, 'Expected 404 Not Found when switching to invalid ID');
  });

  // Test 2: Delete non-existent proxy returns 404
  registerTest(2, 'Boundary: API Edge Cases', 'T2.4.2: Delete non-existent proxy ID returns 404', async () => {
    const { status } = await api.deleteProxy('non_existent_id_999999');
    assertEquals(status, 404, 'Expected 404 Not Found when deleting invalid ID');
  });

  // Test 3: Missing required fields in POST /api/proxies (strict fallback reduction)
  registerTest(2, 'Boundary: API Edge Cases', 'T2.4.3: Missing required fields fail loudly with 400 (strict fallback reduction)', async () => {
    // Missing secret
    const res = await api.rawRequest('/api/proxies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '1.2.3.4', port: 443 }),
    });
    assertEquals(res.status, 400, 'Expected 400 Bad Request when missing secret');
  });

  // Test 4: Malformed JSON body in POST /api/proxies
  registerTest(2, 'Boundary: API Edge Cases', 'T2.4.4: Malformed JSON body returns 400 Bad Request', async () => {
    try {
      const res = await api.rawRequest('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ host: "bad json without quotes", ',
      });
      assertEquals(res.status, 400, 'Expected 400 Bad Request for malformed JSON');
    } catch (err: any) {
      throw new Error(`Server crashed or dropped connection on malformed JSON payload (Missing Express error handler): ${err.message}`);
    }
  });

  // Test 5: Default proxy delete protection returns 403 Forbidden
  registerTest(2, 'Boundary: API Edge Cases', 'T2.4.5: Attempt to delete default proxy returns 403 with error', async () => {
    const { body: list } = await api.getProxies();
    const defaultProxy = list.proxies.find((p) => p.isDefault);
    assert(defaultProxy, 'Default proxy must exist');

    const res = await api.deleteProxy(defaultProxy.id);
    assertEquals(res.status, 403, 'Must return 403 Forbidden');
    assert('error' in res.body && res.body.error.length > 0, 'Must include descriptive error message');
  });
}
