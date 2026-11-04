import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { ProxyPool } from '../proxy/pool.js';
import { checkProxyHealth } from '../proxy/health.js';
import { relayStats } from '../relay/ws-relay.js';

const SPEEDTEST_CHUNK_SIZE = 64 * 1024;
const speedtestChunkBuffer = crypto.randomBytes(SPEEDTEST_CHUNK_SIZE);

export function createApiRouter(pool: ProxyPool): Router {
  const router = Router();

  /**
   * GET /api/proxies
   * Returns list of configured proxies and the active proxy ID.
   */
  router.get('/proxies', (req: Request, res: Response) => {
    try {
      const activeProxy = pool.getActiveProxy();
      const proxies = pool.getAllProxies();
      res.json({
        activeId: activeProxy.id,
        proxyEnabled: pool.isProxyEnabled(),
        proxies,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/proxies
   * Adds a new proxy to the pool and immediately tests its health.
   */
  router.post('/proxies', async (req: Request, res: Response) => {
    const { host, port, secret, name } = req.body || {};

    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      res.status(400).json({ error: 'Field "host" is required and must be a valid non-empty string.' });
      return;
    }

    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      res.status(400).json({ error: 'Field "port" is required and must be an integer between 1 and 65535.' });
      return;
    }

    if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
      res.status(400).json({ error: 'Field "secret" is required and must be a valid non-empty string.' });
      return;
    }

    try {
      const newProxy = pool.addProxy({
        host: host.trim(),
        port: portNum,
        secret: secret.trim(),
        name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined,
      });

      // Run immediate health check in background / await
      const health = await checkProxyHealth(newProxy);
      pool.updateProxyHealth(
        newProxy.id,
        health.isOnline,
        health.latencyMs,
        health.error
      );

      const updatedProxy = pool.getProxyById(newProxy.id);
      res.status(201).json(updatedProxy || newProxy);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /api/proxies/active
   * Switches the active proxy in the pool.
   */
  router.post('/proxies/active', (req: Request, res: Response) => {
    const { id } = req.body || {};
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Field "id" is required to set active proxy.' });
      return;
    }

    try {
      const activeProxy = pool.setActiveProxy(id);
      pool.setProxyEnabled(true);
      relayStats.closeAllConnections('Switched active MTProxy');
      res.json({
        success: true,
        activeId: activeProxy.id,
        proxyEnabled: pool.isProxyEnabled(),
        activeProxy,
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  /**
   * POST /api/proxies/mode
   * Manually turns the MTProto proxy ON (true) or OFF (false — Direct / VPN mode).
   */
  router.post('/proxies/mode', (req: Request, res: Response) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Field "enabled" (boolean) is required.' });
      return;
    }

    try {
      const proxyEnabled = pool.setProxyEnabled(enabled);
      relayStats.closeAllConnections(enabled ? 'MTProxy mode enabled' : 'MTProxy mode disabled');
      const activeProxy = pool.getActiveProxy();
      res.json({
        success: true,
        proxyEnabled,
        activeId: activeProxy.id,
        activeProxy,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/proxies/:id
   * Removes a proxy from the pool.
   * If isDefault === true, rejects with 403 Forbidden.
   */
  router.delete('/proxies/:id', (req: Request, res: Response) => {
    const rawId = req.params.id;
    const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';
    if (!id) {
      res.status(400).json({ error: 'Proxy id parameter is required.' });
      return;
    }

    try {
      const result = pool.deleteProxy(id);
      res.json(result);
    } catch (err: any) {
      const status = err.statusCode || (err.message.includes('not found') ? 404 : 400);
      res.status(status).json({ error: err.message });
    }
  });

  /**
   * GET /api/health
   * Service health check and active proxy summary.
   */
  router.get('/health', (req: Request, res: Response) => {
    try {
      const activeProxy = pool.getActiveProxy();
      res.json({
        status: 'ok',
        service: 'lizardtalk-backend',
        uptime: process.uptime(),
        activeProxy,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        status: 'error',
        service: 'lizardtalk-backend',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/diagnostics
   * Returns live throughput counters, active WebSocket connections, active proxy state, and server memory usage.
   */
  router.get('/diagnostics', (req: Request, res: Response) => {
    try {
      const activeProxy = pool.getActiveProxy();
      const snapshot = relayStats.getSnapshot();
      const mem = process.memoryUsage();
      res.json({
        ...snapshot,
        proxyEnabled: pool.isProxyEnabled(),
        activeProxy,
        serverMemoryMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        uptimeSeconds: Math.floor(process.uptime()),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/ping-test
   * Runs a live MTProto Obfuscated2 req_pq_multi probe through the active MTProxy to measure RTT and DC latency.
   */
  router.post('/ping-test', async (req: Request, res: Response) => {
    try {
      const activeProxy = pool.getActiveProxy();
      const rawDcId = Number(req.body?.dcId);
      const dcId = Number.isInteger(rawDcId) && rawDcId >= 1 && rawDcId <= 5 ? rawDcId : 2;
      const result = await checkProxyHealth(activeProxy, 4000, dcId);
      pool.updateProxyHealth(
        activeProxy.id,
        result.isOnline,
        result.latencyMs,
        result.error
      );
      res.json({
        isOnline: result.isOnline,
        latencyMs: result.latencyMs,
        dcId,
        proxyId: activeProxy.id,
        proxyHost: activeProxy.host,
        proxyPort: activeProxy.port,
        error: result.error,
        timestamp: result.timestamp,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/speedtest
   * Streams 5 MB (default 5,000,000 bytes) of binary payload to measure real client download throughput.
   */
  router.get('/speedtest', (req: Request, res: Response) => {
    const requestedBytes = Number(req.query.bytes);
    const totalBytes =
      Number.isInteger(requestedBytes) && requestedBytes >= 65536 && requestedBytes <= 10_000_000
        ? requestedBytes
        : 5_000_000;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(totalBytes));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let sentBytes = 0;
    let isAborted = false;

    req.on('close', () => {
      isAborted = true;
    });

    const pump = () => {
      while (!isAborted && sentBytes < totalBytes) {
        const remaining = totalBytes - sentBytes;
        const chunk =
          remaining >= SPEEDTEST_CHUNK_SIZE
            ? speedtestChunkBuffer
            : speedtestChunkBuffer.subarray(0, remaining);

        sentBytes += chunk.length;
        relayStats.recordRx(chunk.length);

        const canContinue = res.write(chunk);
        if (!canContinue) {
          res.once('drain', pump);
          return;
        }
      }

      if (!isAborted && sentBytes >= totalBytes) {
        res.end();
      }
    };

    pump();
  });

  return router;
}
