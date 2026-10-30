// Entry point: loads .env, opens the database, seeds the demo when empty,
// starts the scheduler and serves the dashboard.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { ensureDefaultTemplates, seedIfEmpty } from './db/seed.ts';
import { startScheduler } from './engine/automations.ts';
import { resumeHeldCampaigns } from './engine/dispatch.ts';
import type { AppContext } from './engine/context.ts';
import { createApp } from './http/app.ts';
import { ProviderRouter } from './providers/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const config = loadConfig();
const db = openDatabase(config.databasePath);
const ctx: AppContext = { db, config, providers: new ProviderRouter(config), now: () => new Date() };

if (await seedIfEmpty(ctx)) console.log('[seed] Loaded fictional Kestrel Ridge Disposal demo data');
ensureDefaultTemplates(ctx);
const resumed = resumeHeldCampaigns(ctx);
if (resumed) console.log(`[dispatch] Resumed ${resumed} notification(s) waiting in the undo window`);
if (config.schedulerEnabled) startScheduler(ctx);

const app = createApp(ctx);

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: join(root, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = join(root, 'dist', 'web');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('Dashboard build not found. Run "npm run build" first (or "npm run dev" for development).');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(config.port, () => {
  const status = ctx.providers.status();
  console.log(`\n  Dashboard  http://localhost:${config.port}`);
  console.log(`  SMS        ${status.sms.provider}${status.sms.live ? ' (LIVE)' : ''}`);
  console.log(`  Email      ${status.email.provider}${status.email.live ? ' (LIVE)' : ''}`);
  console.log(`  Password   ${config.demoPassword ? 'required' : 'off (set DEMO_PASSWORD before deploying)'}\n`);
});
