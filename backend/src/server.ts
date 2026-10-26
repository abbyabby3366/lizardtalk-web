import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ProxyPool } from './proxy/pool.js';
import { HealthCheckManager } from './proxy/health.js';
import { createWebSocketRelay } from './relay/ws-relay.js';
import { createApiRouter } from './routes/api.js';

// Load .env from root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '8081', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Proxy Pool & Health Checker
const pool = new ProxyPool();
const healthManager = new HealthCheckManager(pool);

// Mount REST API
app.use('/api', createApiRouter(pool));

// JSON parsing & general error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  return res.status(500).json({ error: 'Internal Server Error' });
});

// Root info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'LizardTalk Backend Bridge',
    status: 'running',
    port,
    wsBridge: `ws://localhost:${port}/mtproxy`,
  });
});

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket Relay on /mtproxy
const { handleUpgrade } = createWebSocketRelay({ pool });
server.on('upgrade', (req, socket, head) => {
  handleUpgrade(req, socket, head);
});

// Export startServer for programmatic control
export function startServer(customPort?: number): Promise<http.Server> {
  const p = customPort || port;
  if (server.listening) {
    return Promise.resolve(server);
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, () => {
      server.removeListener('error', reject);
      console.log(`[LizardTalk Backend] Server listening on http://localhost:${p}`);
      console.log(`[LizardTalk Backend] WebSocket Bridge mounted at ws://localhost:${p}/mtproxy`);
      healthManager.start(10000);
      resolve(server);
    });
  });
}

// Auto-start if invoked directly via CLI (tsx watch src/server.ts or node dist/src/server.js)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].includes('server'));

if (isMain) {
  startServer().catch((err) => {
    console.error('[LizardTalk Backend] Failed to start server:', err);
    process.exit(1);
  });
}

// Graceful shutdown
const handleShutdown = () => {
  console.log('[LizardTalk Backend] Shutting down...');
  healthManager.stop();
  server.close(() => {
    console.log('[LizardTalk Backend] Server stopped.');
    process.exit(0);
  });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

export { app, server, pool, healthManager };
