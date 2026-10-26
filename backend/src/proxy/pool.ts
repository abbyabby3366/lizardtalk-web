import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSecret } from '../crypto/secrets.js';

export interface ProxyRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  secret: string;
  isDefault: boolean;
  isActive: boolean;
  isOnline: boolean;
  latencyMs: number | null;
  lastChecked: string | null; // ISO 8601 string
  error?: string;
  failCount: number;
  createdAt: string; // ISO 8601 string
  updatedAt: string; // ISO 8601 string
}

export interface ProxyState {
  activeId: string;
  proxies: ProxyRecord[];
}

export class ProxyPool {
  private proxies: Map<string, ProxyRecord> = new Map();
  private activeId: string = 'default-primary';
  private dataFilePath: string;

  constructor(customDataDir?: string) {
    const dataDir = customDataDir || path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFilePath = path.join(dataDir, 'proxies.json');
    this.initializePool();
  }

  private initializePool(): void {
    // If persistence file exists, load it
    if (fs.existsSync(this.dataFilePath)) {
      try {
        const raw = fs.readFileSync(this.dataFilePath, 'utf8');
        const parsed = JSON.parse(raw) as ProxyState;
        if (parsed && Array.isArray(parsed.proxies) && parsed.proxies.length > 0) {
          this.proxies.clear();
          for (const p of parsed.proxies) {
            this.proxies.set(p.id, p);
          }
          this.activeId = parsed.activeId || 'default-primary';
          return;
        }
      } catch (err) {
        console.warn('Failed to parse existing proxies.json, re-initializing pool with seeds:', err);
      }
    }

    // Initialize with primary default proxy
    const primaryHost = process.env.MTPROXY_HOST || '54.255.212.228';
    const primaryPort = parseInt(process.env.MTPROXY_PORT || '443', 10);
    const primarySecret =
      process.env.MTPROXY_SECRET || '6c465965316ffd1afb2f0e2b3ea90a86';

    const nowIso = new Date().toISOString();

    const defaultProxy: ProxyRecord = {
      id: 'default-primary',
      name: 'AWS Singapore Primary',
      host: primaryHost,
      port: primaryPort,
      secret: primarySecret,
      isDefault: true,
      isActive: true,
      isOnline: false,
      latencyMs: null,
      lastChecked: null,
      failCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.proxies.set(defaultProxy.id, defaultProxy);
    this.activeId = defaultProxy.id;

    // Seed backup proxies from grapefruittalk/proxies.json if accessible
    this.seedBackupProxies(nowIso);
    this.persist();
  }

  private seedBackupProxies(timestampIso: string): void {
    const seedPaths = [
      'c:\\Users\\desmo\\Desktop\\Skywalker\\TalkPro\\grapefruittalk\\proxies.json',
      path.resolve(process.cwd(), '../grapefruittalk/proxies.json'),
    ];

    let seeded = false;
    for (const p of seedPaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const backupList = JSON.parse(raw) as Array<{
            host: string;
            port: number;
            secret: string;
          }>;
          if (Array.isArray(backupList)) {
            backupList.forEach((item, index) => {
              const id = `backup-${index + 1}-${item.host.replace(/\./g, '-')}`;
              this.proxies.set(id, {
                id,
                name: `Backup Node ${index + 1} (${item.host})`,
                host: item.host,
                port: item.port,
                secret: item.secret,
                isDefault: false,
                isActive: false,
                isOnline: false,
                latencyMs: null,
                lastChecked: null,
                failCount: 0,
                createdAt: timestampIso,
                updatedAt: timestampIso,
              });
            });
            seeded = true;
            break;
          }
        } catch {
          // ignore error and try next path
        }
      }
    }

