import type { AddressInfo } from 'node:net';
import { loadConfig, type AppConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { DEMO_HAULER, seedTenant, type TenantSeed } from '../server/db/seed.ts';
import type { AppContext } from '../server/engine/context.ts';
import { createApp } from '../server/http/app.ts';
import { ProviderRouter } from '../server/providers/index.ts';
import type { NotificationProvider } from '../server/providers/types.ts';
import type { Channel, Tenant } from '../shared/types.ts';

/** Wednesday Oct 7 2026, 10:00 AM in Denver. */
export const FIXED_NOW = new Date('2026-10-07T16:00:00Z');

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ DATABASE_PATH: ':memory:', SIMULATED_DELIVERY_DELAY_MS: '0', SEND_HOLD_SECONDS: '0', SCHEDULER_ENABLED: 'false', ...env });
}

export function testContext(opts: { env?: Record<string, string>; now?: Date; live?: Partial<Record<Channel, NotificationProvider>> } = {}): AppContext {
  const config = testConfig(opts.env);
  const now = opts.now ?? FIXED_NOW;
  return { db: openDatabase(':memory:'), config, providers: new ProviderRouter(config, opts.live), now: () => now };
}

export async function seedDemoHauler(ctx: AppContext, history = false): Promise<Tenant> {
  return seedTenant(ctx, DEMO_HAULER, { history });
}

export const OTHER_HAULER: TenantSeed = {
  tenant: {
    ...DEMO_HAULER.tenant,
    slug: 'canyon-creek',
    name: 'Canyon Creek Waste',
    shortName: 'Canyon Creek',
    logoInitials: 'CC',
    supportPhone: '(555) 555-0100',
  },
  accountPrefix: 'CCW',
  phoneAreaCodes: ['303'],
  customersPerRoute: 6,
  routes: DEMO_HAULER.routes.slice(0, 2).map((r) => ({ ...r, code: `C${r.code}` })),
};

export async function startServer(ctx: AppContext): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createApp(ctx);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
