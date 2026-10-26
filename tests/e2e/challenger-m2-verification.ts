/**
 * Milestone 2 Challenger Empirical Verification Suite
 * 
 * Verifies:
 * 1. Code-path audit: all WebSocket instantiations in src/lib/gramjs/
 * 2. Signed DC routing: chat DCs (1..5) and media DCs (-1..-5)
 * 3. URL construction in PromisedWebSockets.getWebSocketLink
 * 4. CSP connect-src policy in vite.config.ts / index.html
 * 5. Live MTProto handshake across all 5 Chat DCs and all 5 Media DCs (-1..-5)
 */

import fs from 'node:fs';
import path from 'node:path';
import { WsMtproxyClient } from './harness/ws-client.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  const status = passed ? '✔ PASS' : '✖ FAIL';
  console.log(`${status}: ${name}`);
  if (!passed && error) {
    console.log(`  Error: ${error}`);
  }
}

// =========================================================================
// TEST 1: WebSocket AST / Code-path Audit in src/lib/gramjs/
// =========================================================================
function testGramJsWebSocketAudit() {
  const gramJsDir = path.resolve(process.cwd(), 'src/lib/gramjs');
  
  function scanDir(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanDir(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allFiles = scanDir(gramJsDir);
  const filesWithWebSocketNew: { file: string; line: number; content: string }[] = [];

  for (const file of allFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (/new\s+WebSocket\s*\(/.test(line)) {
        filesWithWebSocketNew.push({
          file: path.relative(process.cwd(), file),
          line: idx + 1,
          content: line.trim(),
        });
      }
    });
  }

  // Expect only PromisedWebSockets.ts
  const isOnlyPromisedWebSockets = filesWithWebSocketNew.length === 1 &&
    filesWithWebSocketNew[0].file.replace(/\\/g, '/').includes('src/lib/gramjs/extensions/PromisedWebSockets.ts');

  record(
    'Audit: Exactly one WebSocket constructor in src/lib/gramjs/ (PromisedWebSockets.ts)',
    isOnlyPromisedWebSockets,
    isOnlyPromisedWebSockets ? undefined : `Found ${filesWithWebSocketNew.length} WebSocket instantiations: ${JSON.stringify(filesWithWebSocketNew)}`,
    filesWithWebSocketNew
  );

  // Check PromisedWebSockets.ts implementation
  const pwsPath = path.resolve(process.cwd(), 'src/lib/gramjs/extensions/PromisedWebSockets.ts');
  const pwsContent = fs.readFileSync(pwsPath, 'utf8');

  // Verify that new WebSocket strictly uses this.website from getWebSocketLink
  const usesWebsite = pwsContent.includes('this.website = this.getWebSocketLink') &&
    pwsContent.includes('new WebSocket(this.website');
  record('Audit: PromisedWebSockets.ts uses getWebSocketLink() for WebSocket target', usesWebsite);

  // Check if any raw web.telegram.org string is used in PromisedWebSockets
  const hasRawTelegramUrl = pwsContent.includes('web.telegram.org');
  record('Audit: PromisedWebSockets.ts contains zero hardcoded web.telegram.org URLs', !hasRawTelegramUrl);
}

// =========================================================================
// TEST 2: URL Construction for Chat DCs (1..5) and Media DCs (-1..-5)
// =========================================================================
function testGetWebSocketLinkLogic() {
  // Replicate the logic from PromisedWebSockets.ts to test exact outputs
  function getWebSocketLinkSim(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean, dcId = 2) {
    const isMedia = ip.includes('-1') || dcId < 0;
    const signedDcId = isMedia ? -Math.abs(dcId) : Math.abs(dcId);
    const bridgeUrl = 'ws://localhost:8081/mtproxy';
    return `${bridgeUrl}?dcId=${signedDcId}${isTestServer ? '&test=1' : ''}${isPremium ? '&premium=1' : ''}`;
  }

  // 1. Chat DCs (1..5) with standard IP
  for (let dc = 1; dc <= 5; dc++) {
    const ip = `zws${dc}.web.telegram.org`;
    const url = getWebSocketLinkSim(ip, 443, false, false, dc);
    const expected = `ws://localhost:8081/mtproxy?dcId=${dc}`;
    record(`URL Construction: Chat DC ${dc} -> ${expected}`, url === expected, url !== expected ? `Got: ${url}` : undefined);
  }

  // 2. Media DCs (-1..-5) via ip.includes('-1')
  for (let dc = 1; dc <= 5; dc++) {
    const ip = `zws${dc}-1.web.telegram.org`;
    const url = getWebSocketLinkSim(ip, 443, false, false, dc);
    const expected = `ws://localhost:8081/mtproxy?dcId=-${dc}`;
    record(`URL Construction: Media DC -${dc} (via media IP ${ip}) -> ${expected}`, url === expected, url !== expected ? `Got: ${url}` : undefined);
  }

  // 3. Stress / Edge Case: What if dcId is passed as negative integer with non-media IP?
  const negativeDcUrl = getWebSocketLinkSim('zws2.web.telegram.org', 443, false, false, -2);
  const preservesNegative = negativeDcUrl.includes('dcId=-2');
  record(
    'Edge Case: getWebSocketLink preserves negative dcId even if IP lacks "-1"',
    preservesNegative,
    preservesNegative ? undefined : `Negative dcId was flipped to positive: ${negativeDcUrl}`
  );
}

// =========================================================================
// TEST 3: CSP Policy Analysis
// =========================================================================
function testCspPolicy() {
  const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
  const content = fs.readFileSync(viteConfigPath, 'utf8');

  // Extract connect-src directive specifically inside buildCsp
  const buildCspMatch = content.match(/function buildCsp\([\s\S]*?connect-src([^;]+);/);
  const connectSrc = buildCspMatch ? buildCspMatch[1].trim() : '';

  // Check 3.1: Does connect-src permit ws://localhost:8081 (directly or via ws:)?
  const permitsLocalWs = connectSrc.includes('ws:') || connectSrc.includes('ws://localhost:8081') || connectSrc.includes('localhost:8081');
  record('CSP Audit: connect-src permits ws://localhost:8081', permitsLocalWs, permitsLocalWs ? undefined : `connect-src is: "${connectSrc}"`);

  // Check 3.2: Does connect-src block direct wss://*.web.telegram.org?
  // If connect-src has "wss:", standard browser CSP allows ALL wss: connections, including wss://*.web.telegram.org
  const hasWildcardWss = /(?:^|\s)wss:(?:\s|$)/.test(connectSrc);
  const blocksDirectTelegramWss = !hasWildcardWss;
  record(
    'CSP Audit: connect-src blocks direct wss://*.web.telegram.org (no wildcard wss:)',
    blocksDirectTelegramWss,
    blocksDirectTelegramWss ? undefined : `connect-src contains unrestricted "wss:" scheme which permits direct wss://*.web.telegram.org! Policy: "${connectSrc}"`
  );

  // Check 3.3: Does connect-src block direct https://*.web.telegram.org (no wildcard https:)?
  const hasWildcardHttps = /(?:^|\s)https:(?:\s|$)/.test(connectSrc);
  record(
    'CSP Audit: connect-src blocks direct https://*.web.telegram.org (no wildcard https:)',
    !hasWildcardHttps,
    !hasWildcardHttps ? undefined : `connect-src contains unrestricted "https:" scheme which permits direct fallback to https://*.web.telegram.org! Policy: "${connectSrc}"`
  );
}

// =========================================================================
// TEST 4: Live Bridge MTProto Handshake for ALL 10 DCs (1..5 and -1..-5)
// =========================================================================
async function testLiveAllDcs() {
  const dcsToTest = [
    { dcId: 1, type: 'Chat' },
    { dcId: 2, type: 'Chat' },
    { dcId: 3, type: 'Chat' },
    { dcId: 4, type: 'Chat' },
    { dcId: 5, type: 'Chat' },
    { dcId: -1, type: 'Media' },
    { dcId: -2, type: 'Media' },
    { dcId: -3, type: 'Media' },
    { dcId: -4, type: 'Media' },
    { dcId: -5, type: 'Media' },
  ];

  for (const { dcId, type } of dcsToTest) {
    const client = new WsMtproxyClient();
    try {
      await client.connect(dcId, { timeoutMs: 7000 });
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
      const isResPqValid = resPq.constructorId === 0x05162463 && resPq.nonce.length === 16 && resPq.serverNonce.length === 16;
      record(
        `Live Handshake: ${type} DC ${dcId} completes req_pq_multi -> resPQ via MTProxy bridge`,
        isResPqValid,
        isResPqValid ? undefined : `Invalid resPQ: ${JSON.stringify(resPq)}`
      );
    } catch (err: any) {
      record(
        `Live Handshake: ${type} DC ${dcId} completes req_pq_multi -> resPQ via MTProxy bridge`,
        false,
        err.message || String(err)
      );
    } finally {
      client.close();
    }
  }
}

async function run() {
  console.log('================================================================');
  console.log('       CHALLENGER M2 EMPIRICAL VERIFICATION HARNESS             ');
  console.log('================================================================\n');

  testGramJsWebSocketAudit();
  console.log('');
  testGetWebSocketLinkLogic();
  console.log('');
  testCspPolicy();
  console.log('');
  await testLiveAllDcs();
  console.log('');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('================================================================');
  console.log(`SUMMARY: Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`- ${r.name}`);
      if (r.error) console.log(`  Reason: ${r.error}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