    // Fallback embedded seed list if external file was unreachable
    if (!seeded) {
      const embeddedBackups = [
        { host: '13.212.194.160', port: 443, secret: 'dff3036f9514d0c6eec1ca05aa49ffb2' },
        { host: '54.255.227.192', port: 443, secret: '6c465965316ffd1afb2f0e2b3ea90a86' },
        { host: '13.212.182.169', port: 443, secret: 'fb4905377b6f14c8555f8bbd493a3490' },
        { host: '54.179.190.119', port: 443, secret: 'e1ee1f67118ff3be0efbf410cf0eacb8' },
      ];
      embeddedBackups.forEach((item, index) => {
        const id = `backup-${index + 1}-${item.host.replace(/\./g, '-')}`;
        this.proxies.set(id, {
          id,
          name: `Backup Node ${index + 1} (${item.host})`,
          host: item.host,
          port: item.port,
          secret: item.secret,
          isDefault: false,
          isActive: false,
          isOnline: false,
          latencyMs: null,
          lastChecked: null,
          failCount: 0,
          createdAt: timestampIso,
          updatedAt: timestampIso,
        });
      });
    }
  }

  public persist(): void {
    const state: ProxyState = {
      activeId: this.activeId,
      proxies: Array.from(this.proxies.values()),
    };
    fs.writeFileSync(this.dataFilePath, JSON.stringify(state, null, 2), 'utf8');
  }

  public getAllProxies(): ProxyRecord[] {
    return Array.from(this.proxies.values());
  }

  public getActiveProxy(): ProxyRecord {
    const active = this.proxies.get(this.activeId);
    if (active) {
      return active;
    }
    // Fail loudly if active proxy is missing
    const defaultProxy = this.proxies.get('default-primary');
    if (defaultProxy) {
      this.activeId = defaultProxy.id;
      defaultProxy.isActive = true;
      return defaultProxy;
    }
    throw new Error('No active MTProto proxy configured in proxy pool');
  }

  public getProxyById(id: string): ProxyRecord | undefined {
    return this.proxies.get(id);
  }

  public addProxy(params: {
    host: string;
    port: number;
    secret: string;
    name?: string;
  }): ProxyRecord {
    const { host, port, secret, name } = params;

    // Strict validation
    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      throw new Error('Invalid proxy host: must be a non-empty string');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid proxy port: must be an integer between 1 and 65535, got ${port}`);
    }
    // Parse secret to ensure it is valid format
    parseSecret(secret);

    const nowIso = new Date().toISOString();
    const id = `custom-${crypto.randomBytes(4).toString('hex')}`;
    const record: ProxyRecord = {
      id,
      name: name && name.trim().length > 0 ? name.trim() : `Proxy ${host}:${port}`,
      host: host.trim(),
      port,
      secret: secret.trim(),
      isDefault: false,
      isActive: false,
      isOnline: false,
      latencyMs: null,
      lastChecked: null,
      failCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.proxies.set(id, record);
    this.persist();
    return record;
  }

  public setActiveProxy(id: string): ProxyRecord {
    const target = this.proxies.get(id);
    if (!target) {
      throw new Error(`Proxy not found with id: ${id}`);
    }

    for (const p of this.proxies.values()) {
      p.isActive = p.id === id;
      p.updatedAt = new Date().toISOString();
    }
    this.activeId = id;
    this.persist();
    return target;
  }

  public deleteProxy(id: string): { success: boolean; deletedId: string } {
    const target = this.proxies.get(id);
    if (!target) {
      throw new Error(`Proxy not found with id: ${id}`);
    }

    // MANDATORY CONSTRAINT: Cannot delete default primary proxy (return 403)
    if (target.isDefault) {
      const err = new Error('Cannot delete the default primary MTProto proxy.');
      (err as any).statusCode = 403;
      throw err;
    }

    this.proxies.delete(id);

    // If active was deleted, fall back to default primary
    if (this.activeId === id) {
      this.activeId = 'default-primary';
      const def = this.proxies.get('default-primary');
      if (def) {
        def.isActive = true;
      }
    }

    this.persist();
    return { success: true, deletedId: id };
  }

  public updateProxyHealth(
    id: string,
    isOnline: boolean,
    latencyMs: number | null,
    error?: string
  ): void {
    const proxy = this.proxies.get(id);
    if (!proxy) return;

    proxy.isOnline = isOnline;
    proxy.latencyMs = latencyMs;
    proxy.lastChecked = new Date().toISOString(); // Full ISO 8601 string
    proxy.updatedAt = proxy.lastChecked;

    if (isOnline) {
      proxy.failCount = 0;
      delete proxy.error;
    } else {
      proxy.failCount += 1;
      proxy.error = error;
    }

    this.persist();
  }

  public autoFailover(): ProxyRecord | null {
    const currentActive = this.getActiveProxy();
    // Only failover if current active has failed at least 3 consecutive times
    if (currentActive.failCount < 3) {
      return null;
    }

    // Find candidate proxies that are online, ordered by lowest latency
    const candidates = Array.from(this.proxies.values()).filter(
      (p) => p.id !== currentActive.id && p.isOnline && p.latencyMs !== null
    );

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    const nextProxy = candidates[0];

    console.warn(
      `[AUTO-FAILOVER] Active proxy ${currentActive.id} (${currentActive.host}:${currentActive.port}) failed ${currentActive.failCount} times. Failing over to ${nextProxy.id} (${nextProxy.host}:${nextProxy.port}, latency: ${nextProxy.latencyMs}ms)`
    );

    return this.setActiveProxy(nextProxy.id);
  }
}
