import express, { type Express } from 'express';
import { getTenantBySlug } from '../db/repo.ts';
import type { AppContext } from '../engine/context.ts';
import { apiRouter, errorHandler } from './api.ts';
import { clearSessionCookie, isAuthenticated, loginLimiter, passwordMatches, requireAuth, setSessionCookie } from './auth.ts';
import { publicRouter } from './public.ts';

/** Builds the HTTP app. Static/Vite serving is added by server/index.ts. */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Public endpoints parse their own bodies (webhooks need the raw bytes).
  app.use('/api', publicRouter(ctx));

  app.use('/api', express.json({ limit: '200kb' }));

  app.get('/api/session', (req, res) => {
    res.json({ authenticated: isAuthenticated(ctx.config, req), required: Boolean(ctx.config.demoPassword) });
  });

  app.post('/api/auth/login', loginLimiter(), (req, res) => {
    if (!ctx.config.demoPassword) return res.json({ ok: true });
    if (!passwordMatches(ctx.config, req.body?.password)) return res.status(401).json({ error: 'Incorrect password' });
    setSessionCookie(ctx.config, req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Everything below needs a session (when DEMO_PASSWORD is set) and a tenant.
  app.use('/api', requireAuth(ctx.config), (req, res, next) => {
    const slug = (req.header('x-tenant') || ctx.config.defaultTenant).toLowerCase();
    const tenant = getTenantBySlug(ctx.db, slug);
    if (!tenant) return res.status(404).json({ error: `Unknown tenant "${slug}"` });
    res.locals.tenant = tenant;
    next();
  });

  app.use('/api', apiRouter(ctx));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}
