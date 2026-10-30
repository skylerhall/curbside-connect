// Data access. Every function is scoped to a tenant id — nothing here can read
// or write across haulers.
import { randomBytes } from 'node:crypto';
import type { DB } from './database.ts';
import type {
  AuditEntry,
  Automation,
  Campaign,
  CampaignCounts,
  CampaignStatus,
  Channel,
  ConsentEvent,
  Customer,
  Message,
  MessageEvent,
  MessageStatus,
  NotificationKind,
  Route,
  ScheduleOverride,
  Template,
  TemplateKind,
  Tenant,
} from '../../shared/types.ts';

type Row = Record<string, any>;
type SqlValue = string | number | null;

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newId(prefix: string): string {
  return `${prefix}_${randomString(12)}`;
}

export function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const b = (v: boolean) => (v ? 1 : 0);

// ── Mappers ─────────────────────────────────────────────────────────────────

function toTenant(r: Row): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.short_name,
    timezone: r.timezone,
    brandPrimary: r.brand_primary,
    brandDark: r.brand_dark,
    brandAccent: r.brand_accent,
    logoInitials: r.logo_initials,
    supportPhone: r.support_phone,
    supportEmail: r.support_email,
    website: r.website,
    portalUrl: r.portal_url,
    cartOutTime: r.cart_out_time,
    billingDueDay: r.billing_due_day,
    serviceArea: r.service_area,
  };
}

function toRoute(r: Row): Route {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    serviceDay: r.service_day,
    area: r.area,
    recyclingAnchor: r.recycling_anchor,
    customerCount: r.customer_count ?? undefined,
  };
}

function toCustomer(r: Row): Customer {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    routeId: r.route_id,
    accountNumber: r.account_number,
    firstName: r.first_name,
    lastName: r.last_name,
    serviceAddress: r.service_address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    email: r.email,
    serviceLevel: r.service_level,
    monthlyRateCents: r.monthly_rate_cents,
    pastDueCents: r.past_due_cents,
    autopay: !!r.autopay,
    status: r.status,
    smsOptIn: !!r.sms_opt_in,
    emailOptIn: !!r.email_opt_in,
    notifyPickup: !!r.notify_pickup,
    notifyService: !!r.notify_service,
    notifyBilling: !!r.notify_billing,
    consentSource: r.consent_source,
    consentUpdatedAt: r.consent_updated_at,
    preferenceToken: r.preference_token,
    nextRouteId: r.next_route_id,
    nextRouteEffective: r.next_route_effective,
    isDemoContact: !!r.is_demo_contact,
    createdAt: r.created_at,
  };
}

function toTemplate(r: Row): Template {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    kind: r.kind,
    channel: r.channel,
    subject: r.subject,
    body: r.body,
    isCustomized: !!r.is_customized,
    updatedAt: r.updated_at,
  };
}

function toOverride(r: Row): ScheduleOverride {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    routeId: r.route_id,
    originalDate: r.original_date,
    newDate: r.new_date,
    kind: r.kind,
    reason: r.reason,
    holidayName: r.holiday_name,
    createdAt: r.created_at,
    notifiedCampaignId: r.notified_campaign_id,
  };
}

function toMessage(r: Row): Message {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    campaignId: r.campaign_id,
    campaignTitle: r.campaign_title ?? undefined,
    customerId: r.customer_id,
    customerName: r.customer_name ?? '',
    routeName: r.route_name ?? null,
    channel: r.channel,
    toAddress: r.to_address,
    subject: r.subject,
    body: r.body,
    segments: r.segments,
    status: r.status,
    provider: r.provider,
    providerMessageId: r.provider_message_id,
    error: r.error,
    templateKind: r.template_kind,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    deliveredAt: r.delivered_at,
    updatedAt: r.updated_at,
  };
}

function toAutomation(r: Row): Automation {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    kind: r.kind,
    enabled: !!r.enabled,
    runTime: r.run_time,
    config: JSON.parse(r.config),
    lastRunDate: r.last_run_date,
    lastRunAt: r.last_run_at,
    lastCampaignId: r.last_campaign_id,
  };
}

// ── Tenants ────────────────────────────────────────────────────────────────

export function listTenants(db: DB): Tenant[] {
  return (db.prepare('SELECT * FROM tenants ORDER BY name').all() as Row[]).map(toTenant);
}

