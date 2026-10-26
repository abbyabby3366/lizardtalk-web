#!/usr/bin/env node
/**
 * LizardTalk Web — Comprehensive E2E Test Suite Runner
 * 
 * Usage:
 *   npx tsx tests/e2e/runner.ts [options]
 * 
 * Options:
 *   --tier <1|2|3|4>    Run only tests in the specified tier
 *   --grep <string>     Filter tests whose name or feature matches the query
 *   --verbose           Print verbose logs and full error stack traces
 *   --help              Show this help message
 */

import { testRegistry, TestResult, colors } from './harness/test-utils.js';
import { CONFIG } from './harness/config.js';

// Tier 1 test registrations
import { registerTier1BackendHealthTests } from './tier1-feature/tier1-backend-health.js';
import { registerTier1WsRelayTests } from './tier1-feature/tier1-ws-relay.js';
import { registerTier1DcRoutingTests } from './tier1-feature/tier1-dc-routing.js';
import { registerTier1CryptoHandshakeTests } from './tier1-feature/tier1-crypto-handshake.js';
import { registerTier1ProxyPoolTests } from './tier1-feature/tier1-proxy-pool.js';
import { registerTier1VerifyScriptTests } from './tier1-feature/tier1-verify-script.js';
import { registerTier1FrontendBrandingTests } from './tier1-feature/tier1-frontend-branding.js';
import { registerTier1WorkspaceComplianceTests } from './tier1-feature/tier1-workspace-compliance.js';
import { registerTier1RootScriptsTests } from './tier1-feature/tier1-root-scripts.js';

// Tier 2 test registrations
import { registerTier2InvalidDcTests } from './tier2-boundary/tier2-invalid-dc.js';
import { registerTier2MalformedSecretsTests } from './tier2-boundary/tier2-malformed-secrets.js';
import { registerTier2DisconnectTests } from './tier2-boundary/tier2-disconnects.js';
import { registerTier2ApiBoundaryTests } from './tier2-boundary/tier2-api-boundaries.js';

// Tier 3 test registrations
import { registerTier3ProxySwitchingTests } from './tier3-combination/tier3-proxy-switching.js';
import { registerTier3ConcurrentDcsTests } from './tier3-combination/tier3-concurrent-dcs.js';
import { registerTier3StressMultiplexTests } from './tier3-combination/tier3-stress-multiplex.js';

// Tier 4 test registrations
import { registerTier4DhHandshakeTests } from './tier4-scenarios/tier4-dh-handshake.js';
import { registerTier4LoginTokenTests } from './tier4-scenarios/tier4-login-token.js';
import { registerTier4MultiDcTourTests } from './tier4-scenarios/tier4-multi-dc-tour.js';
import { registerTier4ProxyLifecycleTests } from './tier4-scenarios/tier4-proxy-lifecycle.js';
import { registerTier4FrontendAuditTests } from './tier4-scenarios/tier4-frontend-audit.js';

// Parse CLI flags
function parseArgs(): { tierFilter?: number; grepFilter?: string; verbose: boolean; help: boolean } {
  const args = process.argv.slice(2);
  let tierFilter: number | undefined;
  let grepFilter: string | undefined;
  let verbose = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && i + 1 < args.length) {
      tierFilter = parseInt(args[++i], 10);
    } else if (args[i] === '--grep' && i + 1 < args.length) {
      grepFilter = args[++i].toLowerCase();
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    }
  }

  return { tierFilter, grepFilter, verbose, help };
}

