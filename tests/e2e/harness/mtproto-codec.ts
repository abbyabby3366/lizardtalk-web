/**
 * MTProto 2.0 & Obfuscated2 Codec Utilities
 * Authoritative derivation from Telegram MTProto specification and TDLib source
 */

import crypto from 'node:crypto';

export class MtprotoCodec {
  /**
   * Generate an unencrypted MTProto message envelope
   */
  static createUnencryptedMessage(payload: Buffer): Buffer {
    const authKeyId = Buffer.alloc(8, 0); // 8 zero bytes for unencrypted message
    
    // Message ID: unix timestamp in seconds * 2^32 + millisecond offset, must be odd-ish (low 2 bits usually 0/1)
    const now = Date.now();
    const seconds = Math.floor(now / 1000);
    const fraction = (now % 1000) * 4194304; // scale ms to high part of low 32 bits
    const msgId = (BigInt(seconds) << 32n) | BigInt(fraction);
    
    const msgIdBuf = Buffer.alloc(8);
    msgIdBuf.writeBigUInt64LE(msgId, 0);
    
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32LE(payload.length, 0);
    
    return Buffer.concat([authKeyId, msgIdBuf, lengthBuf, payload]);
  }

  /**
   * Create req_pq_multi payload:
   * Constructor: 0xbe7e8ef1 (LE)
   * Nonce: 16 random bytes
   */
  static createReqPqMulti(nonce?: Buffer): { buffer: Buffer; nonce: Buffer } {
    const n = nonce || crypto.randomBytes(16);
    const constructorId = Buffer.from([0xf1, 0x8e, 0x7e, 0xbe]); // 0xbe7e8ef1 in little endian
    const payload = Buffer.concat([constructorId, n]);
    return {
      buffer: this.createUnencryptedMessage(payload),
      nonce: n,
    };
  }

  /**
   * Wrap unencrypted message in Abridged transport frame
   * If isFirstPacket, prepend 0xef
   */
  static wrapAbridged(packet: Buffer, isFirstPacket = false): Buffer {
    const len4 = Math.ceil(packet.length / 4);
    let header: Buffer;
    if (len4 < 127) {
      header = Buffer.from([len4]);
    } else {
      header = Buffer.alloc(4);
      header[0] = 0x7f;
      header.writeUIntLE(len4, 1, 3);
    }

    if (isFirstPacket) {
      return Buffer.concat([Buffer.from([0xef]), header, packet]);
    }
    return Buffer.concat([header, packet]);
  }

  /**
   * Wrap unencrypted message in Intermediate transport frame (4-byte LE length)
   */
  static wrapIntermediate(packet: Buffer): Buffer {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(packet.length, 0);
    return Buffer.concat([lenBuf, packet]);
  }

  /**
   * Parse resPQ response from decrypted MTProto packet
   * Constructor resPQ: 0x05162463
   */
  static parseResPq(data: Buffer): {
    authKeyId: string;
    msgId: string;
    constructorId: number;
    nonce: Buffer;
    serverNonce: Buffer;
    pq: Buffer;
    fingerprints: bigint[];
  } {
    if (data.length < 20) {
      throw new Error(`Data too short for MTProto message: ${data.length} bytes`);
    }

    const authKeyId = data.subarray(0, 8).toString('hex');
    const msgId = data.readBigUInt64LE(8).toString(16);
    const msgLen = data.readUInt32LE(16);
    const body = data.subarray(20, 20 + msgLen);

    if (body.length < 4) {
      throw new Error(`Body too short: ${body.length}`);
    }

    const constructorId = body.readUInt32LE(0);
    if (constructorId !== 0x05162463) {
      throw new Error(`Expected resPQ (0x05162463), got 0x${constructorId.toString(16)}`);
    }

    const nonce = body.subarray(4, 20);
    const serverNonce = body.subarray(20, 36);

    // Read TL string (length byte + bytes + padding)
    let offset = 36;
    let pqLen = body[offset++];
    let pqBytes: Buffer;
    if (pqLen === 254) {
      pqLen = body.readUIntLE(offset, 3);
      offset += 3;
    }
    pqBytes = body.subarray(offset, offset + pqLen);
    offset += pqLen;
    // Align to 4 bytes
    while (offset % 4 !== 0) {
      offset++;
    }

    // Read vector of fingerprints
    const vectorCons = body.readUInt32LE(offset);
    offset += 4;
    const fingerprints: bigint[] = [];
    if (vectorCons === 0x1cb5c415) { // Vector constructor
      const count = body.readUInt32LE(offset);
      offset += 4;
      for (let i = 0; i < count; i++) {
        fingerprints.push(body.readBigInt64LE(offset));
        offset += 8;
      }
    }

    return {
      authKeyId,
      msgId,
      constructorId,
      nonce,
      serverNonce,
      pq: pqBytes,
      fingerprints,
    };
  }

