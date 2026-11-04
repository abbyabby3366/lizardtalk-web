import type { HttpStream, PromisedWebSockets } from '../../extensions';

import { bufferFromHex, concat, readUint32LE, writeUint32LE } from '../../../../util/encoding/buffer';
import { randomBytes } from '../../crypto/crypto';
import { CTR } from '../../crypto/CTR';
import { SecurityError } from '../../errors';

import { ObfuscatedConnection, PacketCodec } from './Connection';
import { AbridgedPacketCodec } from './TCPAbridged';

const TL_ALIGNMENT = 4;
const MAX_INTERMEDIATE_PACKET_LENGTH = 0xFFFFFF * TL_ALIGNMENT;

export class IntermediatePacketCodec extends PacketCodec {
  static tag = bufferFromHex('eeeeeeee');

  static obfuscateTag = bufferFromHex('eeeeeeee');

  private tag: Uint8Array;

  obfuscateTag: Uint8Array;

  constructor(props: any) {
    super(props);
    this.tag = IntermediatePacketCodec.tag;
    this.obfuscateTag = IntermediatePacketCodec.obfuscateTag;
  }

  encodePacket(data: Uint8Array) {
    if (
      !data.length
      || data.length % TL_ALIGNMENT !== 0
      || data.length > MAX_INTERMEDIATE_PACKET_LENGTH
    ) {
      throw new SecurityError('Invalid intermediate packet length');
    }

    const lengthBytes = new Uint8Array(4);
    writeUint32LE(lengthBytes, data.length);
    return concat(lengthBytes, data);
  }

  async readPacket(reader: PromisedWebSockets) {
    const lengthBytes = await reader.read(4);
    const packetLength = readUint32LE(lengthBytes);

    if (!packetLength || packetLength > MAX_INTERMEDIATE_PACKET_LENGTH) {
      throw new SecurityError('Invalid intermediate packet length');
    }

    const payload = await reader.read(packetLength);
    const alignedLength = packetLength - (packetLength % TL_ALIGNMENT);
    return alignedLength > 0 && alignedLength !== payload.length
      ? payload.slice(0, alignedLength)
      : payload;
  }
}

class ObfuscatedIO {
  header?: Uint8Array = undefined;

  private connection: PromisedWebSockets | HttpStream;

  private _encrypt?: CTR;

  private _decrypt?: CTR;

  constructor(connection: ConnectionTCPObfuscated) {
    this.connection = connection.socket;
    const isDirect = Boolean((this.connection as PromisedWebSockets).isDirectConnection);
    if (!isDirect) {
      // The local /mtproxy backend bridge performs the 64-byte MTProxy Obfuscated2
      // handshake and AES-256-CTR stream encryption/decryption with the proxy secret.
      this.header = new Uint8Array(0);
      return;
    }

    // Direct / VPN Mode: perform standard client-side Telegram Obfuscated2 AES-256-CTR handshake
    const res = this.initHeader(connection._codec);
    this.header = res.random;
    this._encrypt = res.encryptor;
    this._decrypt = res.decryptor;
  }

  initHeader(packetCodec: { obfuscateTag: Uint8Array }) {
    const keywords = [
      0x44414548, // HEAD
      0x54534f50, // POST
      0x20544547, // GET
      0x4954504f, // OPTI
      0xeeeeeeee,
      0xdddddddd,
      0x02010316,
    ];
    let random: Uint8Array;

    while (true) {
      random = randomBytes(64);
      const val1 = readUint32LE(random, 0);
      const val2 = readUint32LE(random, 4);
      if (random[0] !== 0xef && !keywords.includes(val1) && val2 !== 0x00000000) {
        break;
      }
    }

    const randomReversed = random.slice(8, 56).reverse();
    const encryptKey = random.slice(8, 40);
    const encryptIv = random.slice(40, 56);
    const decryptKey = randomReversed.slice(0, 32);
    const decryptIv = randomReversed.slice(32, 48);

    const encryptor = new CTR(encryptKey, encryptIv);
    const decryptor = new CTR(decryptKey, decryptIv);

    random.set(packetCodec.obfuscateTag, 56);
    const encryptedRandom = encryptor.encrypt(random);
    random.set(encryptedRandom.subarray(56, 64), 56);

    return {
      random,
      encryptor,
      decryptor,
    };
  }

  async read(n: number) {
    const data = await this.connection.readExactly(n);
    return this._decrypt ? this._decrypt.decrypt(data) : data;
  }

  write(data: Uint8Array) {
    this.connection.write(this._encrypt ? this._encrypt.encrypt(data) : data);
  }
}

export class ConnectionTCPObfuscated extends ObfuscatedConnection {
  ObfuscatedIO = ObfuscatedIO;

  PacketCodecClass: typeof PacketCodec = IntermediatePacketCodec;

  declare _codec: any;

  async _initConn() {
    if ((this.socket as PromisedWebSockets).isDirectConnection) {
      this._codec = new AbridgedPacketCodec(this);
    }
    await super._initConn();
  }
}
