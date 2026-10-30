// Fictional demo data. Every customer, address, phone number (555-01xx) and
// email (example.com) is made up. The engine itself generates the message
// history, so the activity log looks exactly like real usage would.
import type { Automation, Customer, Route, Tenant } from '../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import { ProviderRouter } from '../providers/index.ts';
import type { AppContext } from '../engine/context.ts';
import { DEFAULT_TEMPLATES } from '../engine/default-templates.ts';
import { executeNotification } from '../engine/dispatch.ts';
import { handleInboundSms } from '../engine/consent.ts';
import { addDays, lastDueDate, todayIn, weekStart } from '../lib/dates.ts';
import { transaction } from './database.ts';
import {
  getCustomer,
  getTenantBySlug,
  insertAutomation,
  insertCustomer,
  insertOverride,
  insertRoute,
  insertTenant,
  newId,
  randomString,
  updatePreferences,
  upsertTemplate,
  wipeTenantData,
} from './repo.ts';

export interface RouteSeed {
  code: string;
  name: string;
  serviceDay: number;
  area: string;
  towns: { city: string; zip: string }[];
}

export interface TenantSeed {
  tenant: Omit<Tenant, 'id'>;
  accountPrefix: string;
  routes: RouteSeed[];
  customersPerRoute: number;
  phoneAreaCodes: string[];
}

export const DEMO_HAULER: TenantSeed = {
  tenant: {
    slug: 'kestrel-ridge',
    name: 'Kestrel Ridge Disposal',
    shortName: 'Kestrel Ridge',
    timezone: 'America/Denver',
    // Fictional hauler for the portfolio demo: forest green with a gold accent.
    brandPrimary: '#176649',
    brandDark: '#123c30',
    brandAccent: '#dbb34a',
    logoInitials: 'KR',
    supportPhone: '(970) 555-0100',
    supportEmail: 'service@kestrelridge.example.com',
    website: 'kestrelridge.example.com',
    portalUrl: 'kestrelridge.example.com',
    cartOutTime: '6:00 AM',
    billingDueDay: 1,
    serviceArea: 'Kestrel Valley',
  },
  accountPrefix: 'KRD',
  phoneAreaCodes: ['970', '720'],
  customersPerRoute: 30,
  routes: [
    { code: 'R1', name: 'North Fork', serviceDay: 1, area: 'Alder Springs and Cutbank', towns: [{ city: 'Alder Springs', zip: '80601' }, { city: 'Cutbank', zip: '80602' }] },
    { code: 'R2', name: 'Sage Flats', serviceDay: 2, area: 'Sage Flats and Coyote Bend', towns: [{ city: 'Sage Flats', zip: '80603' }, { city: 'Coyote Bend', zip: '80604' }] },
    { code: 'R3', name: 'Kestrel North', serviceDay: 3, area: 'Kestrel north of Main St', towns: [{ city: 'Kestrel', zip: '80605' }, { city: 'Kestrel', zip: '80606' }] },
    { code: 'R4', name: 'Bridger & Pine Hollow', serviceDay: 4, area: 'Bridger Falls and Pine Hollow', towns: [{ city: 'Bridger Falls', zip: '80607' }, { city: 'Pine Hollow', zip: '80607' }] },
    { code: 'R5', name: 'Harlan Mesa', serviceDay: 5, area: 'Harlan Mesa, Larkin and the county road edge', towns: [{ city: 'Harlan Mesa', zip: '80608' }, { city: 'Larkin', zip: '80609' }] },
  ],
};

