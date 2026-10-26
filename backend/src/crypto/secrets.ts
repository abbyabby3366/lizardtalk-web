/**
 * MTProxy Secret Parser
 *
 * Supports:
 * - Standard 16-byte hex secrets (32 hex characters)
 * - 'dd'-prefixed padded intermediate secrets (34 hex characters)
 * - 'ee'-prefixed Fake-TLS secrets (>= 34 hex characters, with SNI domain)
 *
 * Strict validation: Invalid secrets throw an Error immediately without fallback guessing.
 */

export interface ParsedSecret {
  mode: 'standard' | 'padded' | 'faketls';
  rawSecret: Buffer;
  domain?: string;
  defaultProtocolTag: number;
}

export const PROTOCOL_INTERMEDIATE = 0xeeeeeeee;
export const PROTOCOL_PADDED_INTERMEDIATE = 0xdddddddd;
export const PROTOCOL_ABRIDGED = 0xefefefef;

export function parseSecret(secretStr: string): ParsedSecret {
  if (!secretStr || typeof secretStr !== 'string') {
    throw new Error('MTProxy secret must be a non-empty string');
  }

  const clean = secretStr.trim().toLowerCase();

  // Validate hex characters
  if (!/^[0-9a-f]+$/.test(clean)) {
    throw new Error(`Invalid MTProxy secret format: secret must contain only hexadecimal characters. Received: "${secretStr}"`);
  }

  // 1. Padded Intermediate: 34 hex chars starting with 'dd'
  if (clean.startsWith('dd')) {
    if (clean.length !== 34) {
      throw new Error(`Invalid padded MTProxy secret length: expected 34 hex characters, got ${clean.length}`);
    }
    const rawSecret = Buffer.from(clean.slice(2), 'hex');
    if (rawSecret.length !== 16) {
      throw new Error(`Invalid raw secret length extracted from padded secret: expected 16 bytes, got ${rawSecret.length}`);
    }
    return {
      mode: 'padded',
      rawSecret,
      defaultProtocolTag: PROTOCOL_PADDED_INTERMEDIATE,
    };
  }

  // 2. Fake-TLS: Starts with 'ee', at least 34 hex chars
  if (clean.startsWith('ee')) {
    if (clean.length < 34) {
      throw new Error(`Invalid Fake-TLS MTProxy secret length: expected at least 34 hex characters, got ${clean.length}`);
    }
    const rawSecret = Buffer.from(clean.slice(2, 34), 'hex');
    if (rawSecret.length !== 16) {
      throw new Error(`Invalid raw secret length extracted from Fake-TLS secret: expected 16 bytes, got ${rawSecret.length}`);
    }

    let domain: string | undefined;
    const domainHex = clean.slice(34);
    if (domainHex.length > 0) {
      if (domainHex.length % 2 !== 0) {
        throw new Error(`Invalid Fake-TLS SNI domain hex length: must be an even number of characters, got ${domainHex.length}`);
      }
      const domainBuf = Buffer.from(domainHex, 'hex');
      domain = domainBuf.toString('utf8');
      if (!domain || domain.trim().length === 0) {
        throw new Error(`Extracted empty or invalid UTF-8 domain name from Fake-TLS secret domain hex: "${domainHex}"`);
      }
    }

    return {
      mode: 'faketls',
      rawSecret,
      domain,
      defaultProtocolTag: PROTOCOL_PADDED_INTERMEDIATE,
    };
  }

  // 3. Standard Hex Secret: exactly 32 hex characters (16 bytes)
  if (clean.length !== 32) {
    throw new Error(`Invalid standard MTProxy secret length: expected 32 hex characters (16 bytes), got ${clean.length}`);
  }

  const rawSecret = Buffer.from(clean, 'hex');
  if (rawSecret.length !== 16) {
    throw new Error(`Invalid raw secret length: expected 16 bytes, got ${rawSecret.length}`);
  }

  return {
    mode: 'standard',
    rawSecret,
    defaultProtocolTag: PROTOCOL_INTERMEDIATE,
  };
}
