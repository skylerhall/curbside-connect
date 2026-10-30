// Dashboard API. Every handler runs against res.locals.tenant, so a request can
// only ever see its own hauler's data.
import { Router, type Request, type Response } from 'express';
import { TEMPLATE_CATALOG, renderTemplate, smsSegments, templateInfo } from '../../shared/catalog.ts';
import type { Channel, Customer, NotificationRequest, OverrideKind, TemplateKind, Tenant } from '../../shared/types.ts';
import { transaction } from '../db/database.ts';
import * as repo from '../db/repo.ts';
import { DEMO_HAULER, seedTenant } from '../db/seed.ts';
import { runAutomation } from '../engine/automations.ts';
import { handleInboundSms } from '../engine/consent.ts';
import { type AppContext, nowIso, preferencesUrl } from '../engine/context.ts';
import { defaultTemplate } from '../engine/default-templates.ts';
import { cancelCampaign, executeNotification, releaseCampaign } from '../engine/dispatch.ts';
import { RequestError, buildPlan } from '../engine/plan.ts';
import { sampleVars } from '../engine/samples.ts';
import { holidaySlidePlan, isRecyclingWeek, nextPickupForRoute, pickupsOn } from '../engine/schedule.ts';
import { formatPhone, toE164 } from '../lib/contact.ts';
import { WEEKDAYS, addDays, daysBetween, isDate, lastDueDate, nextDueDate, shortDate, todayIn, upcomingHolidays } from '../lib/dates.ts';

const ACTOR = 'Dispatch office';

function tenantOf(res: Response): Tenant {
  return res.locals.tenant as Tenant;
}

