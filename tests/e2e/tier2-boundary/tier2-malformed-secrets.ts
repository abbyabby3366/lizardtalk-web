/**
 * Tier 2 Boundary Tests: Malformed & Invalid Secrets
 * Tests strict validation and failure cascading for bad proxy secrets
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { ApiClient } from '../harness/api-client.js';

export function registerTier2MalformedSecretsTests() {
  const api = new ApiClient();

  // Test 1: Non-hex characters in secret
  registerTest(2, 'Boundary: Malformed Secrets', 'T2.2.1: Rejects secret with non-hex characters', async () => {
    const { status, body } = await api.addProxy({
      host: '1.1.1.1',
      port: 443,
      secret: 'not_a_valid_hex_secret_abcdef123',
    });
    // Strict fallback reduction: must fail loudly with 400
    assert(status === 400 || 'error' in body, `Expected 400 or error for non-hex secret, got status ${status}`);
  });

  // Test 2: Truncated secret (shorter than 16 bytes / 32 hex chars)
  registerTest(2, 'Boundary: Malformed Secrets', 'T2.2.2: Rejects truncated secret (< 16 bytes)', async () => {
    const { status, body } = await api.addProxy({
      host: '1.1.1.1',
      port: 443,
      secret: '0123456789abcdef', // only 8 bytes
    });
    assert(status === 400 || 'error' in body, `Expected 400 or error for truncated secret, got status ${status}`);
  });

  // Test 3: Odd length hex string
  registerTest(2, 'Boundary: Malformed Secrets', 'T2.2.3: Rejects odd-length hex string', async () => {
    const { status, body } = await api.addProxy({
      host: '1.1.1.1',
      port: 443,
      secret: '6c465965316ffd1afb2f0e2b3ea90a8', // 31 characters
    });
    assert(status === 400 || 'error' in body, `Expected 400 or error for odd-length hex, got status ${status}`);
  });

  // Test 4: Fake-TLS secret with no domain bytes
  registerTest(2, 'Boundary: Malformed Secrets', 'T2.2.4: Rejects ee-prefixed secret with missing SNI domain', async () => {
    const { status, body } = await api.addProxy({
      host: '1.1.1.1',
      port: 443,
      secret: 'ee6c465965316ffd1afb2f0e2b3ea90a86', // ee + 16 bytes but no domain
    });
    // Either rejected or treated as malformed Fake-TLS
    assert(status === 400 || 'error' in body, `Expected error for Fake-TLS secret missing SNI domain, got status ${status}`);
  });
}