const FIRST = ['Avery', 'Jordan', 'Morgan', 'Casey', 'Parker', 'Riley', 'Taylor', 'Quinn', 'Reese', 'Dakota', 'Hayden', 'Emerson', 'Rowan', 'Sawyer', 'Logan', 'Harper', 'Elliot', 'Finley', 'Blake', 'Cameron', 'Drew', 'Jamie', 'Kendall', 'Lane', 'Marley', 'Noel', 'Oakley', 'Peyton', 'Remy', 'Sage', 'Tatum', 'Wren', 'Ari', 'Bailey', 'Carter', 'Devon', 'Ellis', 'Frankie', 'Gray', 'Hollis', 'Jesse', 'Kai', 'Lennox', 'Micah', 'Nico', 'Robin', 'Shay', 'Toby'];
const LAST = ['Collins', 'Kim', 'Rivera', 'Nguyen', 'Shaw', 'Adams', 'Brooks', 'Carver', 'Delgado', 'Ellison', 'Fischer', 'Garza', 'Holt', 'Ibarra', 'Jensen', 'Keller', 'Lindgren', 'Moreno', 'Nakamura', 'Ortega', 'Pruitt', 'Quintana', 'Reyes', 'Sorensen', 'Trujillo', 'Underwood', 'Vasquez', 'Whitaker', 'Yoder', 'Zamora', 'Archuleta', 'Bauer', 'Chavez', 'Duran', 'Eckert', 'Flores', 'Gallegos', 'Hansen', 'Iverson', 'Jaramillo', 'Kowalski', 'Lucero', 'Maestas', 'Nolan', 'Olsen', 'Pacheco'];
const STREETS = ['Juniper Ln', 'Basin View Dr', 'Elk Trail', 'Canyon Rd', 'Cedar Ct', 'Meadow Park Dr', 'Prairie Sky Way', 'Pawnee Ridge Rd', 'Sunflower St', 'Harvest Ave', 'Windmill Dr', 'Wheatfield Ct', 'Buckskin Dr', 'Antelope Run', 'Big Sky Ln', 'Cottonwood Dr', 'Aspen Ct', 'Foothill View Dr', 'Grange Rd', 'Silo Ct', 'Larkspur Ln', 'Pronghorn Way', 'Red Barn Rd', 'Thistle Ct'];
const PLANS = [
  { level: '96-gal trash + recycling', cents: 3450, weight: 55 },
  { level: '64-gal trash + recycling', cents: 2950, weight: 20 },
  { level: '96-gal trash + recycling + yard waste', cents: 4600, weight: 15 },
  { level: 'Senior 64-gal trash + recycling', cents: 2450, weight: 10 },
];
const CONSENT_SOURCES = ['Online sign-up form', 'Phone call with office', 'Customer portal', 'Paper service agreement'];

/** Small deterministic PRNG so every reset produces the same customers. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: T[]) => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}

/** Converts a tenant-local date + time to a UTC instant. */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    guess += Date.UTC(y, m - 1, d, hh, mm) - asLocal;
  }
  return new Date(guess);
}

export interface SeedOptions {
  history: boolean;
  seed?: number;
}