export function getTenantBySlug(db: DB, slug: string): Tenant | null {
  const r = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug) as Row | undefined;
  return r ? toTenant(r) : null;
}

export function getTenantById(db: DB, id: string): Tenant | null {
  const r = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Row | undefined;
  return r ? toTenant(r) : null;
}

export function insertTenant(db: DB, t: Tenant, now: string): void {
  db.prepare(
    `INSERT INTO tenants (id, slug, name, short_name, timezone, brand_primary, brand_dark, brand_accent, logo_initials,
      support_phone, support_email, website, portal_url, cart_out_time, billing_due_day, service_area, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(t.id, t.slug, t.name, t.shortName, t.timezone, t.brandPrimary, t.brandDark, t.brandAccent, t.logoInitials,
    t.supportPhone, t.supportEmail, t.website, t.portalUrl, t.cartOutTime, t.billingDueDay, t.serviceArea, now);
}

const TENANT_EDITABLE: Record<string, string> = {
  name: 'name',
  shortName: 'short_name',
  brandPrimary: 'brand_primary',
  brandDark: 'brand_dark',
  brandAccent: 'brand_accent',
  logoInitials: 'logo_initials',
  supportPhone: 'support_phone',
  supportEmail: 'support_email',
  website: 'website',
  portalUrl: 'portal_url',
  cartOutTime: 'cart_out_time',
  serviceArea: 'service_area',
};

export function updateTenant(db: DB, tenantId: string, patch: Partial<Tenant>): void {
  for (const [key, column] of Object.entries(TENANT_EDITABLE)) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === 'string') db.prepare(`UPDATE tenants SET ${column} = ? WHERE id = ?`).run(value.trim(), tenantId);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function listRoutes(db: DB, tenantId: string): Route[] {
  return (
    db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM customers c WHERE c.route_id = r.id AND c.status = 'active') AS customer_count
         FROM routes r WHERE r.tenant_id = ? ORDER BY r.service_day, r.code`,
      )
      .all(tenantId) as Row[]
  ).map(toRoute);
}

export function getRoute(db: DB, tenantId: string, id: string): Route | null {
  const r = db.prepare('SELECT * FROM routes WHERE tenant_id = ? AND id = ?').get(tenantId, id) as Row | undefined;
  return r ? toRoute(r) : null;
}

export function insertRoute(db: DB, r: Route): void {
  db.prepare('INSERT INTO routes (id, tenant_id, code, name, service_day, area, recycling_anchor) VALUES (?,?,?,?,?,?,?)')
    .run(r.id, r.tenantId, r.code, r.name, r.serviceDay, r.area, r.recyclingAnchor);
}

// ── Customers ──────────────────────────────────────────────────────────────

export interface CustomerFilter {
  routeId?: string;
  search?: string;
  consent?: 'sms' | 'email' | 'none';
}

