/**
 * Tier 1 Feature Tests: Programmatic Verification CLI & DH Mechanics
 * Feature 17
 * Verifies DH key exchange primitives, Pollard's rho factorization, and verify script
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { MtprotoCodec } from '../harness/mtproto-codec.js';
import { WsMtproxyClient } from '../harness/ws-client.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerTier1VerifyScriptTests() {
  // Test 1: Verify script source file exists in backend/scripts
  registerTest(1, 'Verification CLI', 'T1.6.1: Programmatic verify script exists on disk', async () => {
    const scriptPath = path.resolve(process.cwd(), 'backend/scripts/verify-mtproxy.ts');
    assert(fs.existsSync(scriptPath), `Expected script at ${scriptPath} to exist`);
  });

  // Test 2: Pollard's rho factorization of sample Telegram PQ
  registerTest(1, 'Verification CLI', 'T1.6.2: Pollard rho algorithm decomposes 64-bit PQ into prime factors', async () => {
    // Known 32-bit prime pair
    const pExpected = 1000000007n;
    const qExpected = 1000000009n;
    const pq = pExpected * qExpected;
    const pqHex = pq.toString(16);
    const pqBuf = Buffer.from(pqHex.length % 2 === 1 ? '0' + pqHex : pqHex, 'hex');

    const { p, q } = MtprotoCodec.factorizePq(pqBuf);
    assertEquals(p, pExpected, 'Factor p should match expected prime');
    assertEquals(q, qExpected, 'Factor q should match expected prime');
    assertEquals(p * q, pq, 'Product of factors must equal original PQ');
  });

  // Test 3: Live req_pq_multi packet exchange through bridge
  registerTest(1, 'Verification CLI', 'T1.6.3: Live req_pq_multi executes successfully and factors live PQ', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2);
      const { resPq, originalNonce } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
      
      // Nonce returned must match nonce sent
      assertEquals(resPq.nonce.toString('hex'), originalNonce.toString('hex'), 'Returned nonce must match client nonce');
      
      // Server nonce must be 16 bytes
      assertEquals(resPq.serverNonce.length, 16, 'Server nonce must be 16 bytes');

      // Factor live PQ
      const { p, q } = MtprotoCodec.factorizePq(resPq.pq);
      const pqBigInt = BigInt('0x' + resPq.pq.toString('hex'));
      assertEquals(p * q, pqBigInt, 'Factored p * q must equal server pq');
    } finally {
      client.close();
    }
  });

  // Test 4: Server public key fingerprints validation
  registerTest(1, 'Verification CLI', 'T1.6.4: resPQ includes valid Telegram RSA public key fingerprints', async () => {
    const client = new WsMtproxyClient();
    try {
      await client.connect(2);
      const { resPq } = await client.sendReqPqAndExpectResPq('intermediate', 8000);
      assert(resPq.fingerprints.length > 0, 'Server must return at least one RSA key fingerprint');
    } finally {
      client.close();
    }
  });

  // Test 5: Verify script runnable via package.json script check
  registerTest(1, 'Verification CLI', 'T1.6.5: Root/backend package.json defines verify:mtproxy command', async () => {
    const rootPkgPath = path.resolve(process.cwd(), 'package.json');
    const backendPkgPath = path.resolve(process.cwd(), 'backend/package.json');
    
    let hasScript = false;
    if (fs.existsSync(rootPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts['verify:mtproxy']) hasScript = true;
    }
    if (!hasScript && fs.existsSync(backendPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts['verify:mtproxy']) hasScript = true;
    }
    assert(hasScript, 'Expected verify:mtproxy script in package.json');
  });
}
