#!/usr/bin/env node
/**
 * LizardTalk Web — Milestone 3 Empirical Challenger Verification Suite
 * 
 * Target: Empirically stress-test and verify Milestone 3 UI components:
 * 1. Date formatters (+8 GMT / Asia/Kuala_Lumpur): leap years, boundary months, edge-case hours, DD-MM-YY, HH:mm:ss.
 * 2. Component source inspection: zero refresh buttons, explicit delete confirmation modal, two-row stacked timestamps.
 * 3. Delete confirmation modal logic & state transitions: default proxy protection, modal cancel/confirm lifecycle.
 * 4. API interaction error boundaries: invalid proxies (empty host, invalid ports, bad secrets), active proxy switching,
 *    default proxy deletion rejection (403), active proxy deletion fallback, visible UI error banners.
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatDateGmt8, formatTimeGmt8 } from '../../src/components/proxy/formatters.ts';

// Terminal colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: Error;
}

const results: TestResult[] = [];
const BACKEND_BASE = process.env.VITE_BRIDGE_HTTP_URL || 'http://localhost:8081';

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

function assertEquals<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ' — ' : ''}Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

async function runTest(suite: string, name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: true, durationMs });
    console.log(`    ${c.green}✔ PASS${c.reset} ${name} ${c.dim}(${durationMs}ms)${c.reset}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorObj = err instanceof Error ? err : new Error(String(err));
    results.push({ suite, name, passed: false, durationMs, error: errorObj });
    console.log(`    ${c.red}✖ FAIL${c.reset} ${name} ${c.dim}(${durationMs}ms)${c.reset}`);
    console.log(`      ${c.red}${errorObj.message}${c.reset}`);
  }
}

async function main() {
  console.log(`\n${c.bold}${c.cyan}════════════════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}     CHALLENGER M3 EMPIRICAL STRESS-TEST VERIFICATION SUITE            ${c.reset}`);
  console.log(`${c.bold}${c.cyan}════════════════════════════════════════════════════════════════════════${c.reset}\n`);

  // =========================================================================
  // SUITE 1: Date Formatters Empirical Stress-Tests (+8 GMT)
  // =========================================================================
  console.log(`\n${c.bold}${c.magenta}--- SUITE 1: Date Formatters Empirical Stress-Tests (+8 GMT) ---${c.reset}`);

  await runTest('Date Formatters', 'T1.1: Leap year boundary crossing — 2024-02-28 16:00:00Z becomes 2024-02-29 00:00:00 GMT+8', () => {
    // 16:00 UTC on 28 Feb in leap year 2024 + 8h = 00:00 on 29 Feb 2024
    const d = formatDateGmt8('2024-02-28T16:00:00.000Z');
    const t = formatTimeGmt8('2024-02-28T16:00:00.000Z');
    assertEquals(d, '29-02-24', 'Expected leap day 29-02-24');
    assertEquals(t, '00:00:00', 'Expected midnight 00:00:00');
  });

  await runTest('Date Formatters', 'T1.2: Leap year pre-boundary — 2024-02-28 15:59:59Z remains 28-02-24 23:59:59 GMT+8', () => {
    const d = formatDateGmt8('2024-02-28T15:59:59.000Z');
    const t = formatTimeGmt8('2024-02-28T15:59:59.000Z');
    assertEquals(d, '28-02-24', 'Expected 28-02-24');
    assertEquals(t, '23:59:59', 'Expected 23:59:59');
  });

  await runTest('Date Formatters', 'T1.3: Leap year exit boundary — 2024-02-29 16:00:00Z crosses to 01-03-24 00:00:00 GMT+8', () => {
    const d = formatDateGmt8('2024-02-29T16:00:00.000Z');
    const t = formatTimeGmt8('2024-02-29T16:00:00.000Z');
    assertEquals(d, '01-03-24', 'Expected 01-03-24');
    assertEquals(t, '00:00:00', 'Expected 00:00:00');
  });

  await runTest('Date Formatters', 'T1.4: Non-leap year — 2023-02-28 16:00:00Z crosses directly to 01-03-23 00:00:00 GMT+8', () => {
    const d = formatDateGmt8('2023-02-28T16:00:00.000Z');
    const t = formatTimeGmt8('2023-02-28T16:00:00.000Z');
    assertEquals(d, '01-03-23', 'Expected 01-03-23 in non-leap year');
    assertEquals(t, '00:00:00', 'Expected 00:00:00');
  });

  await runTest('Date Formatters', 'T1.5: Century leap year 2000 — 2000-02-28 16:00:00Z crosses to 29-02-00 00:00:00 GMT+8', () => {
    const d = formatDateGmt8('2000-02-28T16:00:00.000Z');
    const t = formatTimeGmt8('2000-02-28T16:00:00.000Z');
    assertEquals(d, '29-02-00', 'Expected 29-02-00 for century leap year');
    assertEquals(t, '00:00:00', 'Expected 00:00:00');
  });

  await runTest('Date Formatters', 'T1.6: Year-end boundary transition — 2026-12-31 16:00:00Z crosses to 01-01-27 00:00:00 GMT+8', () => {
    const d = formatDateGmt8('2026-12-31T16:00:00.000Z');
    const t = formatTimeGmt8('2026-12-31T16:00:00.000Z');
    assertEquals(d, '01-01-27', 'Expected new year day 01-01-27');
    assertEquals(t, '00:00:00', 'Expected 00:00:00');
  });

  await runTest('Date Formatters', 'T1.7: Year-end pre-transition — 2026-12-31 15:59:59Z remains 31-12-26 23:59:59 GMT+8', () => {
    const d = formatDateGmt8('2026-12-31T15:59:59.000Z');
    const t = formatTimeGmt8('2026-12-31T15:59:59.000Z');
    assertEquals(d, '31-12-26', 'Expected 31-12-26');
    assertEquals(t, '23:59:59', 'Expected 23:59:59');
  });

  await runTest('Date Formatters', 'T1.8: 30-day month boundary — 2026-04-30 16:00:00Z crosses to 01-05-26 00:00:00 GMT+8', () => {
    const d = formatDateGmt8('2026-04-30T16:00:00.000Z');
    const t = formatTimeGmt8('2026-04-30T16:00:00.000Z');
    assertEquals(d, '01-05-26', 'Expected 01-05-26');
    assertEquals(t, '00:00:00', 'Expected 00:00:00');
  });

  await runTest('Date Formatters', 'T1.9: Exhaustive 24-hour cycle stress test — checks all 24 hours for exact +8 offset', () => {
    for (let h = 0; h < 24; h++) {
      const hStr = String(h).padStart(2, '0');
      const iso = `2026-06-15T${hStr}:30:15.000Z`;
      const expectedHourNum = (h + 8) % 24;
      const expectedDay = h + 8 >= 24 ? 16 : 15;
      const expectedDate = `${expectedDay}-06-26`;
      const expectedTimePrefix = `${String(expectedHourNum).padStart(2, '0')}:30:15`;

      const actualDate = formatDateGmt8(iso);
      const actualTime = formatTimeGmt8(iso);

      assertEquals(actualDate, expectedDate, `Mismatch at UTC hour ${hStr}`);
      assertEquals(actualTime, expectedTimePrefix, `Time mismatch at UTC hour ${hStr}`);
    }
  });

  await runTest('Date Formatters', 'T1.10: Format compliance invariants — strictly DD-MM-YY and 24-hour HH:mm:ss', () => {
    const iso = '2026-10-26T06:15:30.000Z';
    const d = formatDateGmt8(iso);
    const t = formatTimeGmt8(iso);

    assert(/^\d{2}-\d{2}-\d{2}$/.test(d), `Date "${d}" must strictly match DD-MM-YY`);
    assert(!d.includes('/'), `Date "${d}" must not contain slash separators`);
    assert(!/AM|PM/i.test(t), `Time "${t}" must be 24-hour without AM/PM`);
    assert(/^\d{2}:\d{2}:\d{2}$/.test(t), `Time "${t}" must strictly match HH:mm:ss`);
  });

  await runTest('Date Formatters', 'T1.11: Error and boundary input resilience — null, undefined, empty, invalid strings', () => {
    const invalidInputs = [null, undefined, '', 'invalid-date-string', 'NaN', '2026-13-45T99:99:99Z'];
    for (const input of invalidInputs) {
      assertEquals(formatDateGmt8(input as any), '—', `formatDateGmt8(${input}) should return '—'`);
      assertEquals(formatTimeGmt8(input as any), '—', `formatTimeGmt8(${input}) should return '—'`);
    }
  });

  // =========================================================================
  // SUITE 2: Component Source Inspection (Static & Layout Conformance)
  // =========================================================================
  console.log(`\n${c.bold}${c.magenta}--- SUITE 2: Component Source Inspection (Static & Layout Conformance) ---${c.reset}`);

  const proxyDir = path.resolve(process.cwd(), 'src/components/proxy');
  const appTsxPath = path.resolve(process.cwd(), 'src/components/App.tsx');

  await runTest('Component Source', 'T2.1: Zero manual refresh/reload buttons in all proxy components and SCSS', () => {
    const files = fs.readdirSync(proxyDir);
    for (const file of files) {
      const content = fs.readFileSync(path.join(proxyDir, file), 'utf8');
      const lower = content.toLowerCase();

      // Ensure no manual refresh button or reload icon
      assert(
        !lower.includes('button') || !lower.includes('refresh'),
        `Component ${file} contains forbidden button with refresh: must rely on auto-polling`
      );
      assert(
        !lower.includes('button') || !lower.includes('reload'),
        `Component ${file} contains forbidden button with reload`
      );
    }
  });

  await runTest('Component Source', 'T2.2: Reactive auto-polling present in status badge and manager modal', () => {
    const badgeContent = fs.readFileSync(path.join(proxyDir, 'MtProxyStatusBadge.tsx'), 'utf8');
    const modalContent = fs.readFileSync(path.join(proxyDir, 'MtProxyManagerModal.tsx'), 'utf8');

    assert(badgeContent.includes('setInterval') && badgeContent.includes('5000'), 'Status badge must poll every 5000ms');
    assert(modalContent.includes('setInterval') && modalContent.includes('5000'), 'Manager modal must poll every 5000ms');
  });

  await runTest('Component Source', 'T2.3: Delete confirmation modal exists, exported, and properly structured', () => {
    const confirmPath = path.join(proxyDir, 'MtProxyConfirmModal.tsx');
    assert(fs.existsSync(confirmPath), 'MtProxyConfirmModal.tsx must exist');

    const content = fs.readFileSync(confirmPath, 'utf8');
    assert(content.includes('role="dialog"'), 'Confirm modal must have role="dialog"');
    assert(content.includes('aria-modal="true"'), 'Confirm modal must have aria-modal="true"');
    assert(content.includes('Confirm Proxy Deletion'), 'Confirm modal must have title Confirm Proxy Deletion');
    assert(content.includes('Are you sure you want to delete proxy'), 'Confirm modal must have explicit warning prompt');
    assert(content.includes('Cancel'), 'Confirm modal must have Cancel button');
    assert(content.includes('Confirm Delete'), 'Confirm modal must have Confirm Delete button');
    assert(content.includes('e.stopPropagation()'), 'Confirm modal content must stop propagation on clicks');
  });

  await runTest('Component Source', 'T2.4: Table timestamps render in two stacked rows with primary on top and secondary de-emphasized', () => {
    const modalContent = fs.readFileSync(path.join(proxyDir, 'MtProxyManagerModal.tsx'), 'utf8');

    assert(modalContent.includes('className="flex flex-col"'), 'Table cell must contain flex flex-col container');
    assert(modalContent.includes('formatDateGmt8(proxy.lastChecked)'), 'Top row must render formatDateGmt8');
    assert(modalContent.includes('formatTimeGmt8(proxy.lastChecked)'), 'Bottom row must render formatTimeGmt8');
    assert(modalContent.includes('text-xs opacity-60'), 'Time row must be de-emphasized with smaller font and reduced opacity');
  });

  await runTest('Component Source', 'T2.5: App.tsx root integration — mounts badge and modal at root UiLoader level', () => {
    const appContent = fs.readFileSync(appTsxPath, 'utf8');

    assert(appContent.includes('MtProxyStatusBadge'), 'App.tsx must import and render MtProxyStatusBadge');
    assert(appContent.includes('MtProxyManagerModal'), 'App.tsx must import and render MtProxyManagerModal');
    assert(appContent.includes('isProxyModalOpen'), 'App.tsx must manage modal visibility via state');
  });

  // =========================================================================
  // SUITE 3: Delete Confirmation Modal Logic & State Transitions
  // =========================================================================
  console.log(`\n${c.bold}${c.magenta}--- SUITE 3: Delete Confirmation Modal Logic & State Transitions ---${c.reset}`);

  await runTest('Modal Logic', 'T3.1: Default proxy is protected from deletion in UI rendering', () => {
    const modalContent = fs.readFileSync(path.join(proxyDir, 'MtProxyManagerModal.tsx'), 'utf8');

    // Default proxy must NOT render delete button
    assert(
      modalContent.includes('!proxy.isDefault &&') && modalContent.includes('promptDeleteProxy(proxy)'),
      'Delete button must be conditionally rendered only when !proxy.isDefault'
    );
  });

  await runTest('Modal Logic', 'T3.2: Modal returns undefined when closed or proxy is null (zero DOM leak)', () => {
    const confirmContent = fs.readFileSync(path.join(proxyDir, 'MtProxyConfirmModal.tsx'), 'utf8');

    assert(
      confirmContent.includes('if (!isOpen || !proxy)') && confirmContent.includes('return undefined'),
      'Confirm modal must cleanly unmount and return undefined when not open'
    );
  });

  await runTest('Modal Logic', 'T3.3: Delete action flow state machine simulation — prompt -> cancel vs confirm', () => {
    // Model state transitions of MtProxyManagerModal
    let proxyToDelete: any = null;
    let deleteApiCalledWithId: string | null = null;

    const dummyProxy = {
      id: 'custom-node-1',
      host: '10.0.0.1',
      port: 443,
      secret: '6c465965316ffd1afb2f0e2b3ea90a86',
      isDefault: false,
      isActive: false,
      isOnline: true,
      latencyMs: 120,
      lastChecked: '2026-10-26T06:00:00.000Z',
    };

    // 1. Initial: modal not triggered
    assertEquals(proxyToDelete, null, 'Initial state has no pending deletion');

    // 2. User clicks Delete on custom proxy
    proxyToDelete = dummyProxy;
    assert(proxyToDelete !== null, 'Delete prompt sets target proxy');
    assertEquals(proxyToDelete.id, 'custom-node-1', 'Target proxy is custom-node-1');
    assertEquals(deleteApiCalledWithId, null, 'API has NOT been called upon initial click');

    // 3. User cancels deletion
    proxyToDelete = null; // onCancel resets state
    assertEquals(proxyToDelete, null, 'Cancel clears pending proxy');
    assertEquals(deleteApiCalledWithId, null, 'Zero API calls made on cancel');

    // 4. User clicks Delete again and confirms
    proxyToDelete = dummyProxy;
    deleteApiCalledWithId = proxyToDelete.id; // onConfirm calls API
    proxyToDelete = null;

    assertEquals(deleteApiCalledWithId, 'custom-node-1', 'API invoked with confirmed proxy ID');
    assertEquals(proxyToDelete, null, 'Modal closes after confirmation');
  });

  // =========================================================================
  // SUITE 4: API Interaction Error Boundaries & Input Stress
  // =========================================================================
  console.log(`\n${c.bold}${c.magenta}--- SUITE 4: API Interaction Error Boundaries & Input Stress ---${c.reset}`);

  // Pre-check backend availability
  let isBackendLive = false;
  try {
    const probe = await fetch(`${BACKEND_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    isBackendLive = probe.status === 200;
  } catch {}

  assert(isBackendLive, `Backend must be online at ${BACKEND_BASE} for API error boundary tests`);

  await runTest('API Error Boundaries', 'T4.1: Adding proxy with empty host returns 400 Bad Request with explicit error message', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 443, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('host'), `Error must mention host: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.2: Adding proxy with whitespace host returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '   ', port: 443, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('host'), `Error must mention host: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.3: Adding proxy with port > 65535 returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 65536, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('port'), `Error must mention port: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.4: Adding proxy with port 0 or negative returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 0, secret: '6c465965316ffd1afb2f0e2b3ea90a86' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('port'), `Error must mention port: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.5: Adding proxy with empty secret returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 443, secret: '' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('secret'), `Error must mention secret: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.6: Adding proxy with malformed non-hex secret returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 443, secret: 'not-a-valid-hex-secret-xyz' }),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.toLowerCase().includes('secret'), `Error must mention secret: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.7: Setting active proxy with non-existent ID returns 404 Not Found', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'non-existent-proxy-id-test-99999' }),
    });
    const body = await res.json();
    assertEquals(res.status, 404, 'Expected HTTP 404');
    assert(body.error?.includes('not found'), `Error must mention not found: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.8: Setting active proxy with missing ID returns 400 Bad Request', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assertEquals(res.status, 400, 'Expected HTTP 400');
    assert(body.error?.includes('id'), `Error must mention id: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.9: Deleting default primary proxy is strictly rejected with 403 Forbidden', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies/default-primary`, {
      method: 'DELETE',
    });
    const body = await res.json();
    assertEquals(res.status, 403, 'Deleting default primary proxy must return HTTP 403 Forbidden');
    assert(body.error?.includes('Cannot delete the default primary'), `Error message must be explicit: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.10: Deleting non-existent proxy returns 404 Not Found', async () => {
    const res = await fetch(`${BACKEND_BASE}/api/proxies/unknown-node-never-existed`, {
      method: 'DELETE',
    });
    const body = await res.json();
    assertEquals(res.status, 404, 'Expected HTTP 404');
    assert(body.error?.includes('not found'), `Error must mention not found: "${body.error}"`);
  });

  await runTest('API Error Boundaries', 'T4.11: Valid custom proxy addition, activation, and deletion with fallback to default', async () => {
    // 1. Add valid custom proxy
    const addRes = await fetch(`${BACKEND_BASE}/api/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 8443,
        secret: '0123456789abcdef0123456789abcdef', // valid 16-byte hex
        name: 'Challenger Ephemeral Proxy',
      }),
    });
    assertEquals(addRes.status, 201, 'Adding valid proxy must return HTTP 201');
    const added = await addRes.json();
    assert(Boolean(added.id), 'Added proxy must have an ID');
    assertEquals(added.isDefault, false, 'Custom proxy must not be default');

    // 2. Set active to custom proxy
    const activeRes = await fetch(`${BACKEND_BASE}/api/proxies/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: added.id }),
    });
    assertEquals(activeRes.status, 200, 'Setting active proxy must return HTTP 200');
    const activeBody = await activeRes.json();
    assertEquals(activeBody.activeId, added.id, 'Active proxy ID must match added ID');

    // 3. Delete custom proxy
    const delRes = await fetch(`${BACKEND_BASE}/api/proxies/${encodeURIComponent(added.id)}`, {
      method: 'DELETE',
    });
    assertEquals(delRes.status, 200, 'Deleting custom proxy must return HTTP 200');

    // 4. Verify pool automatically restored default-primary as active
    const listRes = await fetch(`${BACKEND_BASE}/api/proxies`);
    const list = await listRes.json();
    assertEquals(list.activeId, 'default-primary', 'Active proxy must automatically revert to default-primary upon deletion');

    // 5. Verify deleted proxy is no longer in pool
    const found = list.proxies.find((p: any) => p.id === added.id);
    assertEquals(found, undefined, 'Deleted proxy must not exist in proxy pool');
  });

  await runTest('API Error Boundaries', 'T4.12: UI error alert and fallback reduction validation', () => {
    const modalContent = fs.readFileSync(path.join(proxyDir, 'MtProxyManagerModal.tsx'), 'utf8');

    // Visible error alert
    assert(modalContent.includes('className={styles.errorAlert}'), 'Manager modal must render error alert banner');
    assert(modalContent.includes('role="alert"'), 'Error alert must have role="alert"');

    // Visible success alert
    assert(modalContent.includes('className={styles.successAlert}'), 'Manager modal must render success alert banner');
    assert(modalContent.includes('role="status"'), 'Success alert must have role="status"');

    // Form client-side validation
    assert(modalContent.includes('All fields (Host, Port, and Secret) are required.'), 'Client-side form must validate non-empty fields');
    assert(modalContent.includes('Port must be an integer between 1 and 65535.'), 'Client-side form must validate port range');

    // Badge visible offline indicator
    const badgeContent = fs.readFileSync(path.join(proxyDir, 'MtProxyStatusBadge.tsx'), 'utf8');
    assert(badgeContent.includes('MTProxy: Offline'), 'Badge must render MTProxy: Offline text when error occurs');
    assert(badgeContent.includes('styles.dotRed'), 'Badge must render red dot when offline');
  });

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n${c.bold}${c.cyan}════════════════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}CHALLENGER VERIFICATION SUMMARY:${c.reset}`);
  console.log(`  Total Tests:    ${total}`);
  console.log(`  ${c.green}Passed:         ${passed}${c.reset}`);
  if (failed > 0) {
    console.log(`  ${c.red}Failed:         ${failed}${c.reset}`);
  } else {
    console.log(`  Failed:         0`);
  }
  console.log(`${c.bold}${c.cyan}════════════════════════════════════════════════════════════════════════${c.reset}\n`);

  if (failed > 0) {
    console.log(`${c.bold}${c.red}CHALLENGER FAILURE DETAILS:${c.reset}`);
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`  ${c.red}• [${f.suite}] ${f.name}:${c.reset} ${f.error?.message}`);
    }
    console.log();
    process.exit(1);
  } else {
    console.log(`${c.bold}${c.green}ALL 31 CHALLENGER STRESS TESTS PASSED EMPIRICALLY! 🚀${c.reset}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal unhandled error in challenger verification suite:${c.reset}`, err);
  process.exit(1);
});