export function listCustomers(db: DB, tenantId: string, filter: CustomerFilter = {}): Customer[] {
  const where = ['tenant_id = ?'];
  const params: SqlValue[] = [tenantId];
  if (filter.routeId) {
    where.push('route_id = ?');
    params.push(filter.routeId);
  }
  if (filter.search) {
    where.push(`(first_name || ' ' || last_name LIKE ? OR service_address LIKE ? OR account_number LIKE ? OR IFNULL(phone,'') LIKE ? OR IFNULL(email,'') LIKE ?)`);
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filter.consent === 'sms') where.push('sms_opt_in = 1');
  if (filter.consent === 'email') where.push('email_opt_in = 1');
  if (filter.consent === 'none') where.push('sms_opt_in = 0 AND email_opt_in = 0');
  return (
    db.prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY is_demo_contact DESC, last_name, first_name`).all(...params) as Row[]
  ).map(toCustomer);
}

export function getCustomer(db: DB, tenantId: string, id: string): Customer | null {
  const r = db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND id = ?').get(tenantId, id) as Row | undefined;
  return r ? toCustomer(r) : null;
}

export function getCustomerByToken(db: DB, token: string): Customer | null {
  const r = db.prepare('SELECT * FROM customers WHERE preference_token = ?').get(token) as Row | undefined;
  return r ? toCustomer(r) : null;
}

export function findCustomersByPhone(db: DB, tenantId: string, e164Digits: string): Customer[] {
  // Phones are stored as entered; compare on the last 10 digits.
  const last10 = e164Digits.replace(/\D/g, '').slice(-10);
  return (db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND phone IS NOT NULL').all(tenantId) as Row[])
    .filter((r) => String(r.phone).replace(/\D/g, '').slice(-10) === last10)
    .map(toCustomer);
}

export function insertCustomer(db: DB, c: Customer): void {
  db.prepare(
    `INSERT INTO customers (id, tenant_id, route_id, account_number, first_name, last_name, service_address, city, state, zip,
      phone, email, service_level, monthly_rate_cents, past_due_cents, autopay, status, sms_opt_in, email_opt_in,
      notify_pickup, notify_service, notify_billing, consent_source, consent_updated_at, preference_token,
      next_route_id, next_route_effective, is_demo_contact, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(c.id, c.tenantId, c.routeId, c.accountNumber, c.firstName, c.lastName, c.serviceAddress, c.city, c.state, c.zip,
    c.phone, c.email, c.serviceLevel, c.monthlyRateCents, c.pastDueCents, b(c.autopay), c.status, b(c.smsOptIn), b(c.emailOptIn),
    b(c.notifyPickup), b(c.notifyService), b(c.notifyBilling), c.consentSource, c.consentUpdatedAt, c.preferenceToken,
    c.nextRouteId, c.nextRouteEffective, b(c.isDemoContact), c.createdAt);
}

export interface PreferencePatch {
  smsOptIn?: boolean;
  emailOptIn?: boolean;
  notifyPickup?: boolean;
  notifyService?: boolean;
  notifyBilling?: boolean;
}

const PREF_COLUMNS: Record<keyof PreferencePatch, string> = {
  smsOptIn: 'sms_opt_in',
  emailOptIn: 'email_opt_in',
  notifyPickup: 'notify_pickup',
  notifyService: 'notify_service',
  notifyBilling: 'notify_billing',
};

/** Applies preference changes and returns a human-readable list of what changed. */
export function updatePreferences(db: DB, customer: Customer, patch: PreferencePatch, source: string, now: string): string[] {
  const labels: Record<keyof PreferencePatch, string> = {
    smsOptIn: 'SMS',
    emailOptIn: 'Email',
    notifyPickup: 'Pickup reminders',
    notifyService: 'Service alerts',
    notifyBilling: 'Billing reminders',
  };
  const changes: string[] = [];
  for (const key of Object.keys(PREF_COLUMNS) as (keyof PreferencePatch)[]) {
    const next = patch[key];
    if (typeof next !== 'boolean' || next === customer[key]) continue;
    db.prepare(`UPDATE customers SET ${PREF_COLUMNS[key]} = ? WHERE id = ? AND tenant_id = ?`).run(b(next), customer.id, customer.tenantId);
    changes.push(`${labels[key]} ${next ? 'on' : 'off'}`);
  }
  if (changes.length) {
    db.prepare('UPDATE customers SET consent_source = ?, consent_updated_at = ? WHERE id = ?').run(source, now, customer.id);
    db.prepare('INSERT INTO consent_events (tenant_id, customer_id, change, source, at) VALUES (?,?,?,?,?)')
      .run(customer.tenantId, customer.id, changes.join(', '), source, now);
  }
  return changes;
}

export function setPendingRoute(db: DB, tenantId: string, customerId: string, routeId: string, effective: string): void {
  db.prepare('UPDATE customers SET next_route_id = ?, next_route_effective = ? WHERE tenant_id = ? AND id = ?')
    .run(routeId, effective, tenantId, customerId);
}

/** Makes pending route moves permanent once their effective date arrives. */
export function applyDueRouteMoves(db: DB, tenantId: string, today: string): number {
  const result = db
    .prepare(
      `UPDATE customers SET route_id = next_route_id, next_route_id = NULL, next_route_effective = NULL
       WHERE tenant_id = ? AND next_route_id IS NOT NULL AND next_route_effective <= ?`,
    )
    .run(tenantId, today);
  return Number(result.changes);
}

/** Which route a customer is on for a given service date (honours scheduled moves). */
export function routeOn(customer: Customer, date: string): string {
  if (customer.nextRouteId && customer.nextRouteEffective && date >= customer.nextRouteEffective) return customer.nextRouteId;
  return customer.routeId;
}

// ── Templates ──────────────────────────────────────────────────────────────

export function listTemplates(db: DB, tenantId: string): Template[] {
  return (db.prepare('SELECT * FROM templates WHERE tenant_id = ? ORDER BY kind, channel DESC').all(tenantId) as Row[]).map(toTemplate);
}

export function getTemplate(db: DB, tenantId: string, kind: TemplateKind, channel: Channel): Template | null {
  const r = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND kind = ? AND channel = ?').get(tenantId, kind, channel) as Row | undefined;
  return r ? toTemplate(r) : null;
}

export function getTemplateById(db: DB, tenantId: string, id: string): Template | null {
  const r = db.prepare('SELECT * FROM templates WHERE tenant_id = ? AND id = ?').get(tenantId, id) as Row | undefined;
  return r ? toTemplate(r) : null;
}

export function upsertTemplate(db: DB, t: Omit<Template, 'id'> & { id?: string }): void {
  db.prepare(
    `INSERT INTO templates (id, tenant_id, kind, channel, subject, body, is_customized, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (tenant_id, kind, channel) DO UPDATE SET subject = excluded.subject, body = excluded.body,
       is_customized = excluded.is_customized, updated_at = excluded.updated_at`,
  ).run(t.id ?? newId('tpl'), t.tenantId, t.kind, t.channel, t.subject, t.body, b(t.isCustomized), t.updatedAt);
}

// ── Schedule overrides ─────────────────────────────────────────────────────

export function listOverrides(db: DB, tenantId: string, fromDate?: string): ScheduleOverride[] {
  const rows = fromDate
    ? db.prepare('SELECT * FROM schedule_overrides WHERE tenant_id = ? AND (original_date >= ? OR new_date >= ?) ORDER BY original_date').all(tenantId, fromDate, fromDate)
    : db.prepare('SELECT * FROM schedule_overrides WHERE tenant_id = ? ORDER BY original_date').all(tenantId);
  return (rows as Row[]).map(toOverride);
}

export function getOverride(db: DB, tenantId: string, id: string): ScheduleOverride | null {
  const r = db.prepare('SELECT * FROM schedule_overrides WHERE tenant_id = ? AND id = ?').get(tenantId, id) as Row | undefined;
  return r ? toOverride(r) : null;
}

export function insertOverride(db: DB, o: ScheduleOverride): void {
  db.prepare(
    `INSERT INTO schedule_overrides (id, tenant_id, route_id, original_date, new_date, kind, reason, holiday_name, created_at, notified_campaign_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (tenant_id, route_id, original_date) DO UPDATE SET new_date = excluded.new_date, kind = excluded.kind,
       reason = excluded.reason, holiday_name = excluded.holiday_name, created_at = excluded.created_at, notified_campaign_id = NULL`,
  ).run(o.id, o.tenantId, o.routeId, o.originalDate, o.newDate, o.kind, o.reason, o.holidayName, o.createdAt, o.notifiedCampaignId);
}

export function findOverride(db: DB, tenantId: string, routeId: string, originalDate: string): ScheduleOverride | null {
  const r = db.prepare('SELECT * FROM schedule_overrides WHERE tenant_id = ? AND route_id = ? AND original_date = ?').get(tenantId, routeId, originalDate) as Row | undefined;
  return r ? toOverride(r) : null;
}

export function deleteOverride(db: DB, tenantId: string, id: string): boolean {
  return Number(db.prepare('DELETE FROM schedule_overrides WHERE tenant_id = ? AND id = ?').run(tenantId, id).changes) > 0;
}

export function markOverridesNotified(db: DB, tenantId: string, ids: string[], campaignId: string): void {
  const stmt = db.prepare('UPDATE schedule_overrides SET notified_campaign_id = ? WHERE tenant_id = ? AND id = ?');
  for (const id of ids) stmt.run(campaignId, tenantId, id);
}

// ── Campaigns & messages ───────────────────────────────────────────────────

export function insertCampaign(
  db: DB,
  c: { id: string; tenantId: string; kind: NotificationKind; title: string; trigger: string; params: unknown; createdAt: string; createdBy: string; status: CampaignStatus; sendAt: string | null; correctsCampaignId: string | null },
): void {
  db.prepare('INSERT INTO campaigns (id, tenant_id, kind, title, trigger, params, created_at, created_by, status, send_at, corrects_campaign_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(c.id, c.tenantId, c.kind, c.title, c.trigger, JSON.stringify(c.params), c.createdAt, c.createdBy, c.status, c.sendAt, c.correctsCampaignId);
}

/** Moves a held campaign to `status` exactly once. Returns false if it was no longer held. */
export function claimHeldCampaign(db: DB, tenantId: string, id: string, status: 'sent' | 'cancelled', now: string, actor: string | null): boolean {
  const result = db
    .prepare(
      `UPDATE campaigns SET status = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN ? END, cancelled_by = CASE WHEN ? = 'cancelled' THEN ? END
       WHERE tenant_id = ? AND id = ? AND status = 'held'`,
    )
    .run(status, status, now, status, actor, tenantId, id);
  return Number(result.changes) > 0;
}

export function listHeldCampaigns(db: DB): { id: string; tenantId: string; sendAt: string | null }[] {
  return (db.prepare(`SELECT id, tenant_id, send_at FROM campaigns WHERE status = 'held'`).all() as Row[]).map((r) => ({ id: r.id, tenantId: r.tenant_id, sendAt: r.send_at }));
}

export function queuedMessages(db: DB, campaignId: string): { id: string; channel: Channel; to: string; subject: string | null; body: string }[] {
  return (db.prepare(`SELECT id, channel, to_address, subject, body FROM messages WHERE campaign_id = ? AND status = 'queued'`).all(campaignId) as Row[]).map((r) => ({
    id: r.id,
    channel: r.channel,
    to: r.to_address,
    subject: r.subject,
    body: r.body,
  }));
}

export function cancelQueuedMessages(db: DB, campaignId: string, reason: string, now: string): number {
  const ids = (db.prepare(`SELECT id FROM messages WHERE campaign_id = ? AND status = 'queued'`).all(campaignId) as Row[]).map((r) => r.id as string);
  const update = db.prepare(`UPDATE messages SET status = 'cancelled', error = ?, updated_at = ? WHERE id = ?`);
  const event = db.prepare('INSERT INTO message_events (message_id, status, detail, at) VALUES (?,?,?,?)');
  for (const id of ids) {
    update.run(reason, now, id);
    event.run(id, 'cancelled', reason, now);
  }
  return ids.length;
}

/** Customers who actually received a campaign, with the channels they got it on. */
export function campaignRecipients(db: DB, tenantId: string, campaignId: string): Map<string, Channel[]> {
  const rows = db
    .prepare(`SELECT customer_id, channel FROM messages WHERE tenant_id = ? AND campaign_id = ? AND status IN ('sent','delivered') AND channel IS NOT NULL`)
    .all(tenantId, campaignId) as Row[];
  const out = new Map<string, Channel[]>();
  for (const r of rows) out.set(r.customer_id, [...(out.get(r.customer_id) ?? []), r.channel]);
  return out;
}

export function overridesNotifiedBy(db: DB, tenantId: string, campaignId: string): ScheduleOverride[] {
  return (db.prepare('SELECT * FROM schedule_overrides WHERE tenant_id = ? AND notified_campaign_id = ?').all(tenantId, campaignId) as Row[]).map(toOverride);
}

export function clearOverridesNotified(db: DB, tenantId: string, campaignId: string): void {
  db.prepare('UPDATE schedule_overrides SET notified_campaign_id = NULL WHERE tenant_id = ? AND notified_campaign_id = ?').run(tenantId, campaignId);
}

/** Undoes scheduled route moves for the customers in a route-change campaign. */
export function clearPendingRoutes(db: DB, tenantId: string, customerIds: string[], toRouteId: string): number {
  const stmt = db.prepare('UPDATE customers SET next_route_id = NULL, next_route_effective = NULL WHERE tenant_id = ? AND id = ? AND next_route_id = ?');
  let n = 0;
  for (const id of customerIds) n += Number(stmt.run(tenantId, id, toRouteId).changes);
  return n;
}

export function campaignCustomerIds(db: DB, campaignId: string): string[] {
  return (db.prepare('SELECT DISTINCT customer_id FROM messages WHERE campaign_id = ?').all(campaignId) as Row[]).map((r) => r.customer_id as string);
}

const COUNTS_SQL = `
  COUNT(DISTINCT m.customer_id) AS recipients,
  SUM(CASE WHEN m.status NOT IN ('skipped','cancelled') THEN 1 ELSE 0 END) AS messages,
  SUM(CASE WHEN m.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
  SUM(CASE WHEN m.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
  SUM(CASE WHEN m.status = 'queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN m.status = 'sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN m.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
  SUM(CASE WHEN m.status = 'failed' THEN 1 ELSE 0 END) AS failed`;

function toCampaign(r: Row): Campaign {
  const counts: CampaignCounts = {
    recipients: r.recipients ?? 0,
    messages: r.messages ?? 0,
    skipped: r.skipped ?? 0,
    queued: r.queued ?? 0,
    sent: r.sent ?? 0,
    delivered: r.delivered ?? 0,
    failed: r.failed ?? 0,
    cancelled: r.cancelled ?? 0,
  };
  return {
    id: r.id,
    tenantId: r.tenant_id,
    kind: r.kind,
    title: r.title,
    trigger: r.trigger,
    params: JSON.parse(r.params),
    createdAt: r.created_at,
    createdBy: r.created_by,
    counts,
    inFlight: r.status === 'held' || counts.queued + counts.sent > 0,
    status: r.status,
    sendAt: r.send_at,
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    correctsCampaignId: r.corrects_campaign_id,
  };
}

export function listCampaigns(db: DB, tenantId: string, limit = 50, kind?: string): Campaign[] {
  const rows = db
    .prepare(
      `SELECT c.*, ${COUNTS_SQL}
       FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id
       WHERE c.tenant_id = ? ${kind ? 'AND c.kind = ?' : ''}
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(...([tenantId, ...(kind ? [kind] : []), limit] as SqlValue[])) as Row[];
  return rows.map(toCampaign);
}

export function getCampaign(db: DB, tenantId: string, id: string): Campaign | null {
  const r = db
    .prepare(
      `SELECT c.*, ${COUNTS_SQL}
       FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id WHERE c.tenant_id = ? AND c.id = ? GROUP BY c.id`,
    )
    .get(tenantId, id) as Row | undefined;
  return r ? toCampaign(r) : null;
}

export interface MessageInsert {
  id: string;
  tenantId: string;
  campaignId: string;
  customerId: string;
  channel: Channel | null;
  toAddress: string | null;
  subject: string | null;
  body: string | null;
  segments: number;
  status: MessageStatus;
  error: string | null;
  templateKind: TemplateKind;
  dedupeKey: string | null;
  createdAt: string;
}

export function insertMessage(db: DB, m: MessageInsert): void {
  db.prepare(
    `INSERT INTO messages (id, tenant_id, campaign_id, customer_id, channel, to_address, subject, body, segments, status, error,
      template_kind, dedupe_key, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(m.id, m.tenantId, m.campaignId, m.customerId, m.channel, m.toAddress, m.subject, m.body, m.segments, m.status, m.error,
    m.templateKind, m.dedupeKey, m.createdAt, m.createdAt);
  db.prepare('INSERT INTO message_events (message_id, status, detail, at) VALUES (?,?,?,?)')
    .run(m.id, m.status, m.status === 'skipped' ? m.error : 'Message created', m.createdAt);
}

export function recordSendResult(
  db: DB,
  messageId: string,
  r: { status: MessageStatus; provider: string; providerMessageId: string | null; error: string | null; detail: string },
  now: string,
): void {
  db.prepare(
    `UPDATE messages SET status = ?, provider = ?, provider_message_id = ?, error = ?, sent_at = CASE WHEN ? IN ('sent','delivered') THEN ? ELSE sent_at END,
      updated_at = ? WHERE id = ?`,
  ).run(r.status, r.provider, r.providerMessageId, r.error, r.status, now, now, messageId);
  db.prepare('INSERT INTO message_events (message_id, status, detail, at) VALUES (?,?,?,?)').run(messageId, r.status, r.detail, now);
}

const STATUS_RANK: Record<MessageStatus, number> = { skipped: 0, queued: 1, sent: 2, delivered: 3, failed: 3, cancelled: 3 };

/** Applies a provider status update. Ignores out-of-order (backwards) updates. */
export function applyStatus(db: DB, messageId: string, status: MessageStatus, detail: string | null, error: string | null, now: string): boolean {
  const current = db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId) as Row | undefined;
  if (!current) return false;
  const from = current.status as MessageStatus;
  if (STATUS_RANK[status] < STATUS_RANK[from] || (STATUS_RANK[status] === STATUS_RANK[from] && status === from)) return false;
  if (from === 'delivered' || from === 'failed' || from === 'cancelled') return false;
  db.prepare(
    `UPDATE messages SET status = ?, error = COALESCE(?, error), delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      sent_at = COALESCE(sent_at, CASE WHEN ? IN ('sent','delivered') THEN ? END), updated_at = ? WHERE id = ?`,
  ).run(status, error, status, now, status, now, now, messageId);
  db.prepare('INSERT INTO message_events (message_id, status, detail, at) VALUES (?,?,?,?)').run(messageId, status, detail ?? error, now);
  return true;
}

export function findMessageByProviderId(db: DB, providerMessageId: string): { id: string; tenantId: string } | null {
  const r = db.prepare('SELECT id, tenant_id FROM messages WHERE provider_message_id = ?').get(providerMessageId) as Row | undefined;
  return r ? { id: r.id, tenantId: r.tenant_id } : null;
}

/** For each dedupe key already used: whether someone was reached ('notified') or only failed attempts exist ('failed'). */
export function existingDedupeKeys(db: DB, tenantId: string, keys: string[]): Map<string, 'notified' | 'failed'> {
  const found = new Map<string, 'notified' | 'failed'>();
  const stmt = db.prepare(`SELECT status FROM messages WHERE tenant_id = ? AND dedupe_key = ? AND status NOT IN ('skipped','cancelled')`);
  for (const key of new Set(keys)) {
    const statuses = (stmt.all(tenantId, key) as Row[]).map((r) => r.status as MessageStatus);
    if (statuses.some((s) => s !== 'failed')) found.set(key, 'notified');
    else if (statuses.length) found.set(key, 'failed');
  }
  return found;
}

export interface MessageFilter {
  status?: string;
  channel?: string;
  campaignId?: string;
  customerId?: string;
  kind?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listMessages(db: DB, tenantId: string, f: MessageFilter = {}): { items: Message[]; total: number } {
  const where = ['m.tenant_id = ?'];
  const params: SqlValue[] = [tenantId];
  if (f.status) {
    where.push('m.status = ?');
    params.push(f.status);
  }
  if (f.channel) {
    where.push('m.channel = ?');
    params.push(f.channel);
  }
  if (f.campaignId) {
    where.push('m.campaign_id = ?');
    params.push(f.campaignId);
  }
  if (f.customerId) {
    where.push('m.customer_id = ?');
    params.push(f.customerId);
  }
  if (f.kind) {
    where.push('c.kind = ?');
    params.push(f.kind);
  }
  if (f.search) {
    where.push(`(cu.first_name || ' ' || cu.last_name LIKE ? OR IFNULL(m.to_address,'') LIKE ? OR IFNULL(m.body,'') LIKE ?)`);
    const like = `%${f.search}%`;
    params.push(like, like, like);
  }
  const from = `FROM messages m JOIN customers cu ON cu.id = m.customer_id JOIN campaigns c ON c.id = m.campaign_id
    LEFT JOIN routes r ON r.id = cu.route_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as Row).n as number;
  const rows = db
    .prepare(
      `SELECT m.*, cu.first_name || ' ' || cu.last_name AS customer_name, r.name AS route_name, c.title AS campaign_title
       ${from} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, f.limit ?? 100, f.offset ?? 0) as Row[];
  return { items: rows.map(toMessage), total };
}

export function getMessage(db: DB, tenantId: string, id: string): (Message & { events: MessageEvent[] }) | null {
  const r = db
    .prepare(
      `SELECT m.*, cu.first_name || ' ' || cu.last_name AS customer_name, r.name AS route_name, c.title AS campaign_title
       FROM messages m JOIN customers cu ON cu.id = m.customer_id JOIN campaigns c ON c.id = m.campaign_id
       LEFT JOIN routes r ON r.id = cu.route_id WHERE m.tenant_id = ? AND m.id = ?`,
    )
    .get(tenantId, id) as Row | undefined;
  if (!r) return null;
  const events = db.prepare('SELECT status, detail, at FROM message_events WHERE message_id = ? ORDER BY id').all(id) as Row[];
  return { ...toMessage(r), events: events.map((e) => ({ status: e.status, detail: e.detail, at: e.at })) };
}

export function messageStatsByDay(db: DB, tenantId: string, sinceIso: string): { day: string; channel: string; status: string; n: number }[] {
  return db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, channel, status, COUNT(*) AS n FROM messages
       WHERE tenant_id = ? AND created_at >= ? AND status NOT IN ('skipped','cancelled') GROUP BY day, channel, status`,
    )
    .all(tenantId, sinceIso) as { day: string; channel: string; status: string; n: number }[];
}

// ── Consent events & audit ─────────────────────────────────────────────────

export function listConsentEvents(db: DB, tenantId: string, limit = 50, customerId?: string): ConsentEvent[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.customer_id, e.change, e.source, e.at, c.first_name || ' ' || c.last_name AS customer_name
       FROM consent_events e JOIN customers c ON c.id = e.customer_id
       WHERE e.tenant_id = ? ${customerId ? 'AND e.customer_id = ?' : ''} ORDER BY e.at DESC, e.id DESC LIMIT ?`,
    )
    .all(...([tenantId, ...(customerId ? [customerId] : []), limit] as SqlValue[])) as Row[];
  return rows.map((r) => ({ id: r.id, customerId: r.customer_id, customerName: r.customer_name, change: r.change, source: r.source, at: r.at }));
}

export function audit(db: DB, tenantId: string, actor: string, action: string, summary: string, now: string): void {
  db.prepare('INSERT INTO audit_log (tenant_id, actor, action, summary, at) VALUES (?,?,?,?,?)').run(tenantId, actor, action, summary, now);
}

export function listAudit(db: DB, tenantId: string, limit = 100): AuditEntry[] {
  return (db.prepare('SELECT id, actor, action, summary, at FROM audit_log WHERE tenant_id = ? ORDER BY at DESC, id DESC LIMIT ?').all(tenantId, limit) as Row[])
    .map((r) => ({ id: r.id, actor: r.actor, action: r.action, summary: r.summary, at: r.at }));
}

// ── Automations ────────────────────────────────────────────────────────────

export function listAutomations(db: DB, tenantId: string): Automation[] {
  return (db.prepare('SELECT * FROM automations WHERE tenant_id = ? ORDER BY kind DESC').all(tenantId) as Row[]).map(toAutomation);
}

export function getAutomation(db: DB, tenantId: string, kind: string): Automation | null {
  const r = db.prepare('SELECT * FROM automations WHERE tenant_id = ? AND kind = ?').get(tenantId, kind) as Row | undefined;
  return r ? toAutomation(r) : null;
}

export function insertAutomation(db: DB, a: Automation): void {
  db.prepare('INSERT INTO automations (id, tenant_id, kind, enabled, run_time, config, last_run_date, last_run_at, last_campaign_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(a.id, a.tenantId, a.kind, b(a.enabled), a.runTime, JSON.stringify(a.config), a.lastRunDate, a.lastRunAt, a.lastCampaignId);
}

export function updateAutomation(db: DB, tenantId: string, kind: string, patch: { enabled?: boolean; runTime?: string; config?: Automation['config'] }): void {
  if (typeof patch.enabled === 'boolean') db.prepare('UPDATE automations SET enabled = ? WHERE tenant_id = ? AND kind = ?').run(b(patch.enabled), tenantId, kind);
  if (patch.runTime) db.prepare('UPDATE automations SET run_time = ? WHERE tenant_id = ? AND kind = ?').run(patch.runTime, tenantId, kind);
  if (patch.config) db.prepare('UPDATE automations SET config = ? WHERE tenant_id = ? AND kind = ?').run(JSON.stringify(patch.config), tenantId, kind);
}

export function markAutomationRun(db: DB, tenantId: string, kind: string, date: string, at: string, campaignId: string | null): void {
  db.prepare('UPDATE automations SET last_run_date = ?, last_run_at = ?, last_campaign_id = COALESCE(?, last_campaign_id) WHERE tenant_id = ? AND kind = ?')
    .run(date, at, campaignId, tenantId, kind);
}

// ── Demo reset ─────────────────────────────────────────────────────────────

export function wipeTenantData(db: DB, tenantId: string): void {
  for (const table of ['message_events', 'messages', 'campaigns', 'consent_events', 'audit_log', 'automations', 'schedule_overrides', 'templates', 'customers', 'routes']) {
    if (table === 'message_events') {
      db.prepare('DELETE FROM message_events WHERE message_id IN (SELECT id FROM messages WHERE tenant_id = ?)').run(tenantId);
    } else {
      db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId);
    }
  }
}
