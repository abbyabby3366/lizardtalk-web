import { Mutex } from 'async-mutex';

const closeError = new Error('WebSocket was closed');
const CONNECTION_TIMEOUT = 3000;
const MAX_TIMEOUT = 30000;

export const PROXY_DISABLED_STORAGE_KEY = 'lizardtalk_proxy_disabled';
export const NET_STATS_CHANNEL_NAME = 'lizardtalk-net-stats';

let runtimeProxyDisabled: boolean = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(PROXY_DISABLED_STORAGE_KEY) === '1';
    }
  } catch {
    // Ignore localStorage error in worker context
  }
  try {
    if (typeof self !== 'undefined' && typeof self.name === 'string' && self.name.length > 0) {
      return new URLSearchParams(self.name).get('proxyDisabled') === '1';
    }
  } catch {
    // Ignore URLSearchParams error
  }
  return false;
})();

let clientRxBytes = 0;
let clientTxBytes = 0;
let clientActiveConnections = 0;
const clientDcCounts = new Map<number, number>();
const activeSockets = new Set<PromisedWebSockets>();
let broadcastTimer: ReturnType<typeof setTimeout> | undefined;

const netStatsChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(NET_STATS_CHANNEL_NAME)
  : undefined;

function forceReconnectActiveSockets() {
  for (const sock of Array.from(activeSockets)) {
    sock.forceDisconnectForReconnect();
  }
  scheduleNetStatsBroadcast();
}

if (netStatsChannel) {
  netStatsChannel.onmessage = (event) => {
    const data = event.data;
    if (data && data.type === 'proxyModeChanged' && typeof data.proxyDisabled === 'boolean') {
      const modeChanged = runtimeProxyDisabled !== data.proxyDisabled;
      runtimeProxyDisabled = data.proxyDisabled;
      if (modeChanged || data.forceReconnect) {
        forceReconnectActiveSockets();
      } else {
        scheduleNetStatsBroadcast();
      }
    }
  };
}

export function notifyProxyConfigChanged(proxyDisabled: boolean, forceReconnect = true) {
  const modeChanged = runtimeProxyDisabled !== proxyDisabled;
  runtimeProxyDisabled = proxyDisabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROXY_DISABLED_STORAGE_KEY, proxyDisabled ? '1' : '0');
    }
  } catch {
    // Ignore storage error
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(NET_STATS_CHANNEL_NAME);
      channel.postMessage({
        type: 'proxyModeChanged',
        proxyDisabled,
        forceReconnect,
      });
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel error
  }
  if (modeChanged || forceReconnect) {
    forceReconnectActiveSockets();
  }
}

function scheduleNetStatsBroadcast() {
  if (!netStatsChannel || broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = undefined;
    const connectionsByDc: Record<string, number> = {};
    for (const [dc, count] of clientDcCounts.entries()) {
      connectionsByDc[`DC${dc}`] = count;
    }
    try {
      netStatsChannel.postMessage({
        type: 'clientNetStats',
        rxBytes: clientRxBytes,
        txBytes: clientTxBytes,
        activeConnections: clientActiveConnections,
        connectionsByDc,
        isDirectMode: runtimeProxyDisabled,
        timestamp: Date.now(),
      });
    } catch {
      // Ignore BroadcastChannel errors
    }
  }, 250);
}

export function isMtProxyDisabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(PROXY_DISABLED_STORAGE_KEY) === '1';
    }
  } catch {
    // Fallback to runtime state in Web Worker
  }
  return runtimeProxyDisabled;
}

export default class PromisedWebSockets {
  private readonly mutex = new Mutex();

  private closed: boolean;

  private timeout: number;

  // Received bytes are kept as a queue of chunks so neither receiving nor reading
  // re-copies the whole pending buffer (avoids quadratic copying on large media responses)
  private chunks: Uint8Array[] = [];

  private availableBytes = 0;

  private canRead?: boolean | Promise<boolean>;

  private resolveRead: ((value?: any) => void) | undefined;

  private client: WebSocket | undefined;

  private website?: string;

  private disconnectedCallback: () => void;

  private connectedDcId?: number;

  private disconnect?: () => void;

  public isDirectConnection = false;

