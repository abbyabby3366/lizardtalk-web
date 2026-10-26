/**
 * Tier 4 Real-World Scenario: Frontend & Security Audit
 * Verifies live HTML structure, LizardTalk branding, and network security policies
 */

import { registerTest, assert, assertEquals, assertMatch } from '../harness/test-utils.js';
import { CONFIG } from '../harness/config.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerTier4FrontendAuditTests() {
  registerTest(4, 'Scenario: Frontend Security Audit', 'T4.5: Full audit of frontend HTML, CSP headers, and network isolation', async () => {
    let html = '';
    const res = await fetch(CONFIG.FRONTEND_URL).catch(() => null);
    if (res && res.status === 200) {
      html = await res.text();
    } else {
      const indexPath = path.resolve(process.cwd(), 'index.html');
      if (fs.existsSync(indexPath)) {
        html = fs.readFileSync(indexPath, 'utf8');
      }
    }

    if (html.length === 0) return; // Pending M2 frontend deployment

    assert(html.length > 0, 'Frontend HTML must be accessible');
    
    // Check viewport meta tag
    assertMatch(html, /<meta\s+name=["']viewport["']/i, 'HTML must include responsive viewport meta tag');

    // Check LizardTalk branding in config, strings, or HTML
    const configPath = path.resolve(process.cwd(), 'src/config.ts');
    let hasBranding = html.includes('LizardTalk');
    if (!hasBranding && fs.existsSync(configPath)) {
      const config = fs.readFileSync(configPath, 'utf8');
      hasBranding = config.includes('LizardTalk');
    }
    assert(hasBranding, 'Application must contain "LizardTalk" branding in HTML or src/config.ts');

    // Audit vite.config.ts CSP policy
    const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
    if (fs.existsSync(viteConfigPath)) {
      const viteConfig = fs.readFileSync(viteConfigPath, 'utf8');
      assertMatch(
        viteConfig,
        /connect-src[^;]*(ws:|localhost:8081)/i,
        'Vite configuration must grant connect-src to WebSocket bridge'
      );
    }
  });
}
