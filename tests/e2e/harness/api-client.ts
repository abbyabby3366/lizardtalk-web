/**
 * REST API Client for LizardTalk E2E Tests
 * Strictly opaque-box: interacts via HTTP endpoints
 */

import { CONFIG } from './config.js';

export interface ProxyRecord {
  id: string;
  host: string;
  port: number;
  secret: string;
  isDefault?: boolean;
  isOnline?: boolean;
  latencyMs?: number | null;
  lastChecked?: string;
  error?: string;
}

export interface ProxiesResponse {
  activeId: string;
  proxies: ProxyRecord[];
}

export interface HealthResponse {
  status: string;
  activeProxy?: ProxyRecord;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = CONFIG.BACKEND_HTTP_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err: any) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(`[Offline] Cannot connect to Backend at ${url} (Connection refused). Is the backend server running?`);
      }
      throw err;
    }
  }

  /**
   * Health endpoint: GET /api/health
   */
  async getHealth(): Promise<{ status: number; body: HealthResponse }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as HealthResponse;
    return { status: res.status, body };
  }

  /**
   * List proxies: GET /api/proxies
   */
  async getProxies(): Promise<{ status: number; body: ProxiesResponse }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/proxies`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as ProxiesResponse;
    return { status: res.status, body };
  }

  /**
   * Add proxy: POST /api/proxies
   */
  async addProxy(payload: {
    host: string;
    port: number;
    secret: string;
  }): Promise<{ status: number; body: ProxyRecord | { error: string } }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/proxies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as ProxyRecord | { error: string };
    return { status: res.status, body };
  }

  /**
   * Switch active proxy: POST /api/proxies/active
   */
  async setActiveProxy(id: string): Promise<{ status: number; body: { success?: boolean; activeId?: string; error?: string } }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/proxies/active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ id }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; activeId?: string; error?: string };
    return { status: res.status, body };
  }

  /**
   * Delete proxy: DELETE /api/proxies/:id
   */
  async deleteProxy(id: string): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/proxies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    return { status: res.status, body };
  }

  /**
   * Generic request helper for boundary tests (e.g. malformed JSON, invalid routes)
   */
  async rawRequest(
    path: string,
    options: RequestInit = {}
  ): Promise<{ status: number; headers: Headers; text: string; json: () => Promise<any> }> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const res = await this.safeFetch(url, options);
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: async () => JSON.parse(text),
    };
  }
}
