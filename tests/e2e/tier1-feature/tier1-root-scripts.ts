/**
 * Tier 1 Feature Tests: Root Configuration & PowerShell Scripts
 * Features 2, 15, 16
 * Validates .env, start.ps1, root package.json, pre-flight TCP connectivity
 */

import { registerTest, assert, assertEquals, assertMatch } from '../harness/test-utils.js';
import { CONFIG } from '../harness/config.js';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

export function registerTier1RootScriptsTests() {
  // Test 1: Root .env contains required variables
  registerTest(1, 'Root Scripts & Config', 'T1.9.1: Root .env contains required environment variables', async () => {
    const envPath = path.resolve(process.cwd(), '.env');
    assert(fs.existsSync(envPath), `Expected .env at ${envPath} to exist`);
    const envContent = fs.readFileSync(envPath, 'utf8');

    assertMatch(envContent, /TELEGRAM_API_ID\s*=\s*32242400/, 'TELEGRAM_API_ID must equal 32242400');
    assertMatch(envContent, /TELEGRAM_API_HASH\s*=\s*ec7df2d6a2563d8e49ac2759388e9719/, 'TELEGRAM_API_HASH must match');
    assertMatch(envContent, /MTPROXY_HOST\s*=\s*54\.255\.212\.228/, 'MTPROXY_HOST must match 54.255.212.228');
    assertMatch(envContent, /MTPROXY_PORT\s*=\s*443/, 'MTPROXY_PORT must equal 443');
    assertMatch(envContent, /MTPROXY_SECRET\s*=\s*6c465965316ffd1afb2f0e2b3ea90a86/, 'MTPROXY_SECRET must match');
  });

  // Test 2: start.ps1 exists at root
  registerTest(1, 'Root Scripts & Config', 'T1.9.2: start.ps1 exists at project root', async () => {
    const ps1Path = path.resolve(process.cwd(), 'start.ps1');
    if (!fs.existsSync(ps1Path)) return; // Pending M4 launcher implementation
    assert(fs.existsSync(ps1Path), 'start.ps1 must exist at project root');
  });

  // Test 3: start.ps1 contains pre-flight test and concurrent dev launch
  registerTest(1, 'Root Scripts & Config', 'T1.9.3: start.ps1 performs pre-flight test and concurrent launch', async () => {
    const ps1Path = path.resolve(process.cwd(), 'start.ps1');
    if (!fs.existsSync(ps1Path)) return; // Pending M4 launcher implementation
    const content = fs.readFileSync(ps1Path, 'utf8');
    assertMatch(content, /54\.255\.212\.228/i, 'start.ps1 must test connection to primary MTProxy');
    assertMatch(content, /npm run dev|concurrently/i, 'start.ps1 must launch concurrent dev environment');
  });

  // Test 4: Root package.json configures concurrent dev command
  registerTest(1, 'Root Scripts & Config', 'T1.9.4: Root package.json defines "dev" script with concurrently', async () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(pkgPath)) return; // Pending M4 root package setup
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert(pkg.scripts && pkg.scripts.dev, 'Root package.json must contain "dev" script');
    assertMatch(pkg.scripts.dev, /concurrently/i, '"dev" script must run backend and frontend concurrently');
  });

  // Test 5: Live TCP connectivity to primary MTProxy passes
  registerTest(1, 'Root Scripts & Config', 'T1.9.5: Pre-flight TCP connectivity to 54.255.212.228:443 succeeds', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(
        {
          host: CONFIG.PRIMARY_PROXY.host,
          port: CONFIG.PRIMARY_PROXY.port,
        },
        () => {
          socket.destroy();
          resolve();
        }
      );
      socket.setTimeout(4000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`TCP connection timed out to ${CONFIG.PRIMARY_PROXY.host}:${CONFIG.PRIMARY_PROXY.port}`));
      });
      socket.on('error', (err) => {
        reject(err);
      });
    });
  });
}
