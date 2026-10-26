import net from 'node:net';
import crypto from 'node:crypto';
import { createHandshake, PROTOCOL_INTERMEDIATE } from '../crypto/obfuscated2.js';
import { ProxyPool, ProxyRecord } from './pool.js';

export interface HealthCheckResult {
  isOnline: boolean;
  latencyMs: number | null;
  error?: string;
  timestamp: string; // Full ISO 8601 string
}

/**
 * Performs a real live TCP + Obfuscated2 + req_pq_multi health probe against an MTProxy.
 */
export async function checkProxyHealth(
  proxy: ProxyRecord,
  timeoutMs: number = 4000
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  return new Promise<HealthCheckResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let socket: net.Socket | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
        socket = null;
      }
    };

    const done = (isOnline: boolean, latencyMs: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        isOnline,
        latencyMs,
        error,
        timestamp,
      });
    };

    timer = setTimeout(() => {
      done(false, null, `Connection timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      // 1. Generate authentic Obfuscated2 handshake header (targeting DC 2 or DC 5)
      const handshake = createHandshake(proxy.secret, 2, PROTOCOL_INTERMEDIATE);
      const { initialPacket, encryptCipher, decryptCipher } = handshake;

      socket = net.createConnection(
        {
          host: proxy.host,
          port: proxy.port,
        },
        () => {
          try {
            // Send 64-byte handshake header
            socket?.write(initialPacket);

            // Construct req_pq_multi packet (#be7e8ef1)
            const nonce = crypto.randomBytes(16);
            const now = Date.now();
            const msgId =
              (BigInt(Math.floor(now / 1000)) << 32n) |
              (BigInt((now % 1000) * 1000) << 12n);

            const msg = Buffer.alloc(40);
            msg.fill(0, 0, 8); // auth_key_id = 0
            msg.writeBigInt64LE(msgId, 8);
            msg.writeUInt32LE(20, 16); // length
            msg.writeUInt32LE(0xbe7e8ef1, 20); // req_pq_multi
            nonce.copy(msg, 24);

            // Intermediate framing: 4-byte LE length prefix
            const frame = Buffer.alloc(4 + msg.length);
            frame.writeUInt32LE(msg.length, 0);
            msg.copy(frame, 4);

            const encryptedFrame = (encryptCipher as crypto.Cipher).update(frame);
            socket?.write(encryptedFrame);
          } catch (err: any) {
            done(false, null, err.message || 'Error generating probe request');
          }
        }
      );

      let recvBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        try {
          const decrypted = (decryptCipher as crypto.Decipher).update(chunk);
          recvBuffer = Buffer.concat([recvBuffer, decrypted]);

          // Check if we received full intermediate frame
          if (recvBuffer.length >= 4) {
            const payloadLen = recvBuffer.readUInt32LE(0);
            if (recvBuffer.length >= 4 + payloadLen) {
              const packet = recvBuffer.subarray(4, 4 + payloadLen);
              if (packet.length >= 24) {
                const constructorId = packet.readUInt32LE(20);
                if (constructorId === 0x05162463) {
                  // Valid resPQ#05162463 received!
                  const latencyMs = Date.now() - startTime;
                  done(true, latencyMs);
                  return;
                }
              }
            }
          }
        } catch (err: any) {
          done(false, null, `Decryption error: ${err.message}`);
        }
      });

      socket.on('error', (err) => {
        done(false, null, `Socket error: ${err.message}`);
      });

      socket.on('close', () => {
        if (!settled) {
          done(false, null, 'Connection closed before handshake response');
        }
      });
    } catch (err: any) {
      done(false, null, `Initialization error: ${err.message}`);
    }
  });
}

/**
 * Health check manager that periodically checks all proxies in the pool
 * and triggers auto-failover if the active proxy fails.
 */
export class HealthCheckManager {
  private pool: ProxyPool;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;

  constructor(pool: ProxyPool) {
    this.pool = pool;
  }

  public async runHealthCheckCycle(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const proxies = this.pool.getAllProxies();
      for (const proxy of proxies) {
        const result = await checkProxyHealth(proxy);
        this.pool.updateProxyHealth(
          proxy.id,
          result.isOnline,
          result.latencyMs,
          result.error
        );
      }

      // Check if active proxy needs failover
      this.pool.autoFailover();
    } catch (err) {
      console.error('[HealthCheckManager] Error in health check cycle:', err);
    } finally {
      this.isChecking = false;
    }
  }

  public start(intervalMs: number = 10000): void {
    if (this.intervalTimer) return;

    // Run first cycle immediately in background
    this.runHealthCheckCycle().catch(console.error);

    this.intervalTimer = setInterval(() => {
      this.runHealthCheckCycle().catch(console.error);
    }, intervalMs);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
