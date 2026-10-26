/**
 * Tier 1 Feature Tests: MTProxy Cryptographic Handshake
 * Feature 5
 * Verifies Obfuscated2 header derivation, secrets parsing, AES-256-CTR keystream
 */

import { registerTest, assert, assertEquals } from '../harness/test-utils.js';
import { MtprotoCodec } from '../harness/mtproto-codec.js';
import { CONFIG } from '../harness/config.js';
import crypto from 'node:crypto';

export function registerTier1CryptoHandshakeTests() {
  // Test 1: 64-byte Obfuscated2 header format and non-forbidden magic bytes
  registerTest(1, 'Crypto Handshake', 'T1.4.1: Obfuscated2 header is 64 bytes with valid magic and tag', async () => {
    const { header } = MtprotoCodec.createObfuscated2Header(2, CONFIG.PRIMARY_PROXY.secret, 0xeeeeeeee);
    assertEquals(header.length, 64, 'Header length must be exactly 64 bytes');
    
    // Check bytes 0..3 are not forbidden HTTP verbs
    const val0 = header.readUInt32LE(0);
    assert(val0 !== 0x44414548, 'Header must not start with HEAD');
    assert(val0 !== 0x54534f50, 'Header must not start with POST');
    assert(val0 !== 0x20544547, 'Header must not start with GET ');
    assert(header[0] !== 0xef, 'Header byte 0 must not be 0xef');
  });

  // Test 2: Keystream state alignment (bytes 56..64 encrypted)
  registerTest(1, 'Crypto Handshake', 'T1.4.2: Keystream consumes exactly 64 bytes on handshake', async () => {
    const secret = Buffer.from(CONFIG.PRIMARY_PROXY.secret, 'hex');
    const { header, decryptCipher } = MtprotoCodec.createObfuscated2Header(2, CONFIG.PRIMARY_PROXY.secret, 0xeeeeeeee);

    // Decrypt the header using the server's perspective (client -> server uses header[8..40])
    const decKeySeed = Buffer.concat([header.subarray(8, 40), secret]);
    const decKey = crypto.createHash('sha256').update(decKeySeed).digest();
    const decIv = header.subarray(40, 56);
    const serverDecipher = crypto.createDecipheriv('aes-256-ctr', decKey, decIv);

    const decrypted = serverDecipher.update(header);
    // At bytes 56..60, protocol tag 0xeeeeeeee should appear
    const tag = decrypted.readUInt32LE(56);
    assertEquals(tag, 0xeeeeeeee, 'Decrypted protocol tag must be 0xeeeeeeee');
    // At bytes 60..62, signed dcId should appear
    const dcId = decrypted.readInt16LE(60);
    assertEquals(dcId, 2, 'Decrypted dcId must be 2');
  });

  // Test 3: Standard 16-byte hex secret parsing
  registerTest(1, 'Crypto Handshake', 'T1.4.3: Validates standard 16-byte hex secret parsing', async () => {
    const standardSecret = '6c465965316ffd1afb2f0e2b3ea90a86';
    const buf = Buffer.from(standardSecret, 'hex');
    assertEquals(buf.length, 16, 'Standard secret must parse to 16 bytes');
    assertEquals(buf.toString('hex'), standardSecret, 'Hex roundtrip must match');
  });

  // Test 4: Padded intermediate secret (dd prefix)
  registerTest(1, 'Crypto Handshake', 'T1.4.4: Validates dd-prefixed padded intermediate secret', async () => {
    const ddSecret = 'dd6c465965316ffd1afb2f0e2b3ea90a86';
    assert(ddSecret.startsWith('dd'), 'Secret should start with dd');
    const rawSecret = ddSecret.slice(2);
    const buf = Buffer.from(rawSecret, 'hex');
    assertEquals(buf.length, 16, 'Stripped secret must be 16 bytes');
  });

  // Test 5: Fake-TLS secret (ee prefix + SNI domain)
  registerTest(1, 'Crypto Handshake', 'T1.4.5: Validates ee-prefixed Fake-TLS secret and domain extraction', async () => {
    // Example Fake-TLS secret: ee + 16 bytes hex + hex domain (e.g. cloudflare.com = 636c6f7564666c6172652e636f6d)
    const fakeTlsSecret = 'ee6c465965316ffd1afb2f0e2b3ea90a86636c6f7564666c6172652e636f6d';
    assert(fakeTlsSecret.startsWith('ee'), 'Fake-TLS secret should start with ee');
    const hexWithoutPrefix = fakeTlsSecret.slice(2);
    const coreSecretHex = hexWithoutPrefix.slice(0, 32);
    const domainHex = hexWithoutPrefix.slice(32);
    const domain = Buffer.from(domainHex, 'hex').toString('utf8');

    assertEquals(coreSecretHex, '6c465965316ffd1afb2f0e2b3ea90a86', 'Core secret matches');
    assertEquals(domain, 'cloudflare.com', 'Domain extraction matches');
  });
}
