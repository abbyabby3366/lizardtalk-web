/**
 * Tier 1 Feature Tests: Backend Service & Health API
 * Features 6, 8, 9
 * Entry points: http://localhost:8081/api/*
 */

import { registerTest, assert, assertEquals, assertMatch } from '../harness/test-utils.js';
import { ApiClient } from '../harness/api-client.js';
import { CONFIG } from '../harness/config.js';

export function registerTier1BackendHealthTests() {
  const api = new ApiClient();

  // Test 1: GET /api/health returns HTTP 200 with status "ok"
  registerTest(1, 'Backend Health API', 'T1.1.1: GET /api/health returns 200 and status "ok"', async () => {
    const { status, body } = await api.getHealth();
    assertEquals(status, 200, 'Expected /api/health to return HTTP 200');
    assertEquals(body.status, 'ok', 'Expected status property to be "ok"');
    assert(body.activeProxy, 'Expected activeProxy to be defined in health response');
    assertEquals(body.activeProxy.host, CONFIG.PRIMARY_PROXY.host, 'Expected activeProxy host to match primary');
    assertEquals(body.activeProxy.port, CONFIG.PRIMARY_PROXY.port, 'Expected activeProxy port to match primary');
  });

  // Test 2: GET /api/proxies returns activeId and non-empty proxies array
  registerTest(1, 'Backend Health API', 'T1.1.2: GET /api/proxies returns proxy pool containing primary proxy', async () => {
    const { status, body } = await api.getProxies();
    assertEquals(status, 200, 'Expected /api/proxies to return HTTP 200');
    assert(typeof body.activeId === 'string' && body.activeId.length > 0, 'Expected valid activeId');
    assert(Array.isArray(body.proxies) && body.proxies.length >= 1, 'Expected at least 1 proxy in pool');

    const primary = body.proxies.find((p) => p.host === CONFIG.PRIMARY_PROXY.host && p.port === CONFIG.PRIMARY_PROXY.port);
    assert(primary, `Primary proxy ${CONFIG.PRIMARY_PROXY.host}:${CONFIG.PRIMARY_PROXY.port} must exist in pool`);
    assertEquals(primary.isDefault, true, 'Primary proxy must have isDefault === true');
  });

  // Test 3: CORS headers are present on API responses
  registerTest(1, 'Backend Health API', 'T1.1.3: Backend service exposes permissive CORS headers for web frontend', async () => {
    const res = await api.rawRequest('/api/health', { method: 'OPTIONS' });
    // Should respond with 200 or 204 for preflight, and have Access-Control headers
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert(
      allowOrigin === '*' || allowOrigin?.includes('localhost'),
      `Expected CORS Access-Control-Allow-Origin header, got: ${allowOrigin}`
    );
  });

  // Test 4: Health check timestamps are full ISO 8601 strings
  registerTest(1, 'Backend Health API', 'T1.1.4: Proxy records store full ISO 8601 health check timestamps', async () => {
    const { body } = await api.getProxies();
    assert(body.proxies.length > 0, 'No proxies found to check timestamp');
    for (const proxy of body.proxies) {
      if (proxy.lastChecked) {
        // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ or similar
        assertMatch(
          proxy.lastChecked,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
          `Timestamp "${proxy.lastChecked}" must be full ISO 8601`
        );
      }
    }
  });

  // Test 5: Unknown endpoints return HTTP 404
  registerTest(1, 'Backend Health API', 'T1.1.5: Non-existent API endpoints return HTTP 404', async () => {
    const res = await api.rawRequest('/api/non_existent_endpoint_xyz', { method: 'GET' });
    assertEquals(res.status, 404, 'Expected 404 status for non-existent endpoint');
  });
}
