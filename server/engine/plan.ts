// Turns a notification request ("Thursday's pickup moves to Friday") into a
// concrete, auditable plan: who is affected, which channel each person gets,
// the exact rendered text, and why anyone is left out.
import { renderTemplate, smsSegments, templateInfo } from '../../shared/catalog.ts';
import type {
  Channel,
  Customer,
  NotificationRequest,
  Plan,
  PlannedMessage,
  Route,
  TemplateKind,
  Tenant,
} from '../../shared/types.ts';
import {
  campaignRecipients,
  existingDedupeKeys,
  getCampaign,
  getCustomer,
  getOverride,
  getRoute,
  getTemplate,
  listCustomers,
  listRoutes,
  routeOn,
} from '../db/repo.ts';
import { WEEKDAYS, addDays, daysBetween, lastDueDate, longDate, nextDueDate, nextWeekday, observedHolidays, shortDate, todayIn, weekday } from '../lib/dates.ts';
import { type AppContext, money, preferencesUrl, tenantVars } from './context.ts';
import { defaultTemplate } from './default-templates.ts';
import { isRecyclingWeek, nextPickupForRoute, pickupsOn } from './schedule.ts';

export class RequestError extends Error {}

interface Target {
  customer: Customer;
  route: Route | null;
  templateKind: TemplateKind;
  vars: Record<string, string>;
  dedupeBase: string | null;
  channels?: Channel[];
}

interface Selection {
  title: string;
  description: string;
  bypassCategory: boolean;
  targets: Target[];
  warnings?: string[];
}

function holidayOn(date: string): string | null {
  const year = Number(date.slice(0, 4));
  return observedHolidays(year).find((h) => h.date === date)?.name ?? null;
}

/** Sanity checks for a one-off schedule change. */
function overrideWarnings(today: string, routeName: string, originalDate: string, newDate: string | null): string[] {
  const w: string[] = [];
  const label = `${routeName} ${shortDate(originalDate)}`;
  if (originalDate < today) w.push(`${label}: that pickup date has already passed.`);
  if (!newDate) return w;
  if (newDate < today) w.push(`${label}: the new date (${shortDate(newDate)}) is in the past.`);
  if (weekday(newDate) === 0) w.push(`${label}: the new date is a Sunday.`);
  const holiday = holidayOn(newDate);
  if (holiday) w.push(`${label}: the new date is ${holiday}.`);
  const shift = daysBetween(originalDate, newDate);
  if (shift < 0) w.push(`${label}: this moves the pickup EARLIER, to ${shortDate(newDate)}. Customers may not have carts out in time.`);
  else if (shift > 3) w.push(`${label}: this moves the pickup ${shift} days later.`);
  return w;
}

const ALERT_LABELS = { advisory: 'Service advisory', delay: 'Weather delay', emergency: 'EMERGENCY ALERT' } as const;

function customerVars(ctx: AppContext, tenant: Tenant, c: Customer, route: Route | null): Record<string, string> {
  return {
    ...tenantVars(tenant),
    first_name: c.firstName,
    last_name: c.lastName,
    service_address: c.serviceAddress,
    account_number: c.accountNumber,
    route_name: route?.name ?? '',
    preferences_url: preferencesUrl(ctx, c.preferenceToken),
  };
}

function routeMap(ctx: AppContext, tenantId: string): Map<string, Route> {
  return new Map(listRoutes(ctx.db, tenantId).map((r) => [r.id, r]));
}

