/**
 * MTProto 2.0 Diffie-Hellman Key Exchange Implementation
 *
 * Implements:
 * 1. req_pq_multi (#be7e8ef1)
 * 2. Pollard's rho PQ factorization
 * 3. req_DH_params (#d712e4be) with Telegram server RSA public key encryption
 * 4. AES-256-IGE answer decryption & DH parameters extraction
 * 5. set_client_DH_params (#f5045f1f)
 * 6. Verification of dh_gen_ok (#3bcbf734) & auth_key creation
 */

import crypto from 'node:crypto';

// Telegram Production Server RSA Public Keys
export interface TelegramRSAKey {
  fingerprint: bigint;
  fingerprintHex: string;
  n: bigint;
  e: bigint;
  pem: string;
}

export const TELEGRAM_PRODUCTION_RSA_KEYS: TelegramRSAKey[] = [
  {
    // Production Key 1: 0xd09d1d85de64fd85 (-3414540481677951611n)
    fingerprint: -3414540481677951611n,
    fingerprintHex: 'd09d1d85de64fd85',
    n: BigInt(
      '0x' +
        'e8bb3305c0b52c6cf2afdf7637313489e63e05268e5badb601af417786472e5f' +
        '93b85438968e20e6729a301c0afc121bf7151f834436f7fda680847a66bf64ac' +
        'cec78ee21c0b316f0edafe2f41908da7bd1f4a5107638eeb67040ace472a14f9' +
        '0d9f7c2b7def99688ba3073adb5750bb02964902a359fe745d8170e36876d4fd' +
        '8a5d41b2a76cbff9a13267eb9580b2d06d10357448d20d9da2191cb5d8c93982' +
        '961cdfdeda629e37f1fb09a0722027696032fe61ed663db7a37f6f263d370f69' +
        'db53a0dc0a1748bdaaff6209d5645485e6e001d1953255757e4b8e42813347b1' +
        '1da6ab500fd0ace7e6dfa3736199ccaf9397ed0745a427dcfa6cd67bcb1acff3'
    ),
    e: 65537n,
    pem:
      '-----BEGIN PUBLIC KEY-----\n' +
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6LszBcC1LGzyr992NzE0\n' +
      'ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9k\n' +
      'rM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO62cECs5HKhT5DZ98K33vmWiLowc621dQ\n' +
      'uwKWSQKjWf50XYFw42h21P2KXUGyp2y/+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5\n' +
      'gpYc397aYp438fsJoHIgJ2lgMv5h7WY9t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRU\n' +
      'hebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP\n' +
      '8wIDAQAB\n' +
      '-----END PUBLIC KEY-----',
  },
  {
    // Production Key 2: 0xbc35f3509f7b7a5 (847625836280919973n)
    fingerprint: 847625836280919973n,
    fingerprintHex: '0bc35f3509f7b7a5',
    n: BigInt(
      '0x' +
        'cabfb5f111815ad704a2993077755b6efc68997576595bc1bbdd1d668fc723f5' +
        'b7f439c2c2f6d89e578c7c9459ca5a072979e262176dd20a67d02213038a8e3f' +
        'd60c418659d8164b0f2095f9d1e34ff6be7fa3f769bc9ec24f92d47eaee79b94' +
        'c6fb58f965d1d6423d24e16d47cf5ccf71e549110d7bb85240c950266014e76a' +
        '555e5108cb67fa4b18bc8945cf45a1936359ddbfd48d0a3dcfca7845f0baea38' +
        'b6ee979cb1b539c381c15f4e69b0faeeab099958e998165cf3315a6b0cfa0b07' +
        '8b11b7dfcb7ffb2a0c78a086a07cfbf7a72d3e0ae97ef1550c609ecdd7ea80f6' +
        'dff5a1b329c3f3fa54bf565b90f48868c278fbff'
    ),
    e: 65537n,
    pem: '',
  },
  {
    // Production Key 3: 0xc3b42b026ce86b21 (-4344800451088585951n)
    fingerprint: -4344800451088585951n,
    fingerprintHex: 'c3b42b026ce86b21',
    n: BigInt(
      '0x' +
        'c9af0ebf1a300d890539f1c7d2427a1b643a6d3f2ef1c12df882d49931b6727d' +
        'e843c0c4a45a6c9a34a8e34c2c77d54483a992fb2b879a83eb9e3b3208008a0d' +
        '28ee6225447b853926941f71df42718e8d893ebfa4e7e60058e39818b292be97' +
        '7bb1e58e0a6d576a14702b85e0034a7dcfd3dcad805d212b694b96d99cd5b91b' +
        '848f696a41f6479f6fa1e138a0c20f1beea2189d9703666cb6e4c76ba29ca609' +
        '8c9cb6b6c0e86b038cbcdbe01449622d141e658ec3c015b6999b9cf99f2a7db7' +
        '10352ef2dc263884ffb57dc16fcf742917f69f2010874e402636ebef19d6a7e5' +
        '04ea4f4cbeab5f2dfcb41655d81f8f74a91976a1'
    ),
    e: 65537n,
    pem: '',
  },
];

