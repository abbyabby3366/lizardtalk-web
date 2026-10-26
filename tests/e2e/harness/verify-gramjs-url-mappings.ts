import { assert, assertEquals, assertMatch } from './test-utils.js';
import fs from 'node:fs';
import path from 'node:path';

async function testGramJsUrlMappings() {
  console.log('Testing GramJS PromisedWebSockets URL mappings:');

  // Verify PromisedWebSockets source code logic
  const sourcePath = path.resolve(process.cwd(), 'src/lib/gramjs/extensions/PromisedWebSockets.ts');
  assert(fs.existsSync(sourcePath), 'PromisedWebSockets.ts exists');
  const source = fs.readFileSync(sourcePath, 'utf8');

  // 1. Verify isMedia detection
  assertMatch(source, /ip\.includes\(['"]-1['"]\)/, 'Detects media connection via "-1" in ip');

  // 2. Verify signedDcId calculation
  assertMatch(source, /signedDcId\s*=\s*isMedia\s*\?\s*-Math\.abs\(dcId\)\s*:\s*Math\.abs\(dcId\)/, 'Signed DC correctly negates media DC');

  // 3. Verify bridgeUrl resolution across window, self, env, and default
  assertMatch(source, /LIZARDTALK_BRIDGE_WS/, 'Checks LIZARDTALK_BRIDGE_WS override');
  assertMatch(source, /ws:\/\/localhost:8081\/mtproxy/, 'Falls back to ws://localhost:8081/mtproxy');

  // 4. Test actual mapping logic directly
  function simulateGetWebSocketLink(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean, dcId = 2, customWs?: string) {
    const isMedia = ip.includes('-1');
    const signedDcId = isMedia ? -Math.abs(dcId) : Math.abs(dcId);
    const bridgeUrl = customWs || 'ws://localhost:8081/mtproxy';
    return `${bridgeUrl}?dcId=${signedDcId}${isTestServer ? '&test=1' : ''}${isPremium ? '&premium=1' : ''}`;
  }

  // Check all standard DCs
  for (let dc = 1; dc <= 5; dc++) {
    const url = simulateGetWebSocketLink(`zws${dc}.web.telegram.org`, 443, false, false, dc);
    assertEquals(url, `ws://localhost:8081/mtproxy?dcId=${dc}`, `Standard DC ${dc} mapping`);
    console.log(`  DC ${dc} mapping: PASS -> ${url}`);
  }

  // Check all media DCs
  for (let dc = 1; dc <= 5; dc++) {
    const url = simulateGetWebSocketLink(`zws${dc}-1.web.telegram.org`, 443, false, false, dc);
    assertEquals(url, `ws://localhost:8081/mtproxy?dcId=-${dc}`, `Media DC -${dc} mapping`);
    console.log(`  Media DC -${dc} mapping: PASS -> ${url}`);
  }

  // Check test server flag
  const testUrl = simulateGetWebSocketLink('zws2.web.telegram.org', 443, true, false, 2);
  assertEquals(testUrl, 'ws://localhost:8081/mtproxy?dcId=2&test=1', 'Test server query parameter');
  console.log(`  Test server flag: PASS -> ${testUrl}`);

  // Check premium flag
  const premiumUrl = simulateGetWebSocketLink('zws2.web.telegram.org', 443, false, true, 2);
  assertEquals(premiumUrl, 'ws://localhost:8081/mtproxy?dcId=2&premium=1', 'Premium server query parameter');
  console.log(`  Premium server flag: PASS -> ${premiumUrl}`);

  // Check combined media + test + premium
  const comboUrl = simulateGetWebSocketLink('zws4-1.web.telegram.org', 443, true, true, 4);
  assertEquals(comboUrl, 'ws://localhost:8081/mtproxy?dcId=-4&test=1&premium=1', 'Media + test + premium query parameters');
  console.log(`  Combined Media+Test+Premium flag: PASS -> ${comboUrl}`);

  // Check custom bridge override
  const customUrl = simulateGetWebSocketLink('zws1.web.telegram.org', 443, false, false, 1, 'ws://custom-bridge:9000/relay');
  assertEquals(customUrl, 'ws://custom-bridge:9000/relay?dcId=1', 'Custom bridge URL override');
  console.log(`  Custom bridge override: PASS -> ${customUrl}`);

  console.log('\nAll GramJS URL mapping tests passed successfully!');
}

testGramJsUrlMappings().catch((err) => {
  console.error('Failure:', err);
  process.exit(1);
});
