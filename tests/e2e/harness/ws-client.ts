/**
 * WebSocket MTProxy Test Client
 * Connects to ws://localhost:8081/mtproxy?dcId=${dcId}
 * Sends and receives MTProto binary frames over WebSocket
 */

import { CONFIG } from './config.js';
import { MtprotoCodec } from './mtproto-codec.js';

export class WsMtproxyClient {
  public ws: WebSocket | null = null;
  private messageQueue: Buffer[] = [];
  private messageWaiters: ((data: Buffer) => void)[] = [];
  private closeListeners: ((ev: { code: number; reason: string }) => void)[] = [];
  private errorListeners: ((err: any) => void)[] = [];
  public isConnected = false;
  public closeCode: number | null = null;
  public closeReason: string | null = null;

  /**
   * Connect to bridge
   */
  async connect(
    dcId: number,
    options: {
      raw?: boolean;
      customUrl?: string;
      timeoutMs?: number;
      binaryType?: BinaryType;
    } = {}
  ): Promise<void> {
    const timeout = options.timeoutMs ?? CONFIG.TIMEOUTS.STANDARD;
    const baseUrl = options.customUrl ?? CONFIG.BACKEND_WS_URL;
    const url = new URL(baseUrl);
    url.searchParams.set('dcId', dcId.toString());
    if (options.raw) {
      url.searchParams.set('raw', '1');
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (this.ws) {
            try { this.ws.close(); } catch {}
          }
          reject(new Error(`WebSocket connection to ${url.toString()} timed out after ${timeout}ms`));
        }
      }, timeout);

      try {
        this.ws = new WebSocket(url.toString());
        this.ws.binaryType = options.binaryType ?? 'arraybuffer';

        this.ws.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.isConnected = true;
            resolve();
          }
        };

        this.ws.onerror = (err) => {
          for (const cb of this.errorListeners) cb(err);
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(new Error(`WebSocket connection failed to ${url.toString()}`));
          }
        };

        this.ws.onclose = (ev) => {
          this.isConnected = false;
          this.closeCode = ev.code;
          this.closeReason = ev.reason;
          for (const cb of this.closeListeners) {
            cb({ code: ev.code, reason: ev.reason });
          }
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(new Error(`WebSocket closed prematurely: code ${ev.code}, reason "${ev.reason}"`));
          }
        };

        this.ws.onmessage = (ev) => {
          let buf: Buffer;
          if (typeof ev.data === 'string') {
            buf = Buffer.from(ev.data);
          } else if (ev.data instanceof ArrayBuffer) {
            buf = Buffer.from(ev.data);
          } else if (Buffer.isBuffer(ev.data)) {
            buf = ev.data;
          } else {
            buf = Buffer.from(ev.data as any);
          }

          if (this.messageWaiters.length > 0) {
            const waiter = this.messageWaiters.shift()!;
            waiter(buf);
          } else {
            this.messageQueue.push(buf);
          }
        };
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  }

  /**
   * Send binary buffer
   */
  send(data: Buffer | Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected (readyState != OPEN)');
    }
    this.ws.send(data);
  }

  /**
   * Wait for next incoming binary message
   */
  async waitForMessage(timeoutMs: number = CONFIG.TIMEOUTS.STANDARD): Promise<Buffer> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.messageWaiters.indexOf(resolver);
        if (idx !== -1) {
          this.messageWaiters.splice(idx, 1);
        }
        reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`));
      }, timeoutMs);

      const resolver = (data: Buffer) => {
        clearTimeout(timer);
        resolve(data);
      };

      this.messageWaiters.push(resolver);
    });
  }

  /**
   * Send req_pq_multi packet and wait for resPQ response
   */
  async sendReqPqAndExpectResPq(
    framing: 'abridged' | 'intermediate' = 'intermediate',
    timeoutMs: number = CONFIG.TIMEOUTS.STANDARD
  ) {
    const { buffer: unencPq, nonce } = MtprotoCodec.createReqPqMulti();
    const frame =
      framing === 'abridged'
        ? MtprotoCodec.wrapAbridged(unencPq, true)
        : MtprotoCodec.wrapIntermediate(unencPq);

    this.send(frame);

    const rawResponse = await this.waitForMessage(timeoutMs);

    // Unpack framing:
    let packet: Buffer;
    if (framing === 'abridged') {
      let offset = 0;
      // In abridged framing, first byte is 0xef if protocol header, then length
      if (rawResponse[0] === 0xef) {
        offset = 1;
      }
      let len4 = rawResponse[offset++];
      if (len4 === 0x7f) {
        len4 = rawResponse.readUIntLE(offset, 3);
        offset += 3;
      }
      packet = rawResponse.subarray(offset);
    } else {
      // Intermediate: 4 byte LE length
      packet = rawResponse.subarray(4);
    }

    const resPq = MtprotoCodec.parseResPq(packet);
    return {
      resPq,
      originalNonce: nonce,
      rawResponse,
    };
  }

  onClose(cb: (ev: { code: number; reason: string }) => void) {
    this.closeListeners.push(cb);
  }

  onError(cb: (err: any) => void) {
    this.errorListeners.push(cb);
  }

  close(code?: number, reason?: string) {
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {}
      this.ws = null;
      this.isConnected = false;
    }
  }
}