// Helper: Greatest Common Divisor for BigInt
export function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

// Telegram official Brent cycle-finding factorization algorithm for 64-bit pq
export function factorizePQ(what: bigint): { p: bigint; q: bigint } {
  if (what % 2n === 0n) {
    const p = 2n;
    const q = what / 2n;
    return { p: p < q ? p : q, q: p < q ? q : p };
  }

  let g = 0n;
  for (let i = 0; i < 3; i++) {
    const t = BigInt(Math.floor(Math.random() * 16) + 17) % what;
    let x = (BigInt(Math.floor(Math.random() * 1000000) + 1) % (what - 1n)) + 1n;
    let y = x;
    const lim = 1 << (i + 18);

    for (let j = 1; j < lim; j++) {
      let a = x;
      let b = x;
      let c = t;
      while (b > 0n) {
        if (b & 1n) {
          c += a;
          if (c >= what) c -= what;
        }
        a += a;
        if (a >= what) a -= what;
        b >>= 1n;
      }
      x = c;
      const z = x < y ? what + x - y : x - y;
      g = gcd(z, what);
      if (g !== 1n) break;
      if ((j & (j - 1)) === 0) {
        y = x;
      }
    }
    if (g > 1n && g < what) break;
  }

  if (g <= 1n || g >= what) {
    throw new Error(`Failed to factorize pq = 0x${what.toString(16)}`);
  }

  const p = g;
  const q = what / g;
  return {
    p: p < q ? p : q,
    q: p < q ? q : p,
  };
}

// Modular exponentiation (base^exp mod mod)
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  let b = base % mod;
  let e = exp;

  while (e > 0n) {
    if (e & 1n) {
      res = (res * b) % mod;
    }
    e >>= 1n;
    b = (b * b) % mod;
  }
  return res;
}

// AES-256-IGE Encryption
export function aesIgeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (data.length % 16 !== 0) {
    throw new Error(`AES-IGE encryption requires data length to be a multiple of 16, got ${data.length}`);
  }
  if (key.length !== 32) {
    throw new Error(`AES-IGE requires 32-byte key, got ${key.length}`);
  }
  if (iv.length !== 32) {
    throw new Error(`AES-IGE requires 32-byte IV, got ${iv.length}`);
  }

  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(false);

  let iv0 = Buffer.from(iv.subarray(0, 16));
  let iv1 = Buffer.from(iv.subarray(16, 32));
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 16) {
    const block = data.subarray(i, i + 16);
    const xorIn = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      xorIn[j] = block[j] ^ iv0[j];
    }
    const enc = cipher.update(xorIn);
    const c = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      c[j] = enc[j] ^ iv1[j];
    }
    c.copy(out, i);
    iv0 = c;
    iv1 = Buffer.from(block);
  }

  return out;
}