function today(ctx: AppContext, tenant: Tenant): string {
  return todayIn(tenant.timezone, ctx.now());
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function apiRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const r = Router();

  // ── Bootstrap & overview ────────────────────────────────────────────────

  r.get('/bootstrap', (_req, res) => {
    const tenant = tenantOf(res);
    res.json({
      tenant,
      tenants: repo.listTenants(db).map((t) => ({ slug: t.slug, name: t.name })),
      providers: ctx.providers.status(),
      today: today(ctx, tenant),
      routes: repo.listRoutes(db, tenant.id),
      catalog: TEMPLATE_CATALOG,
      smsCostPerSegment: ctx.config.smsCostPerSegment,
      authRequired: Boolean(ctx.config.demoPassword),
    });
  });

  r.get('/overview', (_req, res) => {
    const tenant = tenantOf(res);
    const t = today(ctx, tenant);
    const customers = repo.listCustomers(db, tenant.id).filter((c) => c.status === 'active');
    const reachable = customers.filter((c) => (c.smsOptIn && c.phone) || (c.emailOptIn && c.email));
    const since = new Date(ctx.now().getTime() - 14 * 86_400_000).toISOString();
    const stats = repo.messageStatsByDay(db, tenant.id, since);
    const days: { day: string; sms: number; email: number; failed: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(ctx.now().getTime() - i * 86_400_000).toISOString().slice(0, 10);
      const rows = stats.filter((s) => s.day === day);
      days.push({
        day,
        sms: rows.filter((s) => s.channel === 'sms').reduce((n, s) => n + s.n, 0),
        email: rows.filter((s) => s.channel === 'email').reduce((n, s) => n + s.n, 0),
        failed: rows.filter((s) => s.status === 'failed').reduce((n, s) => n + s.n, 0),
      });
    }
    const last7 = stats.filter((s) => s.day >= new Date(ctx.now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10));
    const sent7 = last7.reduce((n, s) => n + s.n, 0);
    const delivered7 = last7.filter((s) => s.status === 'delivered').reduce((n, s) => n + s.n, 0);
    const failed7 = last7.filter((s) => s.status === 'failed').reduce((n, s) => n + s.n, 0);

    const tomorrow = addDays(t, 1);
    const tomorrowPickups = pickupsOn(db, tenant.id, tomorrow).map((p) => ({
      routeId: p.route.id,
      routeName: p.route.name,
      customers: customers.filter((c) => repo.routeOn(c, p.originalDate) === p.route.id).length,
      recycling: isRecyclingWeek(p.route, p.originalDate),
      moved: p.override ? { from: p.originalDate, reason: p.override.holidayName ?? p.override.reason } : null,
    }));

    const overrides = repo.listOverrides(db, tenant.id, t).filter((o) => (o.newDate ?? o.originalDate) >= t);
    const due = nextDueDate(t, tenant.billingDueDay);
    const pastDue = customers.filter((c) => c.pastDueCents > 0);

    res.json({
      today: t,
      customers: customers.length,
      reachable: reachable.length,
      smsConsent: customers.filter((c) => c.smsOptIn && c.phone).length,
      emailConsent: customers.filter((c) => c.emailOptIn && c.email).length,
      last7: { sent: sent7, delivered: delivered7, failed: failed7 },
      series: days,
      tomorrow: { date: tomorrow, pickups: tomorrowPickups, automation: repo.getAutomation(db, tenant.id, 'pickup_reminder') },
      upcomingOverrides: overrides.slice(0, 6).map((o) => ({ ...o, routeName: repo.getRoute(db, tenant.id, o.routeId)?.name ?? '' })),
      holidays: upcomingHolidays(t, 3).map((h) => ({ ...h, applied: repo.listOverrides(db, tenant.id).some((o) => o.holidayName === h.name && daysBetween(h.date, o.originalDate) >= 0 && daysBetween(h.date, o.originalDate) < 6) })),
      billing: { nextDue: due, pastDueAccounts: pastDue.length, pastDueCents: pastDue.reduce((n, c) => n + c.pastDueCents, 0) },
      recentCampaigns: repo.listCampaigns(db, tenant.id, 6),
    });
  });

  // ── Customers ───────────────────────────────────────────────────────────

  r.get('/customers', (req, res) => {
    const tenant = tenantOf(res);
    const consent = str(req.query.consent);
    res.json(
      repo.listCustomers(db, tenant.id, {
        routeId: str(req.query.routeId) || undefined,
        search: str(req.query.search) || undefined,
        consent: consent === 'sms' || consent === 'email' || consent === 'none' ? consent : undefined,
      }),
    );
  });

  r.get('/customers/:id', (req, res) => {
    const tenant = tenantOf(res);
    const customer = repo.getCustomer(db, tenant.id, req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const route = repo.getRoute(db, tenant.id, customer.routeId);
    res.json({
      customer,
      route,
      nextRoute: customer.nextRouteId ? repo.getRoute(db, tenant.id, customer.nextRouteId) : null,
      nextPickup: route ? nextPickupForRoute(db, route, today(ctx, tenant)) : null,
      preferencesUrl: preferencesUrl(ctx, customer.preferenceToken),
      messages: repo.listMessages(db, tenant.id, { customerId: customer.id, limit: 25 }).items,
      consentEvents: repo.listConsentEvents(db, tenant.id, 20, customer.id),
    });
  });

  r.post('/customers', (req, res) => {
    const tenant = tenantOf(res);
    const b = req.body ?? {};
    const firstName = str(b.firstName);
    const lastName = str(b.lastName);
    const phone = str(b.phone) || null;
    const email = str(b.email).toLowerCase() || null;
    const route = repo.getRoute(db, tenant.id, str(b.routeId));
    if (!firstName || !lastName) throw new RequestError('First and last name are required.');
    if (!route) throw new RequestError('Pick a route.');
    if (phone && !toE164(phone)) throw new RequestError('Enter a 10-digit US mobile number.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RequestError('Enter a valid email address.');
    if (!phone && !email) throw new RequestError('Add a mobile number or an email address.');
    const now = nowIso(ctx);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?').get(tenant.id) as { n: number }).n;
    const customer: Customer = {
      id: repo.newId('cus'),
      tenantId: tenant.id,
      routeId: route.id,
      accountNumber: `DEMO-${String(count + 1).padStart(4, '0')}`,
      firstName,
      lastName,
      serviceAddress: str(b.serviceAddress) || '100 Demo Street',
      city: str(b.city) || route.area.split(',')[0],
      state: 'CO',
      zip: str(b.zip) || '80610',
      phone: phone ? formatPhone(phone) : null,
      email,
      serviceLevel: '96-gal trash + recycling',
      monthlyRateCents: 3450,
      pastDueCents: b.pastDue ? 3450 : 0,
      autopay: Boolean(b.autopay),
      status: 'active',
      smsOptIn: Boolean(b.smsOptIn) && !!phone,
      emailOptIn: Boolean(b.emailOptIn) && !!email,
      notifyPickup: true,
      notifyService: true,
      notifyBilling: true,
      consentSource: 'Added in dashboard (consent confirmed by operator)',
      consentUpdatedAt: now,
      preferenceToken: repo.randomString(10),
      nextRouteId: null,
      nextRouteEffective: null,
      isDemoContact: true,
      createdAt: now,
    };
    transaction(db, () => {
      repo.insertCustomer(db, customer);
      db.prepare('INSERT INTO consent_events (tenant_id, customer_id, change, source, at) VALUES (?,?,?,?,?)').run(
        tenant.id,
        customer.id,
        [customer.smsOptIn ? 'SMS on' : null, customer.emailOptIn ? 'Email on' : null].filter(Boolean).join(', ') || 'No channels',
        'Added in dashboard',
        now,
      );
      repo.audit(db, tenant.id, ACTOR, 'customer.created', `Added demo contact ${firstName} ${lastName} on ${route.name}.`, now);
    });
    res.status(201).json(customer);
  });

  r.patch('/customers/:id/preferences', (req, res) => {
    const tenant = tenantOf(res);
    const customer = repo.getCustomer(db, tenant.id, req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (req.body?.smsOptIn === true && !customer.phone) throw new RequestError('This customer has no mobile number on file.');
    if (req.body?.emailOptIn === true && !customer.email) throw new RequestError('This customer has no email on file.');
    const now = nowIso(ctx);
    const changes = repo.updatePreferences(db, customer, req.body ?? {}, 'Office (dashboard)', now);
    if (changes.length) repo.audit(db, tenant.id, ACTOR, 'consent.updated', `${customer.firstName} ${customer.lastName}: ${changes.join(', ')}.`, now);
    res.json(repo.getCustomer(db, tenant.id, customer.id));
  });

  r.post('/customers/:id/simulate-reply', (req, res) => {
    const tenant = tenantOf(res);
    const customer = repo.getCustomer(db, tenant.id, req.params.id);
    if (!customer?.phone) return res.status(404).json({ error: 'Customer has no phone number' });
    const result = handleInboundSms(ctx, tenant, customer.phone, str(req.body?.body) || 'STOP', 'SMS reply (simulated)');
    res.json({ action: result.action, reply: result.reply, customer: repo.getCustomer(db, tenant.id, customer.id) });
  });

  // ── Routes & schedule ───────────────────────────────────────────────────

  r.get('/routes', (_req, res) => {
    const tenant = tenantOf(res);
    const t = today(ctx, tenant);
    res.json(
      repo.listRoutes(db, tenant.id).map((route) => {
        const next = nextPickupForRoute(db, route, t);
        return { ...route, serviceDayName: WEEKDAYS[route.serviceDay], nextPickup: next, recyclingNext: isRecyclingWeek(route, next.originalDate) };
      }),
    );
  });

  r.get('/schedule', (req, res) => {
    const tenant = tenantOf(res);
    const from = isDate(req.query.from) ? req.query.from : today(ctx, tenant);
    const days = Math.min(Number(req.query.days) || 21, 62);
    const calendar = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      calendar.push({
        date,
        pickups: pickupsOn(db, tenant.id, date).map((p) => ({
          routeId: p.route.id,
          routeName: p.route.name,
          code: p.route.code,
          recycling: isRecyclingWeek(p.route, p.originalDate),
          override: p.override,
        })),
      });
    }
    res.json({ from, calendar });
  });

  r.get('/overrides', (_req, res) => {
    const tenant = tenantOf(res);
    const routes = new Map(repo.listRoutes(db, tenant.id).map((x) => [x.id, x]));
    res.json(
      repo
        .listOverrides(db, tenant.id, addDays(today(ctx, tenant), -30))
        .map((o) => ({ ...o, routeName: routes.get(o.routeId)?.name ?? '', routeCode: routes.get(o.routeId)?.code ?? '' }))
        .reverse(),
    );
  });

  r.post('/overrides', (req, res) => {
    const tenant = tenantOf(res);
    const b = req.body ?? {};
    const routeIds: string[] = Array.isArray(b.routeIds) ? b.routeIds : [];
    const kind = (['holiday', 'weather', 'operational'].includes(b.kind) ? b.kind : 'weather') as OverrideKind;
    const reason = str(b.reason);
    const newDate = b.newDate === null || b.newDate === '' ? null : str(b.newDate);
    if (!routeIds.length) throw new RequestError('Pick at least one route.');
    if (!reason) throw new RequestError('Add a short reason customers will see.');
    if (newDate && !isDate(newDate)) throw new RequestError('New date is invalid.');
    const created = transaction(db, () =>
      routeIds.map((routeId) => {
        const route = repo.getRoute(db, tenant.id, routeId);
        if (!route) throw new RequestError('Route not found.');
        // Default to the route's next regular pickup if no date was given.
        const originalDate = isDate(b.originalDate) ? b.originalDate : nextPickupForRoute(db, route, today(ctx, tenant)).originalDate;
        if (newDate && newDate === originalDate) throw new RequestError('The new date matches the original date.');
        const o = {
          id: repo.newId('ov'),
          tenantId: tenant.id,
          routeId,
          originalDate,
          newDate,
          kind,
          reason,
          holidayName: kind === 'holiday' ? str(b.holidayName) || reason : null,
          createdAt: nowIso(ctx),
          notifiedCampaignId: null,
        };
        repo.insertOverride(db, o);
        return repo.findOverride(db, tenant.id, routeId, originalDate)!;
      }),
    );
    repo.audit(db, tenant.id, ACTOR, 'schedule.override', `Created ${created.length} schedule change(s): ${reason}.`, nowIso(ctx));
    res.status(201).json(created);
  });

  r.delete('/overrides/:id', (req, res) => {
    const tenant = tenantOf(res);
    const o = repo.getOverride(db, tenant.id, req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    repo.deleteOverride(db, tenant.id, o.id);
    repo.audit(db, tenant.id, ACTOR, 'schedule.override_removed', `Removed schedule change for ${o.originalDate} (${o.reason}).`, nowIso(ctx));
    res.json({ ok: true, wasNotified: Boolean(o.notifiedCampaignId) });
  });

  r.get('/holidays', (_req, res) => {
    const tenant = tenantOf(res);
    const routes = repo.listRoutes(db, tenant.id);
    const overrides = repo.listOverrides(db, tenant.id);
    res.json(
      upcomingHolidays(today(ctx, tenant), 6).map((h) => {
        const plan = holidaySlidePlan(routes, h.date);
        const applied = plan.length > 0 && plan.every((p) => overrides.some((o) => o.routeId === p.routeId && o.originalDate === p.originalDate));
        const notified = applied && plan.every((p) => overrides.find((o) => o.routeId === p.routeId && o.originalDate === p.originalDate)?.notifiedCampaignId);
        return { ...h, weekday: WEEKDAYS[new Date(`${h.date}T12:00:00Z`).getUTCDay()], plan, applied, notified };
      }),
    );
  });

  r.post('/overrides/holiday-slide', (req, res) => {
    const tenant = tenantOf(res);
    const date = str(req.body?.date);
    const name = str(req.body?.name) || 'Holiday';
    if (!isDate(date)) throw new RequestError('Holiday date is invalid.');
    const plan = holidaySlidePlan(repo.listRoutes(db, tenant.id), date);
    if (!plan.length) throw new RequestError('This holiday falls on a weekend, so no pickups move.');
    const created = transaction(db, () =>
      plan.map((p) => {
        repo.insertOverride(db, {
          id: repo.newId('ov'),
          tenantId: tenant.id,
          routeId: p.routeId,
          originalDate: p.originalDate,
          newDate: p.newDate,
          kind: 'holiday',
          reason: `${name} holiday schedule`,
          holidayName: name,
          createdAt: nowIso(ctx),
          notifiedCampaignId: null,
        });
        return repo.findOverride(db, tenant.id, p.routeId, p.originalDate)!;
      }),
    );
    repo.audit(db, tenant.id, ACTOR, 'schedule.holiday', `Applied ${name} slide: ${plan.length} route(s) move one day.`, nowIso(ctx));
    res.status(201).json(created);
  });

  // ── Notifications (the core flow) ───────────────────────────────────────

  // Body: { request: NotificationRequest, retryFailed?: boolean }
  r.post('/notifications/preview', (req, res) => {
    const tenant = tenantOf(res);
    res.json(buildPlan(ctx, tenant, req.body?.request as NotificationRequest, { retryFailed: req.body?.retryFailed === true }));
  });

  r.post('/notifications/send', async (req, res) => {
    const tenant = tenantOf(res);
    const request = req.body?.request as NotificationRequest;
    const { campaign, plan } = await executeNotification(ctx, tenant, request, { trigger: 'manual', actor: ACTOR, retryFailed: req.body?.retryFailed === true });
    res.status(201).json({ campaign, summary: plan.summary });
  });

  r.get('/campaigns', (req, res) => {
    res.json(repo.listCampaigns(db, tenantOf(res).id, Math.min(Number(req.query.limit) || 50, 200), str(req.query.kind) || undefined));
  });

  r.get('/campaigns/:id', (req, res) => {
    const tenant = tenantOf(res);
    const campaign = repo.getCampaign(db, tenant.id, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign, messages: repo.listMessages(db, tenant.id, { campaignId: campaign.id, limit: 1000 }).items });
  });

  r.post('/campaigns/:id/cancel', (req, res) => {
    const tenant = tenantOf(res);
    if (!cancelCampaign(ctx, tenant.id, req.params.id, ACTOR)) {
      const c = repo.getCampaign(db, tenant.id, req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      return res.status(409).json({ error: c.status === 'cancelled' ? 'Already cancelled. Nothing was sent.' : 'Too late to cancel: it has already been sent. Use “Send a correction” instead.' });
    }
    res.json(repo.getCampaign(db, tenant.id, req.params.id));
  });

  r.post('/campaigns/:id/send-now', async (req, res) => {
    const tenant = tenantOf(res);
    if (!(await releaseCampaign(ctx, tenant.id, req.params.id, ACTOR))) return res.status(409).json({ error: 'This notification is no longer waiting to send.' });
    res.json(repo.getCampaign(db, tenant.id, req.params.id));
  });

  // Suggested wording and options for correcting a notification sent by mistake.
  r.get('/campaigns/:id/correction-draft', (req, res) => {
    const tenant = tenantOf(res);
    const c = repo.getCampaign(db, tenant.id, req.params.id);
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const params = c.params as NotificationRequest;
    const overrides = repo.overridesNotifiedBy(db, tenant.id, c.id);
    let message = 'Please disregard our last message. Sorry for the mix-up!';
    let undoLabel: string | null = null;
    if (c.kind === 'schedule_change') {
      const dates = [...new Set(overrides.map((o) => shortDate(o.originalDate)))];
      message = dates.length === 1 ? `Please disregard our last text. Your ${dates[0]} pickup is still on schedule. Sorry!` : 'Please disregard our last text. Your pickup is still on its regular schedule. Sorry!';
      if (overrides.length) undoLabel = `Also remove the schedule change (${overrides.length} route${overrides.length === 1 ? '' : 's'}) so the calendar goes back to normal`;
    } else if (c.kind === 'pickup_reminder') {
      message = 'Please disregard our last reminder. Your pickup is on your regular day. Sorry!';
    } else if (c.kind === 'billing_reminder') {
      message = 'Please disregard our last billing message. Sorry for the mix-up!';
    } else if (c.kind === 'alert') {
      message = 'Please disregard our last alert. Service is running normally today. Sorry!';
    } else if (c.kind === 'route_change' && params.kind === 'route_change') {
      message = 'Please disregard our last message. Your pickup day is not changing. Sorry!';
      undoLabel = 'Also cancel the scheduled pickup-day change for these customers';
    }
    res.json({ campaign: c, message, undoLabel, recipients: repo.campaignRecipients(db, tenant.id, c.id).size });
  });

  r.get('/messages', (req, res) => {
    const tenant = tenantOf(res);
    res.json(
      repo.listMessages(db, tenant.id, {
        status: str(req.query.status) || undefined,
        channel: str(req.query.channel) || undefined,
        kind: str(req.query.kind) || undefined,
        search: str(req.query.search) || undefined,
        limit: Math.min(Number(req.query.limit) || 50, 200),
        offset: Number(req.query.offset) || 0,
      }),
    );
  });

  r.get('/messages/:id', (req, res) => {
    const m = repo.getMessage(db, tenantOf(res).id, req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    res.json(m);
  });

  // ── Templates ───────────────────────────────────────────────────────────

  r.get('/templates', (_req, res) => {
    res.json(repo.listTemplates(db, tenantOf(res).id));
  });

  r.put('/templates/:id', (req, res) => {
    const tenant = tenantOf(res);
    const t = repo.getTemplateById(db, tenant.id, req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    if (!body.trim()) throw new RequestError('Template body cannot be empty.');
    if (body.length > 2000) throw new RequestError('Template is too long.');
    const subject = t.channel === 'email' ? str(req.body?.subject) || t.subject : null;
    const def = defaultTemplate(t.kind, t.channel);
    repo.upsertTemplate(db, { ...t, subject, body, isCustomized: body !== def.body || subject !== def.subject, updatedAt: nowIso(ctx) });
    repo.audit(db, tenant.id, ACTOR, 'template.updated', `Edited "${templateInfo(t.kind).label}" (${t.channel.toUpperCase()}).`, nowIso(ctx));
    res.json(repo.getTemplateById(db, tenant.id, t.id));
  });

  r.post('/templates/:id/reset', (req, res) => {
    const tenant = tenantOf(res);
    const t = repo.getTemplateById(db, tenant.id, req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    const def = defaultTemplate(t.kind, t.channel);
    repo.upsertTemplate(db, { ...t, subject: def.subject, body: def.body, isCustomized: false, updatedAt: nowIso(ctx) });
    repo.audit(db, tenant.id, ACTOR, 'template.reset', `Reset "${templateInfo(t.kind).label}" (${t.channel.toUpperCase()}) to default.`, nowIso(ctx));
    res.json(repo.getTemplateById(db, tenant.id, t.id));
  });

  r.post('/templates/preview', (req, res) => {
    const tenant = tenantOf(res);
    const kind = str(req.body?.kind) as TemplateKind;
    const channel = (str(req.body?.channel) === 'email' ? 'email' : 'sms') as Channel;
    if (!TEMPLATE_CATALOG.some((c) => c.kind === kind)) throw new RequestError('Unknown template kind.');
    const customer = req.body?.customerId ? repo.getCustomer(db, tenant.id, str(req.body.customerId)) : null;
    const route = customer ? repo.getRoute(db, tenant.id, customer.routeId) : (repo.listRoutes(db, tenant.id).find((x) => x.serviceDay === 4) ?? null);
    const vars = sampleVars(ctx, tenant, kind, customer, route);
    const body = renderTemplate(typeof req.body?.body === 'string' ? req.body.body : '', vars);
    const subject = channel === 'email' ? renderTemplate(str(req.body?.subject), vars) : null;
    res.json({
      body: body.text,
      subject: subject?.text ?? null,
      missing: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
      sms: channel === 'sms' ? smsSegments(body.text) : null,
    });
  });

  // ── Billing ─────────────────────────────────────────────────────────────

  r.get('/billing', (_req, res) => {
    const tenant = tenantOf(res);
    const t = today(ctx, tenant);
    const customers = repo.listCustomers(db, tenant.id).filter((c) => c.status === 'active');
    const manual = customers.filter((c) => !c.autopay);
    const autopay = customers.filter((c) => c.autopay);
    const pastDue = customers.filter((c) => c.pastDueCents > 0);
    const routes = new Map(repo.listRoutes(db, tenant.id).map((x) => [x.id, x.name]));
    const row = (c: Customer) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      accountNumber: c.accountNumber,
      routeName: routes.get(c.routeId) ?? '',
      monthlyRateCents: c.monthlyRateCents,
      pastDueCents: c.pastDueCents,
      autopay: c.autopay,
      sms: c.smsOptIn && !!c.phone,
      email: c.emailOptIn && !!c.email,
      notifyBilling: c.notifyBilling,
    });
    res.json({
      today: t,
      nextDue: nextDueDate(t, tenant.billingDueDay),
      lastDue: lastDueDate(t, tenant.billingDueDay),
      dueDay: tenant.billingDueDay,
      manual: { count: manual.length, totalCents: manual.reduce((n, c) => n + c.monthlyRateCents + c.pastDueCents, 0) },
      autopay: { count: autopay.length, totalCents: autopay.reduce((n, c) => n + c.monthlyRateCents, 0) },
      pastDue: { count: pastDue.length, totalCents: pastDue.reduce((n, c) => n + c.pastDueCents, 0) },
      accounts: customers.map(row),
      automation: repo.getAutomation(db, tenant.id, 'billing_reminder'),
      campaigns: repo.listCampaigns(db, tenant.id, 8, 'billing_reminder'),
    });
  });

  // ── Automations ─────────────────────────────────────────────────────────

  r.get('/automations', (_req, res) => {
    res.json(repo.listAutomations(db, tenantOf(res).id));
  });

  r.patch('/automations/:kind', (req, res) => {
    const tenant = tenantOf(res);
    const kind = req.params.kind;
    if (!repo.getAutomation(db, tenant.id, kind)) return res.status(404).json({ error: 'Automation not found' });
    const runTime = str(req.body?.runTime);
    if (runTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(runTime)) throw new RequestError('Run time must be HH:MM (24-hour).');
    repo.updateAutomation(db, tenant.id, kind, { enabled: req.body?.enabled, runTime: runTime || undefined, config: req.body?.config });
    const a = repo.getAutomation(db, tenant.id, kind)!;
    repo.audit(db, tenant.id, ACTOR, 'automation.updated', `${kind === 'pickup_reminder' ? 'Pickup' : 'Billing'} reminders ${a.enabled ? `on at ${a.runTime}` : 'paused'}.`, nowIso(ctx));
    res.json(a);
  });

  r.post('/automations/:kind/run', async (req, res) => {
    const tenant = tenantOf(res);
    const kind = req.params.kind;
    if (kind !== 'pickup_reminder' && kind !== 'billing_reminder') return res.status(404).json({ error: 'Automation not found' });
    res.json(await runAutomation(ctx, tenant, kind, ACTOR));
  });

  // ── Consent, audit, settings ────────────────────────────────────────────

  r.get('/consent-events', (_req, res) => {
    res.json(repo.listConsentEvents(db, tenantOf(res).id, 100));
  });

  r.get('/audit', (_req, res) => {
    res.json(repo.listAudit(db, tenantOf(res).id, 150));
  });

  r.patch('/tenant', (req, res) => {
    const tenant = tenantOf(res);
    const b = req.body ?? {};
    for (const key of ['brandPrimary', 'brandDark', 'brandAccent']) {
      if (b[key] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(b[key]))) throw new RequestError('Colors must be hex values like #176649.');
    }
    repo.updateTenant(db, tenant.id, b);
    repo.audit(db, tenant.id, ACTOR, 'tenant.updated', 'Updated company profile and branding.', nowIso(ctx));
    res.json(repo.getTenantById(db, tenant.id));
  });

  r.post('/demo/reset', async (_req, res) => {
    const tenant = tenantOf(res);
    if (tenant.slug !== DEMO_HAULER.tenant.slug) throw new RequestError('Only the demo tenant can be reset.');
    await seedTenant(ctx, DEMO_HAULER, { history: true });
    res.json({ ok: true });
  });

  return r;
}

/** Errors from handlers → JSON. RequestError is a user mistake (400); anything else is a 500. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: unknown): void {
  if (err instanceof RequestError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Check the server log.' });
}