  /**
   * Obfuscated2 Handshake Generator
   * Generates 64-byte random header, hashes encrypt/decrypt keys with proxy secret,
   * embeds protocol tag and signed dcId, and returns encrypted header & ciphers.
   */
  static createObfuscated2Header(
    dcId: number,
    secretHex: string,
    protocolTag: number = 0xeeeeeeee
  ): {
    header: Buffer;
    encryptCipher: crypto.CipherGCM | crypto.Cipher;
    decryptCipher: crypto.DecipherGCM | crypto.Decipher;
  } {
    const secret = Buffer.from(secretHex, 'hex');
    let header: Buffer;
    
    // Avoid forbidden keywords in header[0..4]
    while (true) {
      header = crypto.randomBytes(64);
      const val0 = header.readUInt32LE(0);
      if (
        header[0] !== 0xef &&
        val0 !== 0x44414548 && // 'HEAD'
        val0 !== 0x54534f50 && // 'POST'
        val0 !== 0x20544547 && // 'GET '
        val0 !== 0x4954504f && // 'OPTI'
        val0 !== 0xeeeeeeee &&
        val0 !== 0xdddddddd
      ) {
        break;
      }
    }

    // Set protocol tag at bytes 56..60
    header.writeUInt32LE(protocolTag, 56);
    // Set signed 16-bit dcId at bytes 60..62
    header.writeInt16LE(dcId, 60);

    const reversed = Buffer.from(header).reverse();

    // Encrypt key & IV
    const encKeySeed = Buffer.concat([header.subarray(8, 40), secret]);
    const encKey = crypto.createHash('sha256').update(encKeySeed).digest();
    const encIv = header.subarray(40, 56);

    // Decrypt key & IV (from reversed header)
    const decKeySeed = Buffer.concat([reversed.subarray(8, 40), secret]);
    const decKey = crypto.createHash('sha256').update(decKeySeed).digest();
    const decIv = reversed.subarray(40, 56);

    const encryptCipher = crypto.createCipheriv('aes-256-ctr', encKey, encIv);
    const decryptCipher = crypto.createDecipheriv('aes-256-ctr', decKey, decIv);

    // Encrypt the header to consume 64 bytes of keystream
    const encrypted = encryptCipher.update(header);
    
    // Copy the encrypted tail (bytes 56..64) into the header
    encrypted.copy(header, 56, 56, 64);

    return {
      header,
      encryptCipher,
      decryptCipher,
    };
  }

  /**
   * Pollard's rho algorithm to factor pq into p and q
   */
  static factorizePq(pqBytes: Buffer): { p: bigint; q: bigint } {
    const pq = BigInt('0x' + pqBytes.toString('hex'));
    
    function gcd(a: bigint, b: bigint): bigint {
      while (b !== 0n) {
        const t = b;
        b = a % b;
        a = t;
      }
      return a;
    }

    let x = 2n;
    let y = 2n;
    let d = 1n;
    const c = 1n;

    const f = (val: bigint) => (val * val + c) % pq;

    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      const diff = x > y ? x - y : y - x;
      d = gcd(diff, pq);
    }

    if (d === pq) {
      throw new Error(`Failed to factorize pq: ${pq.toString(16)}`);
    }

    const p = d;
    const q = pq / p;

    return p < q ? { p, q } : { p: q, q: p };
  }
}