  constructor(disconnectedCallback: () => void) {
    this.client = undefined;
    this.closed = true;
    this.disconnectedCallback = disconnectedCallback;
    this.timeout = CONNECTION_TIMEOUT;
  }

  async readExactly(number: number) {
    const client = this.client;
    const firstChunk = await this.read(number);
    if (this.closed || this.client !== client) throw closeError;
    if (firstChunk.length === number) {
      return firstChunk;
    }

    const readData = new Uint8Array(number);
    readData.set(firstChunk, 0);
    let offset = firstChunk.length;

    while (offset < number) {
      const thisTime = await this.read(number - offset);
      if (this.closed || this.client !== client) throw closeError;
      readData.set(thisTime, offset);
      offset += thisTime.length;
    }

    return readData;
  }

  async read(number: number) {
    const client = this.client;
    if (this.closed) {
      throw closeError;
    }
    const ready = await this.canRead;
    if (!ready || this.closed || this.client !== client) {
      throw closeError;
    }
    const toReturn = this.takeBytes(Math.min(number, this.availableBytes));
    if (this.availableBytes === 0) {
      this.canRead = new Promise((resolve) => {
        this.resolveRead = resolve;
      });
    }

    return toReturn;
  }

  async readAll() {
    const client = this.client;
    if (this.closed || !await this.canRead || this.closed || this.client !== client) {
      throw closeError;
    }
    const toReturn = this.takeBytes(this.availableBytes);
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });

    return toReturn;
  }

  private resetBuffer() {
    this.chunks = [];
    this.availableBytes = 0;
  }

  private pushChunk(data: Uint8Array) {
    if (!data.length) return;
    this.chunks.push(data);
    this.availableBytes += data.length;
  }

  // Copies out exactly `count` bytes; the unread remainder of a chunk is kept as a zero-copy view
  private takeBytes(count: number): Uint8Array {
    if (count <= 0) return new Uint8Array(0);

    const first = this.chunks[0];
    if (first.length >= count) {
      // A fully consumed chunk is exclusively owned by the reader. Partial reads
      // still copy so a small retained header cannot pin a large receive buffer.
      const result = first.length === count ? first : first.slice(0, count);
      if (first.length === count) {
        this.chunks.shift();
      } else {
        this.chunks[0] = first.subarray(count);
      }
      this.availableBytes -= count;
      return result;
    }

    const result = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const chunk = this.chunks[0];
      const needed = count - offset;
      if (chunk.length <= needed) {
        result.set(chunk, offset);
        offset += chunk.length;
        this.chunks.shift();
      } else {
        result.set(chunk.subarray(0, needed), offset);
        this.chunks[0] = chunk.subarray(needed);
        offset += needed;
      }
    }
    this.availableBytes -= count;
    return result;
  }

  getWebSocketLink(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean, dcId = 2) {
    if (isMtProxyDisabled()) {
      this.isDirectConnection = true;
      const protocol = port === 443 ? 'wss' : 'ws';
      return `${protocol}://${ip}:${port}/apiws${isTestServer ? '_test' : ''}${isPremium ? '_premium' : ''}`;
    }

    this.isDirectConnection = false;
    const isMedia = ip.includes('-1') || dcId < 0;
    const signedDcId = isMedia ? -Math.abs(dcId) : Math.abs(dcId);
    const globalScope = typeof window !== 'undefined'
      ? (window as any)
      : (typeof self !== 'undefined' ? (self as any) : undefined);
    const bridgeUrl = (globalScope && globalScope.LIZARDTALK_BRIDGE_WS)
      || import.meta.env?.VITE_MTPROXY_BRIDGE_URL
      || 'ws://localhost:8081/mtproxy';

    return `${bridgeUrl}?dcId=${signedDcId}${isTestServer ? '&test=1' : ''}${isPremium ? '&premium=1' : ''}`;
  }

  connect(port: number, ip: string, isTestServer = false, isPremium = false, dcId = 2) {
    this.close();
    this.resetBuffer();
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
    this.closed = false;
    this.website = this.getWebSocketLink(ip, port, isTestServer, isPremium, dcId);
    this.client = new WebSocket(this.website, 'binary');
    this.client.binaryType = 'arraybuffer';
    const client = this.client;
    activeSockets.add(this);
    const isMedia = ip.includes('-1') || dcId < 0;
    const signedDcId = isMedia ? -Math.abs(dcId) : Math.abs(dcId);

    return new Promise((resolve, reject) => {
      let hasResolved = false;
      let finished = false;
      let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;

      const onOffline = () => this.close();
      const finish = () => {
        if (finished) return;
        finished = true;
        this.disconnect = undefined;
        if (timeout) clearTimeout(timeout);
        self.removeEventListener('offline', onOffline);
        // DOM event handlers use null to remove the callback.
        /* eslint-disable no-null/no-null */
        client.onopen = null;
        client.onerror = null;
        client.onclose = null;
        client.onmessage = null;
        /* eslint-enable no-null/no-null */
        activeSockets.delete(this);

        if (!hasResolved) {
          reject(closeError);
          hasResolved = true;
        }
        if (this.connectedDcId !== undefined) {
          const dc = this.connectedDcId;
          this.connectedDcId = undefined;
          clientActiveConnections = Math.max(0, clientActiveConnections - 1);
          const count = clientDcCounts.get(dc) || 0;
          if (count <= 1) {
            clientDcCounts.delete(dc);
          } else {
            clientDcCounts.set(dc, count - 1);
          }
          scheduleNetStatsBroadcast();
        }

        this.closed = true;
        this.resolveRead?.(false);
        this.resetBuffer();
        try {
          client.close();
        } finally {
          this.disconnectedCallback();
        }
      };
      this.disconnect = finish;

      client.onopen = () => {
        if (finished) return;
        this.timeout = CONNECTION_TIMEOUT;
        this.connectedDcId = signedDcId;
        clientActiveConnections += 1;
        clientDcCounts.set(signedDcId, (clientDcCounts.get(signedDcId) || 0) + 1);
        scheduleNetStatsBroadcast();
        this.receive();
        resolve(this);
        hasResolved = true;
        if (timeout) clearTimeout(timeout);
      };

      client.onerror = (error) => {
        // eslint-disable-next-line no-console
        console.error('WebSocket error', error);
        reject(error);
        hasResolved = true;
        finish();
      };

      client.onclose = (event) => {
        const { code, reason, wasClean } = event;
        if (code !== 1000) {
          // eslint-disable-next-line no-console
          console.error(`Socket ${ip} closed. Code: ${code}, reason: ${reason}, was clean: ${wasClean}`);
        }

        finish();
      };

      timeout = setTimeout(() => {
        if (hasResolved) return;

        reject(new Error('WebSocket connection timeout'));
        hasResolved = true;
        this.timeout *= 2;
        this.timeout = Math.min(this.timeout, MAX_TIMEOUT);
        timeout = undefined;
        finish();
      }, this.timeout);

      self.addEventListener('offline', onOffline);
    });
  }

  write(data: Uint8Array) {
    if (this.closed || this.client?.readyState !== WebSocket.OPEN) {
      throw closeError;
    }
    // WebSocket.send snapshots the view; avoid another full packet copy here.
    const payload = data.buffer instanceof ArrayBuffer
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    this.client.send(payload);
    clientTxBytes += data.byteLength;
    scheduleNetStatsBroadcast();
  }

  close() {
    this.disconnect?.();
  }

  forceDisconnectForReconnect() {
    this.close();
  }

  receive() {
    if (!this.client) return;
    const client = this.client;
    client.onmessage = async (message) => {
      if (this.closed || this.client !== client) return;
      if (message.data instanceof ArrayBuffer) {
        const data = new Uint8Array(message.data);
        clientRxBytes += data.byteLength;
        scheduleNetStatsBroadcast();
        this.pushChunk(data);
        this.resolveRead?.(true);
        return;
      }
      await this.mutex.runExclusive(async () => {
        const data = new Uint8Array(await new Response(message.data).arrayBuffer());
        if (this.closed || this.client !== client) return;
        clientRxBytes += data.byteLength;
        scheduleNetStatsBroadcast();
        this.pushChunk(data);
        this.resolveRead?.(true);
      });
    };
  }
}
