import crypto from 'node:crypto';
import {
  parseSecret,
  PROTOCOL_INTERMEDIATE,
  PROTOCOL_PADDED_INTERMEDIATE,
  PROTOCOL_ABRIDGED,
} from './secrets.js';

export {
  PROTOCOL_INTERMEDIATE,
  PROTOCOL_PADDED_INTERMEDIATE,
  PROTOCOL_ABRIDGED,
};

const FORBIDDEN_FIRST_INTS = new Set([
  0x44414548, // 'HEAD'
  0x54534f50, // 'POST'
  0x20544547, // 'GET '
  0x4954504f, // 'OPTI'
  0xdddddddd, // padded intermediate tag
  0xeeeeeeee, // intermediate tag
  0x02010316, // TLS ClientHello record tag
]);

export interface HandshakeResult {
  initialPacket: Buffer;
  encryptCipher: crypto.CipherGCM | crypto.Cipher;
  decryptCipher: crypto.DecipherGCM | crypto.Decipher;
  encryptKey: Buffer;
  encryptIv: Buffer;
  decryptKey: Buffer;
  decryptIv: Buffer;
  dcId: number;
  protocolTag: number;
}

/**
 * Creates the authentic MTProto Obfuscated2 64-byte handshake header
 * and initializes bidirectional AES-256-CTR stream ciphers.
 */
export function createHandshake(
  secretInput: string | Buffer,
  dcId: number = 2,
  protocolTagOverride?: number
): HandshakeResult {
  let rawSecret: Buffer;
  let protocolTag: number;

  if (Buffer.isBuffer(secretInput)) {
    if (secretInput.length !== 16) {
      throw new Error(`Raw secret buffer must be exactly 16 bytes, got ${secretInput.length}`);
    }
    rawSecret = secretInput;
    protocolTag = protocolTagOverride ?? PROTOCOL_INTERMEDIATE;
  } else {
    const parsed = parseSecret(secretInput);
    rawSecret = parsed.rawSecret;
    protocolTag = protocolTagOverride ?? parsed.defaultProtocolTag;
  }

  // Validate signed 16-bit dcId (-32768..32767)
  if (!Number.isInteger(dcId) || dcId < -32768 || dcId > 32767 || dcId === 0) {
    throw new Error(`Invalid signed dcId: must be a non-zero integer between -32768 and 32767. Got: ${dcId}`);
  }

  // Generate 64-byte header adhering to MTProto DPI evasion constraints
  let header: Buffer;
  while (true) {
    header = crypto.randomBytes(64);

    // Byte 0 must not equal 0xef (Abridged protocol tag)
    if (header[0] === 0xef) {
      continue;
    }

    // First 4 bytes must not match known HTTP verbs or protocol tags
    const firstInt = header.readUInt32LE(0);
    if (FORBIDDEN_FIRST_INTS.has(firstInt)) {
      continue;
    }

    // Second 4 bytes must not be 0
    const secondInt = header.readUInt32LE(4);
    if (secondInt === 0x00000000) {
      continue;
    }

    break;
  }

  // Bytes 56..59: Protocol Tag
  header.writeUInt32LE(protocolTag, 56);

  // Bytes 60..61: Signed 16-bit little-endian dcId
  header.writeInt16LE(dcId, 60);

  // Bytes 8..40: Key material
  const encKeyPart = header.subarray(8, 40);
  const encryptIv = Buffer.from(header.subarray(40, 56));

  const encryptKey = crypto
    .createHash('sha256')
    .update(Buffer.concat([encKeyPart, rawSecret]))
    .digest();

  // Reverse all 64 bytes for decrypt key & IV
  const rheader = Buffer.from(header).reverse();
  const decKeyPart = rheader.subarray(8, 40);
  const decryptIv = Buffer.from(rheader.subarray(40, 56));

  const decryptKey = crypto
    .createHash('sha256')
    .update(Buffer.concat([decKeyPart, rawSecret]))
    .digest();

  const encryptCipher = crypto.createCipheriv('aes-256-ctr', encryptKey, encryptIv);
  const decryptCipher = crypto.createDecipheriv('aes-256-ctr', decryptKey, decryptIv);

  // Encrypt the full 64-byte header (advancing cipher counter by 64 bytes)
  const encryptedHeader = encryptCipher.update(header);

  // Header encryption & substitution rule:
  // Bytes 0..55: Plaintext header
  // Bytes 56..63: Ciphertext from encryptedHeader[56..64]
  const initialPacket = Buffer.concat([
    header.subarray(0, 56),
    encryptedHeader.subarray(56, 64),
  ]);

  if (initialPacket.length !== 64) {
    throw new Error(`Internal error: constructed handshake packet length must be 64 bytes, got ${initialPacket.length}`);
  }

  return {
    initialPacket,
    encryptCipher,
    decryptCipher,
    encryptKey,
    encryptIv,
    decryptKey,
    decryptIv,
    dcId,
    protocolTag,
  };
}

/**
 * Stateful Obfuscated2 bidirectional streaming session
 */
export class Obfuscated2Session {
  private encryptCipher: crypto.Cipher;
  private decryptCipher: crypto.Decipher;
  readonly initialPacket: Buffer;
  readonly dcId: number;
  readonly protocolTag: number;

  constructor(
    secretInput: string | Buffer,
    dcId: number = 2,
    protocolTagOverride?: number
  ) {
    const handshake = createHandshake(secretInput, dcId, protocolTagOverride);
    this.initialPacket = handshake.initialPacket;
    this.encryptCipher = handshake.encryptCipher as crypto.Cipher;
    this.decryptCipher = handshake.decryptCipher as crypto.Decipher;
    this.dcId = handshake.dcId;
    this.protocolTag = handshake.protocolTag;
  }

  /**
   * Encrypt outbound payload to MTProxy TCP socket
   */
  encrypt(plaintext: Buffer): Buffer {
    if (!plaintext || plaintext.length === 0) {
      return Buffer.alloc(0);
    }
    return this.encryptCipher.update(plaintext);
  }

  /**
   * Decrypt inbound chunk from MTProxy TCP socket
   */
  decrypt(ciphertext: Buffer): Buffer {
    if (!ciphertext || ciphertext.length === 0) {
      return Buffer.alloc(0);
    }
    return this.decryptCipher.update(ciphertext);
  }
}
