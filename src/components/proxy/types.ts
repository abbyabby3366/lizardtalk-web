export interface ProxyRecord {
  id: string;
  name?: string;
  host: string;
  port: number;
  secret: string;
  isDefault: boolean;
  isActive?: boolean;
  isOnline: boolean;
  latencyMs: number | null;
  lastChecked: string | null; // ISO 8601 string
  error?: string;
  failCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProxyListResponse {
  activeId: string;
  proxies: ProxyRecord[];
}