/** Creates (or recreates) a tenant with routes, customers, templates and automations. */
export async function seedTenant(ctx: AppContext, spec: TenantSeed, opts: SeedOptions): Promise<Tenant> {
  const { db } = ctx;
  const r = rng(opts.seed ?? 20261007);
  const nowDate = ctx.now();
  const nowIso = nowDate.toISOString();
  const today = todayIn(spec.tenant.timezone, nowDate);

  const existing = getTenantBySlug(db, spec.tenant.slug);
  const tenant: Tenant = { ...spec.tenant, id: existing?.id ?? `tn_${spec.tenant.slug.replace(/[^a-z0-9]/g, '_')}` };

  transaction(db, () => {
    if (existing) {
      wipeTenantData(db, existing.id);
      db.prepare('DELETE FROM tenants WHERE id = ?').run(existing.id);
    }
    insertTenant(db, tenant, nowIso);

    const routes: Route[] = spec.routes.map((rs) => ({
      id: newId('rt'),
      tenantId: tenant.id,
      code: rs.code,
      name: rs.name,
      serviceDay: rs.serviceDay,
      area: rs.area,
      // Alternate routes start on opposite recycling weeks, like a real hauler.
      recyclingAnchor: addDays(weekStart(today), rs.serviceDay - 1 + (rs.serviceDay % 2 === 0 ? 7 : 0)),
    }));
    routes.forEach((route) => insertRoute(db, route));

    // Reserved fictional numbers: 555-0100 … 555-0199 in each area code.
    const phonePool = spec.phoneAreaCodes.flatMap((ac) => Array.from({ length: 100 }, (_, i) => `(${ac}) 555-${String(100 + i).padStart(4, '0')}`));
    const unreachable = phonePool.find((p) => p.endsWith('0199'));
    const shuffled = phonePool.filter((p) => p !== unreachable).sort(() => r.next() - 0.5);
    const usedNames = new Set<string>();
    let account = 10400;
    let bouncedAssigned = false;
    let unreachableAssigned = false;

    routes.forEach((route, ri) => {
      const towns = spec.routes[ri].towns;
      for (let i = 0; i < spec.customersPerRoute; i++) {
        let first = r.pick(FIRST);
        let last = r.pick(LAST);
        while (usedNames.has(`${first} ${last}`)) {
          first = r.pick(FIRST);
          last = r.pick(LAST);
        }
        usedNames.add(`${first} ${last}`);
        const town = r.pick(towns);
        let plan = PLANS[0];
        let roll = r.int(1, 100);
        for (const p of PLANS) {
          if (roll <= p.weight) {
            plan = p;
            break;
          }
          roll -= p.weight;
        }

        // One undeliverable number and one bouncing inbox on the Thursday route,
        // so the delivery log shows realistic failures.
        const failingPhone = ri === 3 && i === 4 && !unreachableAssigned && !!unreachable;
        const failingEmail = ri === 3 && i === 9 && !bouncedAssigned;
        const hasPhone = failingPhone || r.chance(0.88);
        const hasEmail = failingEmail || r.chance(0.78) || !hasPhone;
        let phone = hasPhone ? (shuffled.pop() ?? null) : null;
        if (failingPhone) {
          phone = unreachable!;
          unreachableAssigned = true;
        }
        let email = hasEmail ? `${first}.${last}${r.int(1, 99)}@example.com`.toLowerCase() : null;
        if (failingEmail) {
          email = `${first}.${last}.old@bounced.example.com`.toLowerCase();
          bouncedAssigned = true;
        }

        const autopay = r.chance(0.45);
        const pastDue = !autopay && r.chance(0.16) ? plan.cents * (r.chance(0.25) ? 2 : 1) : 0;
        const smsOptIn = failingPhone || (!!phone && r.chance(0.74));
        const emailOptIn = failingEmail || (!!email && r.chance(0.68));
        const consentAt = new Date(nowDate.getTime() - r.int(20, 700) * 86_400_000).toISOString();

        const customer: Customer = {
          id: newId('cus'),
          tenantId: tenant.id,
          routeId: route.id,
          accountNumber: `${spec.accountPrefix}-${account++}`,
          firstName: first,
          lastName: last,
          serviceAddress: `${r.int(100, 9899)} ${r.pick(STREETS)}`,
          city: town.city,
          state: 'CO',
          zip: town.zip,
          phone,
          email,
          serviceLevel: plan.level,
          monthlyRateCents: plan.cents,
          pastDueCents: pastDue,
          autopay,
          status: 'active',
          smsOptIn,
          emailOptIn,
          notifyPickup: r.chance(0.94),
          notifyService: true,
          notifyBilling: r.chance(0.92),
          consentSource: smsOptIn || emailOptIn ? r.pick(CONSENT_SOURCES) : 'Imported from billing system',
          consentUpdatedAt: consentAt,
          preferenceToken: randomString(10),
          nextRouteId: null,
          nextRouteEffective: null,
          isDemoContact: false,
          createdAt: consentAt,
        };
        insertCustomer(db, customer);
      }
    });

    for (const t of DEFAULT_TEMPLATES) {
      upsertTemplate(db, { tenantId: tenant.id, kind: t.kind, channel: t.channel, subject: t.subject, body: t.body, isCustomized: false, updatedAt: nowIso });
    }

    const automations: Automation[] = [
      { id: newId('au'), tenantId: tenant.id, kind: 'pickup_reminder', enabled: true, runTime: '17:00', config: {}, lastRunDate: null, lastRunAt: null, lastCampaignId: null },
      { id: newId('au'), tenantId: tenant.id, kind: 'billing_reminder', enabled: true, runTime: '09:00', config: { daysBefore: 3, pastDueGraceDays: 5 }, lastRunDate: null, lastRunAt: null, lastCampaignId: null },
    ];
    automations.forEach((a) => insertAutomation(db, a));
  });

  if (opts.history) await seedHistory(ctx, tenant, today);
  return tenant;
}

