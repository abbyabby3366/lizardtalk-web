import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PromisedWebSockets from './PromisedWebSockets';

class MockWebSocket {
  static OPEN = 1;

  static instances: MockWebSocket[] = [];

  readyState = 0;

  binaryType = '';

  onopen?: () => void;

  onclose?: (event: { code: number; reason: string; wasClean: boolean }) => void;

  onerror?: (event: Event) => void;

  onmessage?: (event: { data: ArrayBuffer }) => void;

  send = vi.fn();

  close = vi.fn(() => { this.readyState = 3; });

  constructor() {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }

  receive(bytes: number[]) {
    const data = new Uint8Array(bytes).buffer;
    this.onmessage?.({ data });
    return data;
  }
}

describe('MTProto WebSocket transport', () => {
  let socket: PromisedWebSockets;
  let onDisconnect: ReturnType<typeof vi.fn>;

  const connect = () => {
    const promise = socket.connect(443, 'pluto.web.telegram.org');
    return { promise, client: MockWebSocket.instances.at(-1)! };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    onDisconnect = vi.fn();
    socket = new PromisedWebSockets(onDisconnect);
  });

  afterEach(() => {
    socket.close();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects a connection closed before opening instead of waiting forever', async () => {
    const { promise, client } = connect();
    const rejected = expect(promise).rejects.toThrow('WebSocket was closed');
    client.serverClose();
    await rejected;
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('releases pending reads and notifies disconnection only once on a forced reconnect', async () => {
    const { promise, client } = connect();
    client.open();
    await promise;
    const read = expect(socket.readExactly(4)).rejects.toThrow('WebSocket was closed');
    socket.forceDisconnectForReconnect();
    client.serverClose();
    socket.close();
    await read;
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('removes offline listeners after every connection', async () => {
    const add = vi.spyOn(self, 'addEventListener');
    const remove = vi.spyOn(self, 'removeEventListener');
    for (let i = 0; i < 3; i++) {
      const { promise, client } = connect();
      client.open();
      await promise;
      socket.close();
    }
    const listeners = add.mock.calls.filter(([type]) => type === 'offline');
    expect(listeners).toHaveLength(3);
    for (const [, listener] of listeners) {
      expect(remove).toHaveBeenCalledWith('offline', listener);
    }
    self.dispatchEvent(new Event('offline'));
    expect(onDisconnect).toHaveBeenCalledTimes(3);
  });

  it('resets timeout backoff after a successful connection', async () => {
    const first = connect();
    const rejected = expect(first.promise).rejects.toThrow('connection timeout');
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    const second = connect();
    await vi.advanceTimersByTimeAsync(3000);
    expect(second.client.close).not.toHaveBeenCalled();
    second.client.open();
    await second.promise;
    socket.close();
    const third = connect();
    const thirdRejected = expect(third.promise).rejects.toThrow('connection timeout');
    await vi.advanceTimersByTimeAsync(3000);
    await thirdRejected;
  });

  it('ignores a late message from the previous connection', async () => {
    const first = connect();
    first.client.open();
    await first.promise;
    const lateMessage = first.client.onmessage!;
    socket.close();
    const second = connect();
    second.client.open();
    await second.promise;
    lateMessage({ data: new Uint8Array([99]).buffer });
    second.client.receive([1, 2]);
    expect(await socket.readExactly(2)).toEqual(new Uint8Array([1, 2]));
  });

  it.each(['read', 'readExactly', 'readAll'] as const)(
    'does not let a pending %s consume bytes from an immediate reconnect', async (method) => {
      const first = connect();
      first.client.open();
      await first.promise;
      // Also cover an already-resolved read waiter for readAll.
      if (method === 'readAll') first.client.receive([99]);
      const pending = method === 'readAll' ? socket.readAll() : socket[method](2);
      const rejected = expect(pending).rejects.toThrow('WebSocket was closed');
      socket.close();
      const second = connect();
      second.client.open();
      second.client.receive([1, 2]);
      await second.promise;
      await rejected;
      expect(await socket.readExactly(2)).toEqual(new Uint8Array([1, 2]));
    },
  );

  it('rejects a connection cancelled by going offline', async () => {
    const { promise, client } = connect();
    const rejected = expect(promise).rejects.toThrow('WebSocket was closed');
    self.dispatchEvent(new Event('offline'));
    await rejected;
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('cleans up an error before open without waiting for a close event', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { promise, client } = connect();
    const error = new Event('error');
    const rejected = expect(promise).rejects.toBe(error);
    client.onerror?.(error);
    await rejected;
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('reassembles fragmented packets and preserves subsequent packet bytes', async () => {
    const { promise, client } = connect();
    client.open();
    await promise;
    client.receive([1, 2]);
    const read = socket.readExactly(5);
    await Promise.resolve();
    client.receive([3]);
    client.receive([4, 5, 6, 7]);
    expect(await read).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(await socket.readExactly(2)).toEqual(new Uint8Array([6, 7]));
  });

  it('hands a fully consumed receive chunk to the reader without copying', async () => {
    const { promise, client } = connect();
    client.open();
    await promise;
    const buffer = client.receive([1, 2, 3]);
    const read = await socket.readExactly(3);
    expect(read.buffer).toBe(buffer);
  });

  it('sends only the requested view without allocating another packet buffer', async () => {
    const { promise, client } = connect();
    client.open();
    await promise;
    const bytes = new Uint8Array([99, 1, 2, 88]);
    socket.write(bytes.subarray(1, 3));
    const sent = client.send.mock.calls[0][0] as Uint8Array;
    expect(sent).toEqual(new Uint8Array([1, 2]));
    expect(sent.buffer).toBe(bytes.buffer);
  });

  it('rejects writes when the browser is closing instead of silently losing data', async () => {
    const { promise, client } = connect();
    client.open();
    await promise;
    client.readyState = 2;
    expect(() => socket.write(new Uint8Array([1]))).toThrow('WebSocket was closed');
    expect(client.send).not.toHaveBeenCalled();
  });
});
