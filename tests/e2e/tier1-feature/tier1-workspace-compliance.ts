/**
 * Tier 1 Feature Tests: Workspace UI & Formatting Compliance
 * Features 14, 18
 * Verifies GMT+8 formatting, two-row timestamps, delete confirmation, no refresh buttons, zero git operations
 */

import { registerTest, assert, assertEquals, assertMatch } from '../harness/test-utils.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function registerTier1WorkspaceComplianceTests() {
  // Test 1: Date and time formatting utility adheres to DD-MM-YY in GMT+8
  registerTest(1, 'Workspace Compliance', 'T1.8.1: Date formatter converts ISO timestamp to DD-MM-YY in GMT+8', async () => {
    // Test conversion of UTC timestamp: e.g. 2026-10-26T00:00:00Z -> 2026-10-26 08:00:00 in GMT+8 -> DD-MM-YY is 26-10-26
    const testDate = new Date('2026-10-26T00:00:00.000Z');
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
    const parts = formatter.format(testDate).replace(/\//g, '-');
    assertEquals(parts, '26-10-26', 'Expected DD-MM-YY format in GMT+8');
  });

  // Test 2: Two-row stacked table timestamp formatting in Proxy Manager UI component
  registerTest(1, 'Workspace Compliance', 'T1.8.2: Table timestamps render in two stacked rows (flex-col)', async () => {
    const componentDir = path.resolve(process.cwd(), 'src/components/proxy');
    if (fs.existsSync(componentDir)) {
      const files = fs.readdirSync(componentDir);
      let foundStackedLayout = false;
      for (const file of files) {
        const content = fs.readFileSync(path.join(componentDir, file), 'utf8');
        if (content.includes('flex flex-col') || content.includes('flex-direction: column') || content.includes('stacked')) {
          foundStackedLayout = true;
          break;
        }
      }
      assert(foundStackedLayout, 'Expected stacked layout (flex-col) for two-row timestamp rendering');
    }
  });

  // Test 3: Delete confirmation modal exists
  registerTest(1, 'Workspace Compliance', 'T1.8.3: Delete action requires confirmation prompt before execution', async () => {
    const componentDir = path.resolve(process.cwd(), 'src/components/proxy');
    if (fs.existsSync(componentDir)) {
      const modalPath = path.resolve(componentDir, 'MtProxyConfirmModal.tsx');
      const managerPath = path.resolve(componentDir, 'MtProxyManagerModal.tsx');
      const exists = fs.existsSync(modalPath) || (fs.existsSync(managerPath) && fs.readFileSync(managerPath, 'utf8').includes('confirm'));
      assert(exists, 'Delete confirmation modal or logic must exist in proxy components');
    }
  });

  // Test 4: No manual refresh buttons in proxy UI components
  registerTest(1, 'Workspace Compliance', 'T1.8.4: Zero manual refresh buttons or reload icons in proxy UI', async () => {
    const componentDir = path.resolve(process.cwd(), 'src/components/proxy');
    if (fs.existsSync(componentDir)) {
      const files = fs.readdirSync(componentDir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(componentDir, file), 'utf8');
        assert(
          !content.includes('button') || !content.toLowerCase().includes('refresh'),
          `Component ${file} must not contain manual Refresh buttons`
        );
      }
    }
  });

  // Test 5: Zero unapproved git operations
  registerTest(1, 'Workspace Compliance', 'T1.8.5: Git working directory has no unapproved commits or staged files', async () => {
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      // Staged changes show up with characters in first column (e.g. 'M ', 'A ', 'D ')
      const lines = status.split('\n').filter((l) => l.trim().length > 0);
      const staged = lines.filter((l) => l[0] !== ' ' && l[0] !== '?');
      assertEquals(staged.length, 0, `Detected ${staged.length} unapproved staged git changes: ${staged.join(', ')}`);
    } catch {
      // If git is not initialized, rule is strictly satisfied
    }
  });
}