function select(ctx: AppContext, tenant: Tenant, req: NotificationRequest): Selection {
  const { db } = ctx;
  const today = todayIn(tenant.timezone, ctx.now());
  const routes = routeMap(ctx, tenant.id);
  const customers = listCustomers(db, tenant.id);

  switch (req.kind) {
    case 'pickup_reminder': {
      const pickups = pickupsOn(db, tenant.id, req.serviceDate).filter((p) => !req.routeIds?.length || req.routeIds.includes(p.route.id));
      const targets: Target[] = [];
      for (const p of pickups) {
        const recycling = isRecyclingWeek(p.route, p.originalDate);
        const moved = p.override
          ? ` Note: this week's pickup moved from ${shortDate(p.originalDate)} (${p.override.holidayName ?? p.override.reason}).`
          : '';
        for (const c of customers.filter((c) => routeOn(c, p.originalDate) === p.route.id)) {
          targets.push({
            customer: c,
            route: p.route,
            templateKind: 'pickup_reminder',
            dedupeBase: `pickup:${req.serviceDate}`,
            vars: {
              ...customerVars(ctx, tenant, c, p.route),
              service_date_short: shortDate(req.serviceDate),
              service_date_long: longDate(req.serviceDate),
              pickup_type: recycling ? 'trash and recycling' : 'trash',
              schedule_note: moved,
            },
          });
        }
      }
      const names = pickups.map((p) => p.route.name + (p.override ? ' (rescheduled)' : ''));
      return {
        title: `Pickup reminders for ${longDate(req.serviceDate)}`,
        description: pickups.length ? `Routes collecting ${shortDate(req.serviceDate)}: ${names.join(', ')}.` : `No routes are collected on ${shortDate(req.serviceDate)}.`,
        bypassCategory: false,
        targets,
        warnings:
          req.serviceDate < today
            ? [`${shortDate(req.serviceDate)} is in the past.`]
            : req.serviceDate !== addDays(today, 1)
              ? [`The reminder says the pickup is “tomorrow”, but ${shortDate(req.serviceDate)} isn’t tomorrow. Send it the day before instead.`]
              : [],
      };
    }

    case 'schedule_change': {
      if (!req.overrideIds?.length) throw new RequestError('Choose at least one schedule change to notify.');
      const targets: Target[] = [];
      const labels: string[] = [];
      const warnings: string[] = [];
      let holidayName: string | null = null;
      for (const id of req.overrideIds) {
        const o = getOverride(db, tenant.id, id);
        if (!o) throw new RequestError(`Schedule change ${id} not found.`);
        const route = routes.get(o.routeId) ?? null;
        if (!route) continue;
        holidayName = o.kind === 'holiday' ? o.holidayName : holidayName;
        const templateKind: TemplateKind = o.kind === 'holiday' ? 'holiday_change' : 'service_change';
        let changeSummary: string;
        let headline: string;
        if (o.newDate) {
          changeSummary = `Your ${shortDate(o.originalDate)} pickup moves to ${shortDate(o.newDate)}.`;
          headline = `pickup moved to ${shortDate(o.newDate)}`;
        } else {
          const next = nextPickupForRoute(db, route, addDays(o.originalDate, 1));
          changeSummary = `Your ${shortDate(o.originalDate)} pickup is cancelled. Your next pickup is ${shortDate(next.serviceDate)}.`;
          headline = `${shortDate(o.originalDate)} pickup cancelled`;
        }
        labels.push(`${route.name} ${shortDate(o.originalDate)} → ${o.newDate ? shortDate(o.newDate) : 'cancelled'}`);
        warnings.push(...overrideWarnings(today, route.name, o.originalDate, o.newDate));
        for (const c of customers.filter((c) => routeOn(c, o.originalDate) === route.id)) {
          targets.push({
            customer: c,
            route,
            templateKind,
            dedupeBase: `override:${o.id}`,
            vars: {
              ...customerVars(ctx, tenant, c, route),
              holiday_name: o.holidayName ?? o.reason,
              reason: o.reason,
              original_day: WEEKDAYS[weekday(o.originalDate)],
              original_date_short: shortDate(o.originalDate),
              original_date_long: longDate(o.originalDate),
              new_date_short: o.newDate ? shortDate(o.newDate) : 'cancelled',
              new_date_long: o.newDate ? longDate(o.newDate) : 'cancelled',
              change_summary: changeSummary,
              change_headline: headline,
            },
          });
        }
      }
      return {
        title: holidayName ? `${holidayName} schedule change` : `Service change: ${labels.length === 1 ? labels[0] : `${labels.length} routes`}`,
        description: labels.join('; '),
        bypassCategory: false,
        targets,
        warnings,
      };
    }

    case 'route_change': {
      const toRoute = getRoute(db, tenant.id, req.toRouteId);
      if (!toRoute) throw new RequestError('Destination route not found.');
      if (!req.effectiveDate || req.effectiveDate < today) throw new RequestError('Effective date must be today or later.');
      const targets: Target[] = [];
      for (const id of req.customerIds ?? []) {
        const c = getCustomer(db, tenant.id, id);
        if (!c) throw new RequestError(`Customer ${id} not found.`);
        const fromRoute = routes.get(c.routeId) ?? null;
        if (!fromRoute || fromRoute.id === toRoute.id) continue;
        targets.push({
          customer: c,
          route: toRoute,
          templateKind: 'route_change',
          dedupeBase: `route_change:${toRoute.id}:${req.effectiveDate}`,
          vars: {
            ...customerVars(ctx, tenant, c, toRoute),
            old_service_day: WEEKDAYS[fromRoute.serviceDay],
            new_service_day: WEEKDAYS[toRoute.serviceDay],
            effective_date_short: shortDate(req.effectiveDate),
            effective_date_long: longDate(req.effectiveDate),
            first_new_pickup_long: longDate(nextWeekday(req.effectiveDate, toRoute.serviceDay)),
          },
        });
      }
      if (!targets.length) throw new RequestError('Select customers who are not already on the destination route.');
      return {
        title: `Pickup day change: ${targets.length} customer${targets.length === 1 ? '' : 's'} to ${toRoute.name}`,
        description: `Moving to ${toRoute.name} (${WEEKDAYS[toRoute.serviceDay]}) effective ${shortDate(req.effectiveDate)}.`,
        bypassCategory: false,
        targets,
        warnings: daysBetween(today, req.effectiveDate) < 7 ? [`Less than a week’s notice: the change takes effect ${shortDate(req.effectiveDate)}.`] : [],
      };
    }

    case 'billing_reminder': {
      const due = nextDueDate(today, tenant.billingDueDay);
      const lastDue = lastDueDate(today, tenant.billingDueDay);
      const ids = req.customerIds?.length ? new Set(req.customerIds) : null;
      const pool = customers.filter((c) => c.status === 'active' && (!ids || ids.has(c.id)));
      let chosen: Customer[];
      let templateKind: TemplateKind;
      let dedupeBase: string;
      let title: string;
      let description: string;
      if (req.mode === 'upcoming') {
        chosen = pool.filter((c) => !c.autopay && c.monthlyRateCents + c.pastDueCents > 0);
        templateKind = 'billing_upcoming';
        dedupeBase = `billing_upcoming:${due}`;
        title = `Upcoming bill reminders (due ${shortDate(due)})`;
        description = `Customers who pay manually, for the statement due ${longDate(due)}.`;
      } else if (req.mode === 'autopay') {
        chosen = pool.filter((c) => c.autopay);
        templateKind = 'billing_autopay';
        dedupeBase = `billing_autopay:${due}`;
        title = `Autopay heads-up (processes ${shortDate(due)})`;
        description = `Autopay customers, payment processing ${longDate(due)}.`;
      } else if (req.mode === 'past_due') {
        chosen = pool.filter((c) => c.pastDueCents > 0);
        templateKind = 'billing_past_due';
        dedupeBase = `billing_past_due:${lastDue}`;
        title = 'Past-due balance notices';
        description = `Accounts with an unpaid balance from the ${shortDate(lastDue)} statement or earlier.`;
      } else {
        throw new RequestError('Unknown billing reminder type.');
      }
      return {
        title,
        description,
        bypassCategory: false,
        targets: chosen.map((c) => ({
          customer: c,
          route: routes.get(c.routeId) ?? null,
          templateKind,
          dedupeBase,
          vars: {
            ...customerVars(ctx, tenant, c, routes.get(c.routeId) ?? null),
            amount_due: money(req.mode === 'autopay' ? c.monthlyRateCents : c.monthlyRateCents + c.pastDueCents),
            past_due: money(c.pastDueCents),
            due_date_short: shortDate(due),
            due_date_long: longDate(due),
          },
        })),
      };
    }

    case 'alert': {
      const message = (req.message ?? '').trim();
      if (!message) throw new RequestError('Write the alert message first.');
      if (!req.channels?.length) throw new RequestError('Pick at least one channel.');
      const label = ALERT_LABELS[req.severity] ?? ALERT_LABELS.advisory;
      const scope = req.routeIds === 'all' ? null : new Set(req.routeIds);
      if (scope && scope.size === 0) throw new RequestError('Pick at least one route.');
      const chosen = customers.filter((c) => !scope || scope.has(c.routeId));
      const routeNames = scope ? [...scope].map((id) => routes.get(id)?.name ?? id).join(', ') : 'all routes';
      return {
        title: `${label}: ${message.length > 60 ? `${message.slice(0, 57)}...` : message}`,
        description: `${label} to ${routeNames} via ${req.channels.map((c) => c.toUpperCase()).join(' + ')}.`,
        bypassCategory: req.severity === 'emergency',
        warnings: [
          ...(req.severity === 'emergency' ? ['Emergency alerts also reach customers who turned off service alerts.'] : []),
          ...(req.routeIds === 'all' ? [`This goes to every route (${chosen.length} customers).`] : []),
        ],
        targets: chosen.map((c) => ({
          customer: c,
          route: routes.get(c.routeId) ?? null,
          templateKind: 'alert' as const,
          dedupeBase: null,
          channels: req.channels,
          vars: { ...customerVars(ctx, tenant, c, routes.get(c.routeId) ?? null), alert_label: label, alert_message: /[.!?]$/.test(message) ? message : `${message}.` },
        })),
      };
    }

    case 'correction': {
      const original = getCampaign(db, tenant.id, req.campaignId);
      if (!original) throw new RequestError('The original notification was not found.');
      if (original.kind === 'correction') throw new RequestError('Corrections can’t themselves be corrected. Send an alert instead.');
      if (original.status === 'held') throw new RequestError('That notification hasn’t gone out yet. Cancel it instead.');
      if (original.status === 'cancelled') throw new RequestError('That notification was cancelled, so nobody received it.');
      const message = (req.message ?? '').trim();
      if (!message) throw new RequestError('Write the correction message first.');
      const recipients = campaignRecipients(db, tenant.id, original.id);
      const targets: Target[] = [];
      for (const [customerId, channels] of recipients) {
        const c = customers.find((x) => x.id === customerId);
        if (!c) continue;
        const route = routes.get(c.routeId) ?? null;
        targets.push({
          customer: c,
          route,
          templateKind: 'correction',
          dedupeBase: `correction:${original.id}`,
          channels: [...new Set(channels)],
          vars: { ...customerVars(ctx, tenant, c, route), correction_message: /[.!?]$/.test(message) ? message : `${message}.`, original_title: original.title },
        });
      }
      return {
        title: `Correction: ${original.title}`,
        description: `Goes only to the ${recipients.size} customer${recipients.size === 1 ? '' : 's'} who received the original, on the same channel${recipients.size === 1 ? '' : 's'}.`,
        // They got the original, so they get the correction regardless of topic settings (channel consent still applies).
        bypassCategory: true,
        targets,
      };
    }

    default:
      throw new RequestError('Unknown notification type.');
  }
}

