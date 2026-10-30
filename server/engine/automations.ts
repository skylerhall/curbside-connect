// Scheduled jobs: next-day pickup reminders and billing reminders. Each job is
// idempotent (dedupe keys), so a restart or a manual "run now" never
// double-texts anyone.
import type { Automation, Campaign, NotificationRequest, Tenant } from '../../shared/types.ts';
import { applyDueRouteMoves, audit, getAutomation, listAutomations, listTenants, markAutomationRun } from '../db/repo.ts';
import { addDays, daysBetween, lastDueDate, nextDueDate, timeIn, todayIn } from '../lib/dates.ts';
import { type AppContext, nowIso } from './context.ts';
import { executeNotification } from './dispatch.ts';
import { buildPlan } from './plan.ts';

export interface AutomationRun {
  kind: Automation['kind'];
  campaigns: Campaign[];
  note: string;
}

function requestsFor(tenant: Tenant, automation: Automation, today: string): NotificationRequest[] {
  if (automation.kind === 'pickup_reminder') return [{ kind: 'pickup_reminder', serviceDate: addDays(today, 1) }];

  const daysBefore = automation.config.daysBefore ?? 3;
  const grace = automation.config.pastDueGraceDays ?? 5;
  const due = nextDueDate(today, tenant.billingDueDay);
  const lastDue = lastDueDate(today, tenant.billingDueDay);
  const out: NotificationRequest[] = [];
  if (daysBetween(today, due) <= daysBefore) {
    out.push({ kind: 'billing_reminder', mode: 'upcoming' }, { kind: 'billing_reminder', mode: 'autopay' });
  }
  if (daysBetween(lastDue, today) >= grace) out.push({ kind: 'billing_reminder', mode: 'past_due' });
  return out;
}

export async function runAutomation(ctx: AppContext, tenant: Tenant, kind: Automation['kind'], actor = 'automation'): Promise<AutomationRun> {
  const automation = getAutomation(ctx.db, tenant.id, kind);
  if (!automation) throw new Error(`Automation ${kind} is not configured for ${tenant.slug}`);
  const today = todayIn(tenant.timezone, ctx.now());
  const campaigns: Campaign[] = [];
  for (const req of requestsFor(tenant, automation, today)) {
    const plan = buildPlan(ctx, tenant, req);
    if (!plan.messages.some((m) => m.status === 'ready')) continue;
    const { campaign } = await executeNotification(ctx, tenant, req, { trigger: 'automation', actor });
    campaigns.push(campaign);
  }
  markAutomationRun(ctx.db, tenant.id, kind, today, nowIso(ctx), campaigns.at(-1)?.id ?? null);
  const note = campaigns.length
    ? `Sent ${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}.`
    : kind === 'pickup_reminder'
      ? 'Nothing new to send (no pickups tomorrow, or everyone was already reminded).'
      : 'Nothing due today (outside the reminder window, or everyone was already reminded).';
  if (actor !== 'automation' || campaigns.length) audit(ctx.db, tenant.id, actor, 'automation.run', `${kind === 'pickup_reminder' ? 'Pickup reminder' : 'Billing reminder'} automation: ${note}`, nowIso(ctx));
  return { kind, campaigns, note };
}

/** Checks every minute whether an automation is due in its tenant's local time. */
export function startScheduler(ctx: AppContext): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const tenant of listTenants(ctx.db)) {
        const today = todayIn(tenant.timezone, ctx.now());
        applyDueRouteMoves(ctx.db, tenant.id, today);
        const localTime = timeIn(tenant.timezone, ctx.now());
        for (const a of listAutomations(ctx.db, tenant.id)) {
          if (!a.enabled || a.lastRunDate === today || localTime < a.runTime) continue;
          try {
            const run = await runAutomation(ctx, tenant, a.kind);
            if (run.campaigns.length) console.log(`[scheduler] ${tenant.slug} ${a.kind}: ${run.note}`);
          } catch (err) {
            console.error(`[scheduler] ${tenant.slug} ${a.kind} failed`, err);
          }
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  return () => clearInterval(timer);
}
