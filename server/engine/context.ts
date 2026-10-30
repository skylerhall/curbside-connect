import type { AppConfig } from '../config.ts';
import type { DB } from '../db/database.ts';
import type { ProviderRouter } from '../providers/index.ts';
import type { Tenant } from '../../shared/types.ts';

/** Everything the notification engine needs. `now` is injectable for tests and seeding. */
export interface AppContext {
  db: DB;
  config: AppConfig;
  providers: ProviderRouter;
  now: () => Date;
}

export function nowIso(ctx: AppContext): string {
  return ctx.now().toISOString();
}

export function baseUrl(ctx: AppContext): string {
  return ctx.config.publicBaseUrl ?? `http://localhost:${ctx.config.port}`;
}

export function preferencesUrl(ctx: AppContext, token: string): string {
  return `${baseUrl(ctx)}/p/${token}`;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function tenantVars(tenant: Tenant): Record<string, string> {
  return {
    company_name: tenant.name,
    support_phone: tenant.supportPhone,
    cart_out_time: tenant.cartOutTime,
    portal_url: tenant.portalUrl,
  };
}
