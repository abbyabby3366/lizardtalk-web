/**
 * E2E Test Suite Configuration
 * Authoritative values derived from ORIGINAL_REQUEST.md and PROJECT.md
 */

export const CONFIG = {
  BACKEND_HTTP_URL: process.env.VITE_BRIDGE_HTTP_URL || 'http://localhost:8081',
  BACKEND_WS_URL: process.env.VITE_MTPROXY_BRIDGE_URL || 'ws://localhost:8081/mtproxy',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:8293',
  
  // Authoritative Primary Proxy credentials
  PRIMARY_PROXY: {
    host: '54.255.212.228',
    port: 443,
    secret: '6c465965316ffd1afb2f0e2b3ea90a86',
  },

  // Authoritative Telegram API credentials
  TELEGRAM: {
    API_ID: 32242400,
    API_HASH: 'ec7df2d6a2563d8e49ac2759388e9719',
  },

  // Seed backup proxies from grapefruittalk/proxies.json
  SEED_BACKUP_PROXIES: [
    { host: '13.212.194.160', port: 443, secret: 'dff3036f9514d0c6eec1ca05aa49ffb2' },
    { host: '54.255.227.192', port: 443, secret: '6c465965316ffd1afb2f0e2b3ea90a86' },
    { host: '13.212.182.169', port: 443, secret: 'fb4905377b6f14c8555f8bbd493a3490' },
    { host: '54.179.190.119', port: 443, secret: 'e1ee1f67118ff3be0efbf410cf0eacb8' },
  ],

  // Timeouts in milliseconds
  TIMEOUTS: {
    FAST_CHECK: 3000,
    STANDARD: 8000,
    LONG: 15000,
  },
};
