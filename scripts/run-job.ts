// Runs an automation once for every tenant, for use with an external scheduler
// (Render cron job, GitHub Actions, system cron) instead of the built-in one.
// Usage: npm run job -- pickup-reminders | billing-reminders
import { existsSync } from 'node:fs';
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { listTenants } from '../server/db/repo.ts';
import { runAutomation } from '../server/engine/automations.ts';
import { ProviderRouter } from '../server/providers/index.ts';

const jobs = { 'pickup-reminders': 'pickup_reminder', 'billing-reminders': 'billing_reminder' } as const;
const name = process.argv[2] as keyof typeof jobs;
if (!jobs[name]) {
  console.error(`Usage: npm run job -- ${Object.keys(jobs).join(' | ')}`);
  process.exit(1);
}

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const ctx = { db: openDatabase(config.databasePath), config, providers: new ProviderRouter(config), now: () => new Date() };
for (const tenant of listTenants(ctx.db)) {
  const run = await runAutomation(ctx, tenant, jobs[name]);
  console.log(`${tenant.slug}: ${run.note}`);
}
