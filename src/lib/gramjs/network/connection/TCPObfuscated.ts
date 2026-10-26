import type { HttpStream, PromisedWebSockets } from '../../extensions';

import { bufferFromHex, concat, readUint32LE, writeUint32LE } from '../../../../util/encoding/buffer';
import { SecurityError } from '../../errors';

import { ObfuscatedConnection, PacketCodec } from './Connection';

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

  constructor(connection: ConnectionTCPObfuscated) {
    this.connection = connection.socket;
    // The local /mtproxy backend bridge performs the 64-byte MTProxy Obfuscated2
    // handshake and AES-256-CTR stream encryption/decryption with the proxy secret.
    this.header = new Uint8Array(0);
  }

  async read(n: number) {
    return this.connection.readExactly(n);
  }

  write(data: Uint8Array) {
    this.connection.write(data);
  }
}

export class ConnectionTCPObfuscated extends ObfuscatedConnection {
  ObfuscatedIO = ObfuscatedIO;

  PacketCodecClass = IntermediatePacketCodec;
}