async function main() {
  const { tierFilter, grepFilter, verbose, help } = parseArgs();

  if (help) {
    console.log(`
${colors.bold}${colors.cyan}LizardTalk Web — E2E Test Suite Runner${colors.reset}

Usage:
  npx tsx tests/e2e/runner.ts [options]

Options:
  --tier <1|2|3|4>    Run only tests in specified tier
  --grep <query>      Run only tests matching query string
  --verbose           Enable verbose stack traces and logging
  --help              Display this help message
`);
    process.exit(0);
  }

  // Register all tests
  registerTier1BackendHealthTests();
  registerTier1WsRelayTests();
  registerTier1DcRoutingTests();
  registerTier1CryptoHandshakeTests();
  registerTier1ProxyPoolTests();
  registerTier1VerifyScriptTests();
  registerTier1FrontendBrandingTests();
  registerTier1WorkspaceComplianceTests();
  registerTier1RootScriptsTests();

  registerTier2InvalidDcTests();
  registerTier2MalformedSecretsTests();
  registerTier2DisconnectTests();
  registerTier2ApiBoundaryTests();

  registerTier3ProxySwitchingTests();
  registerTier3ConcurrentDcsTests();
  registerTier3StressMultiplexTests();

  registerTier4DhHandshakeTests();
  registerTier4LoginTokenTests();
  registerTier4MultiDcTourTests();
  registerTier4ProxyLifecycleTests();
  registerTier4FrontendAuditTests();

  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}       LIZARDTALK WEB — 4-TIER E2E TEST SUITE RUNNER                   ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  console.log(`${colors.dim}Target Backend:${colors.reset}  ${CONFIG.BACKEND_HTTP_URL} & ${CONFIG.BACKEND_WS_URL}`);
  console.log(`${colors.dim}Target Frontend:${colors.reset} ${CONFIG.FRONTEND_URL}`);
  console.log(`${colors.dim}Primary MTProxy:${colors.reset} ${CONFIG.PRIMARY_PROXY.host}:${CONFIG.PRIMARY_PROXY.port}\n`);

  // Pre-flight probe for backend availability
  let backendOnline = false;
  try {
    const probe = await fetch(`${CONFIG.BACKEND_HTTP_URL}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    backendOnline = probe.status === 200;
  } catch {}

  if (!backendOnline) {
    console.log(`${colors.yellow}⚠ NOTE: Backend bridge at ${CONFIG.BACKEND_HTTP_URL} is currently OFFLINE.${colors.reset}`);
    console.log(`${colors.dim}  Network relay and API tests will require backend running (npm run dev or start.ps1).${colors.reset}\n`);
  } else {
    console.log(`${colors.green}✔ Backend bridge is ONLINE.${colors.reset}\n`);
  }

  // Filter tests
  const testsToRun = testRegistry.filter((t) => {
    if (tierFilter !== undefined && t.tier !== tierFilter) return false;
    if (grepFilter !== undefined) {
      const matchName = t.name.toLowerCase().includes(grepFilter);
      const matchFeature = t.feature?.toLowerCase().includes(grepFilter);
      if (!matchName && !matchFeature) return false;
    }
    return true;
  });

  if (testsToRun.length === 0) {
    console.log(`${colors.yellow}No tests matched the specified filters.${colors.reset}\n`);
    process.exit(0);
  }

  console.log(`${colors.bold}Executing ${testsToRun.length} tests (total registered: ${testRegistry.length})...${colors.reset}\n`);

  const results: TestResult[] = [];
  let currentTier: number | null = null;
  let currentFeature: string | null = null;

  const suiteStart = Date.now();

  for (const testCase of testsToRun) {
    // Print Tier header if changed
    if (testCase.tier !== currentTier) {
      currentTier = testCase.tier;
      console.log(`\n${colors.bold}${colors.magenta}--- TIER ${currentTier} ---${colors.reset}`);
    }

    // Print Feature header if changed
    if (testCase.feature && testCase.feature !== currentFeature) {
      currentFeature = testCase.feature;
      console.log(`  ${colors.bold}${colors.blue}[${currentFeature}]${colors.reset}`);
    }

    const testStart = Date.now();
    try {
      await testCase.fn();
      const durationMs = Date.now() - testStart;
      results.push({
        name: testCase.name,
        tier: testCase.tier,
        feature: testCase.feature,
        passed: true,
        durationMs,
      });
      console.log(`    ${colors.green}✔ PASS${colors.reset} ${testCase.name} ${colors.dim}(${durationMs}ms)${colors.reset}`);
    } catch (err: any) {
      const durationMs = Date.now() - testStart;
      const errorObj = err instanceof Error ? err : new Error(String(err));
      results.push({
        name: testCase.name,
        tier: testCase.tier,
        feature: testCase.feature,
        passed: false,
        durationMs,
        error: errorObj,
      });
      console.log(`    ${colors.red}✖ FAIL${colors.reset} ${testCase.name} ${colors.dim}(${durationMs}ms)${colors.reset}`);
      console.log(`      ${colors.red}${errorObj.message}${colors.reset}`);
      if (verbose && errorObj.stack) {
        console.log(`      ${colors.dim}${errorObj.stack}${colors.reset}`);
      }
    }
  }

  const totalDuration = Date.now() - suiteStart;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}SUMMARY:${colors.reset}`);
  console.log(`  Total Tests:    ${results.length}`);
  console.log(`  ${colors.green}Passed:         ${passedCount}${colors.reset}`);
  if (failedCount > 0) {
    console.log(`  ${colors.red}Failed:         ${failedCount}${colors.reset}`);
  } else {
    console.log(`  Failed:         0`);
  }
  console.log(`  Duration:       ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (failedCount > 0) {
    console.log(`${colors.bold}${colors.red}FAILURES:${colors.reset}`);
    for (const failure of results.filter((r) => !r.passed)) {
      console.log(`  ${colors.red}• [Tier ${failure.tier}] ${failure.name}:${colors.reset} ${failure.error?.message}`);
    }
    console.log();
    process.exit(1);
  } else {
    console.log(`${colors.bold}${colors.green}ALL TESTS PASSED SUCCESSFULLY! 🚀${colors.reset}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${colors.red}Unhandled error in test runner:${colors.reset}`, err);
  process.exit(1);
});