// AES-256-IGE Decryption
export function aesIgeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (data.length % 16 !== 0) {
    throw new Error(`AES-IGE decryption requires data length to be a multiple of 16, got ${data.length}`);
  }
  if (key.length !== 32) {
    throw new Error(`AES-IGE requires 32-byte key, got ${key.length}`);
  }
  if (iv.length !== 32) {
    throw new Error(`AES-IGE requires 32-byte IV, got ${iv.length}`);
  }

  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(false);

  let iv0 = Buffer.from(iv.subarray(0, 16));
  let iv1 = Buffer.from(iv.subarray(16, 32));
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 16) {
    const block = data.subarray(i, i + 16);
    const xorIn = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      xorIn[j] = block[j] ^ iv1[j];
    }
    const dec = decipher.update(xorIn);
    const m = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      m[j] = dec[j] ^ iv0[j];
    }
    m.copy(out, i);
    iv0 = Buffer.from(block);
    iv1 = m;
  }

  return out;
}

// TL string serialization: encodes length prefix + payload + 4-byte padding
export function serializeBytes(b: Buffer): Buffer {
  if (b.length < 254) {
    const pad = (4 - ((b.length + 1) % 4)) % 4;
    return Buffer.concat([Buffer.from([b.length]), b, Buffer.alloc(pad)]);
  } else {
    const pad = (4 - (b.length % 4)) % 4;
    const len = Buffer.alloc(4);
    len[0] = 254;
    len.writeUIntLE(b.length, 1, 3);
    return Buffer.concat([len, b, Buffer.alloc(pad)]);
  }
}

// TL string deserialization
export function deserializeBytes(
  buf: Buffer,
  offset: number = 0
): { data: Buffer; totalLen: number } {
  let len = buf[offset];
  let head = 1;
  if (len === 254) {
    len = buf.readUIntLE(offset + 1, 3);
    head = 4;
  }
  const data = buf.subarray(offset + head, offset + head + len);
  const pad = (4 - ((head + len) % 4)) % 4;
  return {
    data: Buffer.from(data),
    totalLen: head + len + pad,
  };
}

export interface DHExchangeResult {
  authKey: Buffer;
  authKeyId: Buffer;
  timeDifference: number;
  serverTime: number;
  dcId: number;
}

/**
 * Executes complete MTProto 2.0 Diffie-Hellman Key Exchange
 * over a provided bi-directional MTProto message send/receive callback.
 */