const CATEGORY_LABEL = { pickup: 'pickup reminders', service: 'service alerts', billing: 'billing reminders' } as const;

function categoryAllowed(c: Customer, category: 'pickup' | 'service' | 'billing'): boolean {
  if (category === 'pickup') return c.notifyPickup;
  if (category === 'service') return c.notifyService;
  return c.notifyBilling;
}

function emailFooter(tenant: Tenant, c: Customer, prefUrl: string): string {
  return `\n\n--\nYou're receiving this as a ${tenant.name} customer at ${c.serviceAddress}.\nManage your notification preferences: ${prefUrl}`;
}

export interface PlanOptions {
  /** Re-attempt (event, customer, channel) combinations whose earlier send failed. */
  retryFailed?: boolean;
}

export function buildPlan(ctx: AppContext, tenant: Tenant, req: NotificationRequest, opts: PlanOptions = {}): Plan {
  if (!req || typeof req !== 'object') throw new RequestError('Missing notification request.');
  const selection = select(ctx, tenant, req);
  const templateCache = new Map<string, { subject: string | null; body: string }>();
  const template = (kind: TemplateKind, channel: Channel) => {
    const key = `${kind}:${channel}`;
    if (!templateCache.has(key)) {
      const t = getTemplate(ctx.db, tenant.id, kind, channel) ?? defaultTemplate(kind, channel);
      templateCache.set(key, { subject: t.subject, body: t.body });
    }
    return templateCache.get(key)!;
  };

  // Look up which (event, customer, channel) combinations were already notified.
  const candidateKeys: string[] = [];
  for (const t of selection.targets) {
    if (t.dedupeBase) for (const ch of ['sms', 'email']) candidateKeys.push(`${t.dedupeBase}:${t.customer.id}:${ch}`);
  }
  const previous = existingDedupeKeys(ctx.db, tenant.id, candidateKeys);

  const messages: PlannedMessage[] = [];
  const seen = new Set<string>();
  const skip = (t: Target, reason: string) =>
    messages.push({
      customerId: t.customer.id,
      customerName: `${t.customer.firstName} ${t.customer.lastName}`,
      routeName: t.route?.name ?? null,
      channel: null,
      to: null,
      subject: null,
      body: null,
      segments: 0,
      status: 'skipped',
      skipReason: reason,
      templateKind: t.templateKind,
      dedupeKey: null,
    });

  for (const t of selection.targets) {
    const c = t.customer;
    const uniq = `${c.id}:${t.dedupeBase ?? t.templateKind}`;
    if (seen.has(uniq)) continue;
    seen.add(uniq);

    const category = templateInfo(t.templateKind).category;
    if (c.status !== 'active') {
      skip(t, 'Inactive account');
      continue;
    }
    if (!selection.bypassCategory && !categoryAllowed(c, category)) {
      skip(t, `Opted out of ${CATEGORY_LABEL[category]}`);
      continue;
    }

    const allowed = t.channels ?? (['sms', 'email'] as Channel[]);
    const eligible = allowed.filter((ch) => (ch === 'sms' ? c.smsOptIn && !!c.phone : c.emailOptIn && !!c.email));
    if (!eligible.length) {
      skip(t, allowed.length === 2 ? 'No SMS or email consent' : allowed[0] === 'sms' ? 'No SMS consent' : 'No email consent');
      continue;
    }
    const prior = (ch: Channel) => (t.dedupeBase ? previous.get(`${t.dedupeBase}:${c.id}:${ch}`) : undefined);
    const pending = eligible.filter((ch) => !prior(ch) || (prior(ch) === 'failed' && opts.retryFailed));
    if (!pending.length) {
      skip(t, eligible.some((ch) => prior(ch) === 'notified') ? 'Already notified' : 'Previous attempt failed');
      continue;
    }

    for (const ch of pending) {
      const tpl = template(t.templateKind, ch);
      let body = renderTemplate(tpl.body, t.vars).text;
      if (ch === 'email') body += emailFooter(tenant, c, t.vars.preferences_url);
      const subject = ch === 'email' && tpl.subject ? renderTemplate(tpl.subject, t.vars).text : null;
      messages.push({
        customerId: c.id,
        customerName: `${c.firstName} ${c.lastName}`,
        routeName: t.route?.name ?? null,
        channel: ch,
        to: ch === 'sms' ? c.phone : c.email,
        subject,
        body,
        segments: ch === 'sms' ? smsSegments(body).segments : 0,
        status: 'ready',
        skipReason: null,
        templateKind: t.templateKind,
        dedupeKey: t.dedupeBase ? `${t.dedupeBase}:${c.id}:${ch}` : null,
      });
    }
  }

  const ready = messages.filter((m) => m.status === 'ready');
  const skipped = messages.filter((m) => m.status === 'skipped');
  const skipReasons: Record<string, number> = {};
  for (const m of skipped) skipReasons[m.skipReason!] = (skipReasons[m.skipReason!] ?? 0) + 1;
  const smsSegmentsTotal = ready.filter((m) => m.channel === 'sms').reduce((n, m) => n + m.segments, 0);

  return {
    kind: req.kind,
    title: selection.title,
    description: selection.description,
    bypassCategory: selection.bypassCategory,
    messages,
    warnings: selection.warnings ?? [],
    summary: {
      matchedCustomers: new Set(messages.map((m) => m.customerId)).size,
      reachedCustomers: new Set(ready.map((m) => m.customerId)).size,
      smsMessages: ready.filter((m) => m.channel === 'sms').length,
      emailMessages: ready.filter((m) => m.channel === 'email').length,
      skippedCustomers: skipped.length,
      skipReasons,
      estimatedSmsCost: Math.round(smsSegmentsTotal * ctx.config.smsCostPerSegment * 100) / 100,
    },
  };
}