/** Replays two weeks of activity through the real engine with a backdated clock. */
async function seedHistory(ctx: AppContext, tenant: Tenant, today: string): Promise<void> {
  const quietConfig: AppConfig = { ...ctx.config, smsProvider: 'simulated', emailProvider: 'simulated', simulatedDelayMs: 0, sendHoldSeconds: 0 };
  const at = (date: string, time: string) => {
    const instant = localToUtc(date, time, tenant.timezone);
    return { ...ctx, config: quietConfig, providers: new ProviderRouter(quietConfig), now: () => instant };
  };
  const routes = ctx.db.prepare('SELECT * FROM routes WHERE tenant_id = ? ORDER BY service_day').all(tenant.id) as Record<string, any>[];

  // A one-off operational delay last week on the Monday route.
  const lastMonday = addDays(weekStart(today), -7);
  const mondayRoute = routes.find((r) => r.service_day === 1);
  let overrideId: string | null = null;
  if (mondayRoute && lastMonday < today) {
    overrideId = newId('ov');
    insertOverride(ctx.db, {
      id: overrideId,
      tenantId: tenant.id,
      routeId: mondayRoute.id,
      originalDate: lastMonday,
      newDate: addDays(lastMonday, 1),
      kind: 'operational',
      reason: 'County Road 74 closure for bridge repair',
      holidayName: null,
      createdAt: localToUtc(addDays(lastMonday, -1), '13:40', tenant.timezone).toISOString(),
      notifiedCampaignId: null,
    });
  }

  const events: { when: { date: string; time: string }; run: (c: AppContext) => Promise<unknown> }[] = [];
  for (let d = addDays(today, -14); d <= today; d = addDays(d, 1)) {
    const reminderFor = addDays(d, 1);
    if (reminderFor > today) break;
    events.push({ when: { date: d, time: '17:00' }, run: (c) => executeNotification(c, tenant, { kind: 'pickup_reminder', serviceDate: reminderFor }, { trigger: 'automation', actor: 'automation' }) });
  }
  if (overrideId) {
    const oid = overrideId;
    events.push({ when: { date: addDays(lastMonday, -1), time: '13:45' }, run: (c) => executeNotification(c, tenant, { kind: 'schedule_change', overrideIds: [oid] }, { trigger: 'manual', actor: 'Dispatch office' }) });
  }

  const lastDue = lastDueDate(today, tenant.billingDueDay);
  const remindOn = addDays(lastDue, -3);
  if (remindOn >= addDays(today, -21)) {
    events.push({ when: { date: remindOn, time: '09:00' }, run: (c) => executeNotification(c, tenant, { kind: 'billing_reminder', mode: 'upcoming' }, { trigger: 'automation', actor: 'automation' }) });
    events.push({ when: { date: remindOn, time: '09:01' }, run: (c) => executeNotification(c, tenant, { kind: 'billing_reminder', mode: 'autopay' }, { trigger: 'automation', actor: 'automation' }) });
  }
  const pastDueOn = addDays(lastDue, 5);
  if (pastDueOn < today) {
    events.push({ when: { date: pastDueOn, time: '09:00' }, run: (c) => executeNotification(c, tenant, { kind: 'billing_reminder', mode: 'past_due' }, { trigger: 'automation', actor: 'automation' }) });
  }

  const windDay = addDays(today, -4);
  events.push({
    when: { date: windDay, time: '06:10' },
    run: (c) =>
      executeNotification(
        c,
        tenant,
        { kind: 'alert', severity: 'advisory', routeIds: 'all', channels: ['sms'], message: 'High winds today. Please close cart lids and set carts with handles facing your home.' },
        { trigger: 'manual', actor: 'Dispatch office' },
      ),
  });

  events.sort((a, b) => (a.when.date + a.when.time).localeCompare(b.when.date + b.when.time));
  for (const e of events) {
    if (localToUtc(e.when.date, e.when.time, tenant.timezone) > ctx.now()) continue;
    await e.run(at(e.when.date, e.when.time));
  }

  // A couple of customers who texted STOP, and one who updated preferences by link.
  const optedIn = ctx.db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND sms_opt_in = 1 AND phone IS NOT NULL ORDER BY account_number LIMIT 40').all(tenant.id) as Record<string, any>[];
  const stopper = optedIn[17];
  if (stopper) handleInboundSms(at(addDays(today, -6), '18:12'), tenant, stopper.phone, 'STOP');
  const stopper2 = optedIn[31];
  if (stopper2) handleInboundSms(at(addDays(today, -2), '17:41'), tenant, stopper2.phone, 'Stop');
  const linkUser = ctx.db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND email_opt_in = 0 AND email IS NOT NULL ORDER BY account_number LIMIT 1').get(tenant.id) as Record<string, any> | undefined;
  if (linkUser) {
    const c = getCustomer(ctx.db, tenant.id, linkUser.id);
    if (c) updatePreferences(ctx.db, c, { emailOptIn: true }, 'Customer preference link', localToUtc(addDays(today, -3), '20:05', tenant.timezone).toISOString());
  }
}

/** Adds any default templates a tenant is missing (e.g. new template types after an upgrade). */
export function ensureDefaultTemplates(ctx: AppContext): void {
  const now = ctx.now().toISOString();
  const stmt = ctx.db.prepare(
    `INSERT INTO templates (id, tenant_id, kind, channel, subject, body, is_customized, updated_at) VALUES (?,?,?,?,?,?,0,?)
     ON CONFLICT (tenant_id, kind, channel) DO NOTHING`,
  );
  for (const t of ctx.db.prepare('SELECT id FROM tenants').all() as { id: string }[]) {
    for (const d of DEFAULT_TEMPLATES) stmt.run(newId('tpl'), t.id, d.kind, d.channel, d.subject, d.body, now);
  }
}

export async function seedIfEmpty(ctx: AppContext): Promise<boolean> {
  const row = ctx.db.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number };
  if (row.n > 0) return false;
  await seedTenant(ctx, DEMO_HAULER, { history: true });
  return true;
}