export async function executeMTProtoDH(options: {
  sendPacket: (payload: Buffer) => Promise<Buffer>;
  dcId?: number;
}): Promise<DHExchangeResult> {
  const { sendPacket, dcId = 2 } = options;

  // ----------------------------------------------------
  // STEP 1: req_pq_multi (#be7e8ef1)
  // ----------------------------------------------------
  const nonce = crypto.randomBytes(16);
  const now = Date.now();
  const msgId =
    (BigInt(Math.floor(now / 1000)) << 32n) |
    (BigInt((now % 1000) * 1000) << 12n);

  const reqPqBody = Buffer.concat([
    Buffer.from([0xf1, 0x8e, 0x7e, 0xbe]), // constructor req_pq_multi#be7e8ef1
    nonce,
  ]);

  const reqPqMsg = Buffer.alloc(8 + 8 + 4 + reqPqBody.length);
  reqPqMsg.fill(0, 0, 8); // auth_key_id = 0
  reqPqMsg.writeBigInt64LE(msgId, 8);
  reqPqMsg.writeUInt32LE(reqPqBody.length, 16);
  reqPqBody.copy(reqPqMsg, 20);

  const resPqPacket = await sendPacket(reqPqMsg);
  if (!resPqPacket || resPqPacket.length < 24) {
    throw new Error(`Invalid or empty resPQ packet received (length: ${resPqPacket?.length ?? 0})`);
  }

  // Validate response
  const initialAuthKeyId = resPqPacket.subarray(0, 8);
  if (!initialAuthKeyId.equals(Buffer.alloc(8))) {
    throw new Error(`Unexpected non-zero authKeyId in resPQ response: ${initialAuthKeyId.toString('hex')}`);
  }

  const resPqCtor = resPqPacket.readUInt32LE(20);
  if (resPqCtor !== 0x05162463) {
    throw new Error(`Expected resPQ#05162463 constructor, received: 0x${resPqCtor.toString(16)}`);
  }

  const resPqBody = resPqPacket.subarray(20);
  const respNonce = resPqBody.subarray(4, 20);
  if (!respNonce.equals(nonce)) {
    throw new Error(`resPQ nonce mismatch: expected ${nonce.toString('hex')}, got ${respNonce.toString('hex')}`);
  }

  const serverNonce = resPqBody.subarray(20, 36);
  const pqTL = deserializeBytes(resPqBody, 36);
  const pqBytes = pqTL.data;

  // Extract server public key fingerprints
  let offset = 36 + pqTL.totalLen;
  const vectorCtor = resPqBody.readUInt32LE(offset);
  offset += 4;
  if (vectorCtor !== 0x1cb5c415) {
    throw new Error(`Expected Vector constructor 0x1cb5c415 for fingerprints, got 0x${vectorCtor.toString(16)}`);
  }

  const count = resPqBody.readUInt32LE(offset);
  offset += 4;
  const fingerprints: bigint[] = [];
  for (let i = 0; i < count; i++) {
    fingerprints.push(resPqBody.readBigInt64LE(offset));
    offset += 8;
  }

  // Match Telegram server RSA key
  let selectedKey: TelegramRSAKey | undefined;
  for (const fp of fingerprints) {
    const found = TELEGRAM_PRODUCTION_RSA_KEYS.find((k) => k.fingerprint === fp);
    if (found) {
      selectedKey = found;
      break;
    }
  }

  if (!selectedKey) {
    // If exact signed BigInt didn't match directly, try by unsigned hex
    for (const fp of fingerprints) {
      const uHex = BigInt.asUintN(64, fp).toString(16).padStart(16, '0');
      const found = TELEGRAM_PRODUCTION_RSA_KEYS.find(
        (k) => k.fingerprintHex === uHex
      );
      if (found) {
        selectedKey = found;
        break;
      }
    }
  }

  if (!selectedKey) {
    selectedKey = TELEGRAM_PRODUCTION_RSA_KEYS[0];
  }

  // ----------------------------------------------------
  // STEP 2: Pollard's rho PQ factorization
  // ----------------------------------------------------
  let pqBigInt = 0n;
  for (const b of pqBytes) {
    pqBigInt = (pqBigInt << 8n) | BigInt(b);
  }

  const { p, q } = factorizePQ(pqBigInt);
  const pBuf = Buffer.alloc(4);
  pBuf.writeUInt32BE(Number(p));
  const qBuf = Buffer.alloc(4);
  qBuf.writeUInt32BE(Number(q));

  // ----------------------------------------------------
  // STEP 3: req_DH_params (#d712e4be)
  // ----------------------------------------------------
  const newNonce = crypto.randomBytes(32);

  // Construct p_q_inner_data_dc#a9f55f95
  const targetDc = Math.abs(dcId) || 2;
  const innerBuf = Buffer.concat([
    Buffer.from([0x95, 0x5f, 0xf5, 0xa9]), // p_q_inner_data_dc
    serializeBytes(pqBytes),
    serializeBytes(pBuf),
    serializeBytes(qBuf),
    nonce,
    serverNonce,
    newNonce,
    Buffer.from([targetDc & 0xff, (targetDc >> 8) & 0xff, 0, 0]),
  ]);

  // MTProto 2.0 RSA encryption padding (192 bytes padded + reversed + AES-IGE)
  const innerPadded = Buffer.alloc(192);
  innerBuf.copy(innerPadded, 0);
  crypto.randomBytes(192 - innerBuf.length).copy(innerPadded, innerBuf.length);

  const reversedPadded = Buffer.alloc(192);
  for (let i = 0; i < 192; i++) {
    reversedPadded[i] = innerPadded[191 - i];
  }

  let rsaEncrypted: Buffer;
  while (true) {
    const tempKey = crypto.randomBytes(32);
    const hash = crypto
      .createHash('sha256')
      .update(Buffer.concat([tempKey, innerPadded]))
      .digest();
    const dataToEnc = Buffer.concat([reversedPadded, hash]);
    const aesEnc = aesIgeEncrypt(dataToEnc, tempKey, Buffer.alloc(32));
    const aesHash = crypto.createHash('sha256').update(aesEnc).digest();
    const tempKeyXor = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      tempKeyXor[i] = tempKey[i] ^ aesHash[i];
    }
    const enc256 = Buffer.concat([tempKeyXor, aesEnc]);
    const encVal = BigInt('0x' + enc256.toString('hex'));

    if (encVal < selectedKey.n) {
      const rsaVal = modPow(encVal, selectedKey.e, selectedKey.n);
      let rsaHex = rsaVal.toString(16);
      while (rsaHex.length < 512) {
        rsaHex = '0' + rsaHex;
      }
      rsaEncrypted = Buffer.from(rsaHex, 'hex');
      break;
    }
  }

  const fpBuffer = Buffer.alloc(8);
  fpBuffer.writeBigInt64LE(selectedKey.fingerprint);

  const reqDhBody = Buffer.concat([
    Buffer.from([0xbe, 0xe4, 0x12, 0xd7]), // req_DH_params#d712e4be
    nonce,
    serverNonce,
    serializeBytes(pBuf),
    serializeBytes(qBuf),
    fpBuffer,
    serializeBytes(rsaEncrypted),
  ]);

  const now2 = Date.now();
  const msgId2 =
    (BigInt(Math.floor(now2 / 1000)) << 32n) |
    (BigInt((now2 % 1000) * 1000) << 12n);

  const reqDhMsg = Buffer.alloc(8 + 8 + 4 + reqDhBody.length);
  reqDhMsg.fill(0, 0, 8);
  reqDhMsg.writeBigInt64LE(msgId2, 8);
  reqDhMsg.writeUInt32LE(reqDhBody.length, 16);
  reqDhBody.copy(reqDhMsg, 20);

  const resDhPacket = await sendPacket(reqDhMsg);

  // Validate server_DH_params_ok (#d0e8075c)
  const resDhCtor = resDhPacket.readUInt32LE(20);
  if (resDhCtor !== 0xd0e8075c) {
    throw new Error(`Expected server_DH_params_ok#d0e8075c, got constructor: 0x${resDhCtor.toString(16)}`);
  }

  const resDhBody = resDhPacket.subarray(20);
  const respDhNonce = resDhBody.subarray(4, 20);
  if (!respDhNonce.equals(nonce)) {
    throw new Error('server_DH_params_ok nonce mismatch');
  }

  const encAnswerTL = deserializeBytes(resDhBody, 36);
  const encAnswer = encAnswerTL.data;

  // ----------------------------------------------------
  // STEP 4: Decrypt server_DH_inner_data (#b5890dba)
  // ----------------------------------------------------
  const s1 = crypto
    .createHash('sha1')
    .update(Buffer.concat([newNonce, serverNonce]))
    .digest();
  const s2 = crypto
    .createHash('sha1')
    .update(Buffer.concat([serverNonce, newNonce]))
    .digest();
  const s3 = crypto
    .createHash('sha1')
    .update(Buffer.concat([newNonce, newNonce]))
    .digest();

  const tmpAesKey = Buffer.concat([s1, s2.subarray(0, 12)]);
  const tmpAesIv = Buffer.concat([
    s2.subarray(12, 20),
    s3,
    newNonce.subarray(0, 4),
  ]);

  const decryptedAnswer = aesIgeDecrypt(encAnswer, tmpAesKey, tmpAesIv);
  const innerAnswer = decryptedAnswer.subarray(20); // skip 20 bytes SHA1

  let aOff = 0;
  const innerCtor = innerAnswer.readUInt32LE(aOff);
  aOff += 4;
  if (innerCtor !== 0xb5890dba) {
    throw new Error(`Expected server_DH_inner_data#b5890dba, got: 0x${innerCtor.toString(16)}`);
  }

  aOff += 16; // skip nonce
  aOff += 16; // skip server_nonce
  const g = innerAnswer.readInt32LE(aOff);
  aOff += 4;

  const dhPrimeTL = deserializeBytes(innerAnswer, aOff);
  aOff += dhPrimeTL.totalLen;
  const dhPrimeBigInt = BigInt('0x' + dhPrimeTL.data.toString('hex'));

  const gATL = deserializeBytes(innerAnswer, aOff);
  aOff += gATL.totalLen;
  const gABigInt = BigInt('0x' + gATL.data.toString('hex'));

  const serverTime = innerAnswer.readInt32LE(aOff);
  const timeDifference = serverTime - Math.floor(Date.now() / 1000);

  // Generate 2048-bit random integer b
  const bBytes = crypto.randomBytes(256);
  const bBigInt = BigInt('0x' + bBytes.toString('hex'));

  const gBBigInt = modPow(BigInt(g), bBigInt, dhPrimeBigInt);
  let gBHex = gBBigInt.toString(16);
  if (gBHex.length % 2 !== 0) gBHex = '0' + gBHex;
  const gBBuf = Buffer.from(gBHex, 'hex');

  // Compute permanent authorization key auth_key = (g_a)^b mod dh_prime
  const authKeyBigInt = modPow(gABigInt, bBigInt, dhPrimeBigInt);
  let authKeyHex = authKeyBigInt.toString(16);
  while (authKeyHex.length < 512) {
    authKeyHex = '0' + authKeyHex;
  }
  const authKey = Buffer.from(authKeyHex, 'hex');

  // ----------------------------------------------------
  // STEP 5: set_client_DH_params (#f5045f1f)
  // ----------------------------------------------------
  const clientInner = Buffer.concat([
    Buffer.from([0x54, 0xb6, 0x43, 0x66]), // client_DH_inner_data#6643b654
    nonce,
    serverNonce,
    Buffer.alloc(8), // retry_id = 0
    serializeBytes(gBBuf),
  ]);

  const clientHash = crypto.createHash('sha1').update(clientInner).digest();
  let toEnc = Buffer.concat([clientHash, clientInner]);
  const addSize = (16 - (toEnc.length % 16)) % 16;
  if (addSize > 0) {
    toEnc = Buffer.concat([toEnc, crypto.randomBytes(addSize)]);
  }

  const encClientInner = aesIgeEncrypt(toEnc, tmpAesKey, tmpAesIv);

  const setClientDhBody = Buffer.concat([
    Buffer.from([0x1f, 0x5f, 0x04, 0xf5]), // set_client_DH_params#f5045f1f
    nonce,
    serverNonce,
    serializeBytes(encClientInner),
  ]);

  const now3 = Date.now();
  const msgId3 =
    (BigInt(Math.floor(now3 / 1000)) << 32n) |
    (BigInt((now3 % 1000) * 1000) << 12n);

  const setClientDhMsg = Buffer.alloc(8 + 8 + 4 + setClientDhBody.length);
  setClientDhMsg.fill(0, 0, 8);
  setClientDhMsg.writeBigInt64LE(msgId3, 8);
  setClientDhMsg.writeUInt32LE(setClientDhBody.length, 16);
  setClientDhBody.copy(setClientDhMsg, 20);

  const dhGenPacket = await sendPacket(setClientDhMsg);

  // Validate dh_gen_ok (#3bcbf734)
  const dhGenCtor = dhGenPacket.readUInt32LE(20);
  if (dhGenCtor !== 0x3bcbf734) {
    throw new Error(`Expected dh_gen_ok#3bcbf734, got constructor: 0x${dhGenCtor.toString(16)}`);
  }

  const authKeyId = crypto
    .createHash('sha1')
    .update(authKey)
    .digest()
    .subarray(12, 20);

  return {
    authKey,
    authKeyId,
    timeDifference,
    serverTime,
    dcId,
  };
}
