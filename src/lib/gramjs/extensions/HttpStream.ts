import { concat } from '../../../util/encoding/buffer';

const closeError = new Error('HttpStream was closed');
const REQUEST_TIMEOUT = 30000;

export class HttpStreamError extends Error {
  readonly status: number;

  constructor(response: Response) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    super(`HttpStream request failed: ${response.status}${statusText}`);
    this.name = 'HttpStreamError';
    this.status = response.status;
  }
}

export default class HttpStream {
  private url: string | undefined;

  private isClosed: boolean;

  private abortController?: AbortController;

  private stream: Uint8Array[] = [];

  private canRead: Promise<void> = Promise.resolve();

  private resolveRead: VoidFunction | undefined;

  private rejectRead: ((reason?: unknown) => void) | undefined;

  private disconnectedCallback: VoidFunction | undefined;

  constructor(disconnectedCallback: VoidFunction) {
    this.isClosed = true;
    this.disconnectedCallback = disconnectedCallback;
  }

  async readExactly(number: number) {
    let readData = new Uint8Array(0);

    while (true) {
      const thisTime = await this.read();
      readData = concat(readData, thisTime);
      number -= thisTime.length;
      if (number <= 0) {
        return readData;
      }
    }
  }

  async read() {
    const abortController = this.abortController;
    while (!this.isClosed && this.abortController === abortController && !this.stream.length) {
      await this.canRead;
    }
    if (this.isClosed || this.abortController !== abortController) throw closeError;

    const data = this.stream.shift()!;
    if (this.stream.length === 0) {
      this.canRead = new Promise((resolve, reject) => {
        this.resolveRead = resolve;
        this.rejectRead = reject;
      });
      void this.canRead.catch(() => undefined);
    }

    return data;
  }

  static getURL(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean) {
    return '';
  }

  static getHttpUrl(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean) {
    return HttpStream.getURL(ip, port, isTestServer, isPremium);
  }

  connect(port: number, ip: string, isTestServer = false, isPremium = false, _dcId?: number) {
    throw new Error('MTProto over HTTP without proxy bridge is disabled');
  }

  write(_data: Uint8Array): Promise<void> {
    throw new Error('MTProto over HTTP without proxy bridge is disabled');
  }

  handleDisconnect(err: unknown) {
    if (this.isClosed) return;

    this.isClosed = true;
    this.rejectRead?.(err);
    this.abortController?.abort();
    this.abortController = undefined;
    this.disconnectedCallback?.();
  }

  close() {
    this.handleDisconnect(closeError);
  }
}
