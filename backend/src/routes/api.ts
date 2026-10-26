import { Router, Request, Response } from 'express';
import { ProxyPool } from '../proxy/pool.js';
import { checkProxyHealth } from '../proxy/health.js';

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
      res.json({
        success: true,
        activeId: activeProxy.id,
        activeProxy,
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
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

  return router;
}
