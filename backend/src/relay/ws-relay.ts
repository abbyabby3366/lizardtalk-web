import http from 'node:http';
import net from 'node:net';
import stream from 'node:stream';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ProxyPool } from '../proxy/pool.js';
import {
  createHandshake,
  PROTOCOL_INTERMEDIATE,
  PROTOCOL_PADDED_INTERMEDIATE,
  PROTOCOL_ABRIDGED,
} from '../crypto/obfuscated2.js';

export interface WSRelayOptions {
  pool: ProxyPool;
}

export function createWebSocketRelay(options: { pool: ProxyPool }): {
  wss: WebSocketServer;
  handleUpgrade: (
    req: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer
  ) => void;
} {
  const { pool } = options;
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const isRaw = urlObj.searchParams.get('raw') === '1';

    // Parse dcId: default to 2 if unspecified, support signed integers (-5..5)
    let dcId = 2;
    const dcParam = urlObj.searchParams.get('dcId') || urlObj.searchParams.get('dc');
    if (dcParam) {
      const parsedDc = parseInt(dcParam, 10);
      if (!isNaN(parsedDc) && parsedDc !== 0) {
        dcId = parsedDc;
      }
    }

    // Protocol tag override if requested
    let protocolTagOverride: number | undefined;
    const protoParam = urlObj.searchParams.get('protocol');
    if (protoParam === 'abridged' || protoParam === '0xefefefef') {
      protocolTagOverride = PROTOCOL_ABRIDGED;
    } else if (protoParam === 'intermediate' || protoParam === '0xeeeeeeee') {
      protocolTagOverride = PROTOCOL_INTERMEDIATE;
    } else if (protoParam === 'padded' || protoParam === '0xdddddddd') {
      protocolTagOverride = PROTOCOL_PADDED_INTERMEDIATE;
    }

    let activeProxy;
    try {
      activeProxy = pool.getActiveProxy();
    } catch (err: any) {
      console.error('[WSRelay] No active proxy available:', err.message);
      ws.close(1011, 'No active proxy available in pool');
      return;
    }

    let tcpSocket: net.Socket | null = null;
    let isTcpConnected = false;
    const pendingClientMessages: Buffer[] = [];

    // Mode-specific setup
    let encryptCipher: crypto.Cipher | null = null;
    let decryptCipher: crypto.Decipher | null = null;
    let handshakeHeader: Buffer | null = null;

    if (!isRaw) {
      try {
        const handshake = createHandshake(
          activeProxy.secret,
          dcId,
          protocolTagOverride
        );
        handshakeHeader = handshake.initialPacket;
        encryptCipher = handshake.encryptCipher as crypto.Cipher;
        decryptCipher = handshake.decryptCipher as crypto.Decipher;
      } catch (err: any) {
        console.error('[WSRelay] Failed to initialize Obfuscated2 handshake:', err.message);
        ws.close(1011, `Handshake init error: ${err.message}`);
        return;
      }
    }

    // Connect to active MTProxy TCP endpoint
    tcpSocket = net.createConnection(
      {
        host: activeProxy.host,
        port: activeProxy.port,
      },
      () => {
        isTcpConnected = true;

        if (!isRaw && handshakeHeader) {
          // Transmit 64-byte Obfuscated2 handshake
          tcpSocket?.write(handshakeHeader);
        }

        // Flush queued messages from WebSocket client
        while (pendingClientMessages.length > 0) {
          const msg = pendingClientMessages.shift();
          if (msg && tcpSocket) {
            if (!isRaw && encryptCipher) {
              const encrypted = encryptCipher.update(msg);
              tcpSocket.write(encrypted);
            } else {
              tcpSocket.write(msg);
            }
          }
        }
      }
    );

    // Inbound from MTProxy TCP socket -> Client WebSocket
    tcpSocket.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (!isRaw && decryptCipher) {
          try {
            const decrypted = decryptCipher.update(chunk);
            ws.send(decrypted, { binary: true });
          } catch (err: any) {
            console.error('[WSRelay] Decryption error:', err.message);
            cleanup();
          }
        } else {
          ws.send(chunk, { binary: true });
        }
      }
    });

    // Inbound from Client WebSocket -> MTProxy TCP socket
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      let buf: Buffer;
      if (Buffer.isBuffer(data)) {
        buf = data;
      } else if (data instanceof ArrayBuffer) {
        buf = Buffer.from(data);
      } else if (Array.isArray(data)) {
        buf = Buffer.concat(data);
      } else {
        buf = Buffer.from(data as any);
      }

      if (!isTcpConnected || !tcpSocket) {
        pendingClientMessages.push(buf);
        return;
      }

      try {
        if (!isRaw && encryptCipher) {
          const encrypted = encryptCipher.update(buf);
          tcpSocket.write(encrypted);
        } else {
          tcpSocket.write(buf);
        }
      } catch (err: any) {
        console.error('[WSRelay] TCP write error:', err.message);
        cleanup();
      }
    });

    const cleanup = () => {
      if (tcpSocket) {
        tcpSocket.removeAllListeners();
        tcpSocket.destroy();
        tcpSocket = null;
      }
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };

    ws.on('close', () => {
      cleanup();
    });

    ws.on('error', (err) => {
      console.warn('[WSRelay] WebSocket client error:', err.message);
      cleanup();
    });

    tcpSocket.on('close', () => {
      cleanup();
    });

    tcpSocket.on('error', (err) => {
      console.warn(`[WSRelay] TCP socket error to ${activeProxy.host}:${activeProxy.port}:`, err.message);
      cleanup();
    });
  });

  const handleUpgrade = (
    req: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer
  ) => {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    if (urlObj.pathname === '/mtproxy') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  };

  return { wss, handleUpgrade };
}
