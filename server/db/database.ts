import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

// Every business table carries tenant_id so one deployment can serve many
// haulers. Queries in repo.ts always filter by tenant.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    brand_primary TEXT NOT NULL,
    brand_dark TEXT NOT NULL,
    brand_accent TEXT NOT NULL,
    logo_initials TEXT NOT NULL,
    support_phone TEXT NOT NULL,
    support_email TEXT NOT NULL,
    website TEXT NOT NULL,
    portal_url TEXT NOT NULL,
    cart_out_time TEXT NOT NULL,
    billing_due_day INTEGER NOT NULL DEFAULT 1,
    service_area TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE routes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    service_day INTEGER NOT NULL CHECK (service_day BETWEEN 1 AND 6),
    area TEXT NOT NULL,
    recycling_anchor TEXT NOT NULL,
    UNIQUE (tenant_id, code)
  );

  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL REFERENCES routes(id),
    account_number TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    service_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    service_level TEXT NOT NULL,
    monthly_rate_cents INTEGER NOT NULL,
    past_due_cents INTEGER NOT NULL DEFAULT 0,
    autopay INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    sms_opt_in INTEGER NOT NULL DEFAULT 0,
    email_opt_in INTEGER NOT NULL DEFAULT 0,
    notify_pickup INTEGER NOT NULL DEFAULT 1,
    notify_service INTEGER NOT NULL DEFAULT 1,
    notify_billing INTEGER NOT NULL DEFAULT 1,
    consent_source TEXT NOT NULL DEFAULT 'import',
    consent_updated_at TEXT NOT NULL,
    preference_token TEXT NOT NULL UNIQUE,
    next_route_id TEXT REFERENCES routes(id),
    next_route_effective TEXT,
    is_demo_contact INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, account_number)
  );
  CREATE INDEX customers_tenant_route ON customers (tenant_id, route_id);

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    channel TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    is_customized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, kind, channel)
  );

  CREATE TABLE schedule_overrides (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL REFERENCES routes(id),
    original_date TEXT NOT NULL,
    new_date TEXT,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    holiday_name TEXT,
    created_at TEXT NOT NULL,
    notified_campaign_id TEXT,
    UNIQUE (tenant_id, route_id, original_date)
  );

  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    trigger TEXT NOT NULL,
    params TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX campaigns_tenant_created ON campaigns (tenant_id, created_at);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel TEXT,
    to_address TEXT,
    subject TEXT,
    body TEXT,
    segments INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    provider TEXT,
    provider_message_id TEXT,
    error TEXT,
    template_kind TEXT,
    dedupe_key TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    delivered_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX messages_tenant_created ON messages (tenant_id, created_at);
  CREATE INDEX messages_campaign ON messages (campaign_id);
  CREATE INDEX messages_provider_id ON messages (provider_message_id);
  CREATE INDEX messages_dedupe ON messages (tenant_id, dedupe_key);
  CREATE INDEX messages_customer ON messages (customer_id);

  CREATE TABLE message_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    detail TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX message_events_message ON message_events (message_id);

  CREATE TABLE consent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    change TEXT NOT NULL,
    source TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX consent_events_tenant ON consent_events (tenant_id, at);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX audit_log_tenant ON audit_log (tenant_id, at);

  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    run_time TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    last_run_date TEXT,
    last_run_at TEXT,
    last_campaign_id TEXT,
    UNIQUE (tenant_id, kind)
  );
  `,
  // 2: undo-send window and corrections.
  `
  ALTER TABLE campaigns ADD COLUMN status TEXT NOT NULL DEFAULT 'sent';
  ALTER TABLE campaigns ADD COLUMN send_at TEXT;
  ALTER TABLE campaigns ADD COLUMN cancelled_at TEXT;
  ALTER TABLE campaigns ADD COLUMN cancelled_by TEXT;
  ALTER TABLE campaigns ADD COLUMN corrects_campaign_id TEXT;
  `,
];

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
