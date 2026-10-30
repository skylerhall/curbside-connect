// Representative variable values for template previews in the editor.
import type { Customer, Route, TemplateKind, Tenant } from '../../shared/types.ts';
import { WEEKDAYS, addDays, longDate, nextDueDate, nextWeekday, shortDate, todayIn } from '../lib/dates.ts';
import { type AppContext, money, preferencesUrl, tenantVars } from './context.ts';

export function sampleVars(ctx: AppContext, tenant: Tenant, kind: TemplateKind, customer: Customer | null, route: Route | null): Record<string, string> {
  const today = todayIn(tenant.timezone, ctx.now());
  const serviceDay = route?.serviceDay ?? 4;
  const next = nextWeekday(addDays(today, 1), serviceDay);
  const due = nextDueDate(today, tenant.billingDueDay);
  const c = customer;
  const base: Record<string, string> = {
    ...tenantVars(tenant),
    first_name: c?.firstName ?? 'Avery',
    last_name: c?.lastName ?? 'Collins',
    service_address: c?.serviceAddress ?? '1427 Juniper Ln',
    account_number: c?.accountNumber ?? 'KRD-10412',
    route_name: route?.name ?? 'Bridger & Pine Hollow',
    preferences_url: preferencesUrl(ctx, c?.preferenceToken ?? 'sample'),
  };
  const amount = c ? c.monthlyRateCents + c.pastDueCents : 3450;
  switch (kind) {
    case 'pickup_reminder':
      return { ...base, service_date_short: shortDate(next), service_date_long: longDate(next), pickup_type: 'trash and recycling', schedule_note: '' };
    case 'holiday_change':
      return {
        ...base,
        holiday_name: 'Thanksgiving Day',
        original_day: WEEKDAYS[serviceDay],
        original_date_short: shortDate(next),
        original_date_long: longDate(next),
        new_date_short: shortDate(addDays(next, 1)),
        new_date_long: longDate(addDays(next, 1)),
      };
    case 'service_change':
      return {
        ...base,
        reason: 'Snow and icy roads',
        original_date_short: shortDate(next),
        new_date_short: shortDate(addDays(next, 1)),
        change_summary: `Your ${shortDate(next)} pickup moves to ${shortDate(addDays(next, 1))}.`,
        change_headline: `pickup moved to ${shortDate(addDays(next, 1))}`,
      };
    case 'route_change':
      return {
        ...base,
        old_service_day: WEEKDAYS[serviceDay],
        new_service_day: WEEKDAYS[serviceDay === 5 ? 1 : serviceDay + 1],
        effective_date_short: shortDate(addDays(today, 14)),
        effective_date_long: longDate(addDays(today, 14)),
        first_new_pickup_long: longDate(nextWeekday(addDays(today, 14), serviceDay === 5 ? 1 : serviceDay + 1)),
      };
    case 'billing_upcoming':
    case 'billing_autopay':
    case 'billing_past_due':
      return { ...base, amount_due: money(amount), past_due: money(c?.pastDueCents || 3450), due_date_short: shortDate(due), due_date_long: longDate(due) };
    case 'alert':
      return { ...base, alert_label: 'Weather delay', alert_message: "Snow is slowing routes. If your cart isn't emptied by 5 PM, leave it out. We'll return tomorrow." };
    case 'correction':
      return { ...base, correction_message: `Please disregard our last text. Your ${shortDate(next)} pickup is still on schedule. Sorry!`, original_title: 'Service change' };
  }
}
