import { Mutex } from 'async-mutex';

import { concat } from '../../../util/encoding/buffer';

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

  private stream: Uint8Array;

  private canRead?: boolean | Promise<boolean>;

  private resolveRead: ((value?: any) => void) | undefined;

  private client: WebSocket | undefined;

  private website?: string;

  private disconnectedCallback: () => void;

  private connectedDcId?: number;

  public isDirectConnection = false;

  constructor(disconnectedCallback: () => void) {
    this.client = undefined;
    this.closed = true;
    this.stream = new Uint8Array(0);
    this.disconnectedCallback = disconnectedCallback;
    this.timeout = CONNECTION_TIMEOUT;
  }

  async readExactly(number: number) {
    const firstChunk = await this.read(number);
    if (firstChunk.length === number) {
      return firstChunk;
    }

    const readData = new Uint8Array(number);
    readData.set(firstChunk, 0);
    let offset = firstChunk.length;

    while (offset < number) {
      const thisTime = await this.read(number - offset);
      readData.set(thisTime, offset);
      offset += thisTime.length;
    }

    return readData;
  }

  async read(number: number) {
    if (this.closed) {
      throw closeError;
    }
    await this.canRead;
    if (this.closed) {
      throw closeError;
    }
    const toReturn = this.stream.slice(0, number);
    this.stream = this.stream.slice(number);
    if (this.stream.length === 0) {
      this.canRead = new Promise((resolve) => {
        this.resolveRead = resolve;
      });
    }

    return toReturn;
  }

  async readAll() {
    if (this.closed || !await this.canRead) {
      throw closeError;
    }
    const toReturn = this.stream;
    this.stream = new Uint8Array(0);
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });

    return toReturn;
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
    this.stream = new Uint8Array(0);
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
    this.closed = false;
    this.website = this.getWebSocketLink(ip, port, isTestServer, isPremium, dcId);
    this.client = new WebSocket(this.website, 'binary');
    this.client.binaryType = 'arraybuffer';
    activeSockets.add(this);
    const isMedia = ip.includes('-1') || dcId < 0;
    const signedDcId = isMedia ? -Math.abs(dcId) : Math.abs(dcId);

    return new Promise((resolve, reject) => {
      if (!this.client) return;
      let hasResolved = false;
      let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;

      this.client.onopen = () => {
        this.connectedDcId = signedDcId;
        clientActiveConnections += 1;
        clientDcCounts.set(signedDcId, (clientDcCounts.get(signedDcId) || 0) + 1);
        scheduleNetStatsBroadcast();
        this.receive();
        resolve(this);
        hasResolved = true;
        if (timeout) clearTimeout(timeout);
      };

      this.client.onerror = (error) => {
        activeSockets.delete(this);
        // eslint-disable-next-line no-console
        console.error('WebSocket error', error);
        reject(error);
        hasResolved = true;
        if (timeout) clearTimeout(timeout);
      };

      this.client.onclose = (event) => {
        activeSockets.delete(this);
        const { code, reason, wasClean } = event;
        if (code !== 1000) {
          // eslint-disable-next-line no-console
          console.error(`Socket ${ip} closed. Code: ${code}, reason: ${reason}, was clean: ${wasClean}`);
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

        this.resolveRead?.(false);
        this.closed = true;
        if (this.disconnectedCallback) {
          this.disconnectedCallback();
        }
        hasResolved = true;
        if (timeout) clearTimeout(timeout);
      };

      timeout = setTimeout(() => {
        if (hasResolved) return;

        activeSockets.delete(this);
        reject(new Error('WebSocket connection timeout'));
        this.resolveRead?.(false);
        this.closed = true;
        if (this.disconnectedCallback) {
          this.disconnectedCallback();
        }
        this.client?.close();
        this.timeout *= 2;
        this.timeout = Math.min(this.timeout, MAX_TIMEOUT);
        timeout = undefined;
      }, this.timeout);

      // CONTEST
      // Seems to not be working, at least in a web worker

      self.addEventListener('offline', () => {
        this.close();
        this.resolveRead?.(false);
      });
    });
  }

  write(data: Uint8Array) {
    if (this.closed) {
      throw closeError;
    }
    clientTxBytes += data.byteLength;
    scheduleNetStatsBroadcast();
    this.client?.send(new Uint8Array(data));
  }

  close() {
    activeSockets.delete(this);
    this.client?.close();
    this.closed = true;
  }

  forceDisconnectForReconnect() {
    activeSockets.delete(this);
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
    }
    this.closed = true;
    this.resolveRead?.(false);
    if (this.disconnectedCallback) {
      this.disconnectedCallback();
    }
    try {
      this.client?.close();
    } catch {
      // Ignore close error
    }
  }

  receive() {
    if (!this.client) return;
    this.client.onmessage = async (message) => {
      if (message.data instanceof ArrayBuffer) {
        const data = new Uint8Array(message.data);
        clientRxBytes += data.byteLength;
        scheduleNetStatsBroadcast();
        this.stream = this.stream.length === 0 ? data : concat(this.stream, data);
        this.resolveRead?.(true);
        return;
      }
      await this.mutex.runExclusive(async () => {
        const data = new Uint8Array(await new Response(message.data).arrayBuffer());
        clientRxBytes += data.byteLength;
        scheduleNetStatsBroadcast();
        this.stream = this.stream.length === 0 ? data : concat(this.stream, data);
        this.resolveRead?.(true);
      });
    };
  }
}
