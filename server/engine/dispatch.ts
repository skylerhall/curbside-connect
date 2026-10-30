// Executes a plan: records the campaign and every message (including the
// customers who were skipped and why), hands messages to providers, and
// tracks delivery status as it comes back.
//
// Manual sends wait out an undo window (SEND_HOLD_SECONDS) first: during it
// the office can cancel and nothing reaches anyone.
import type { Campaign, Channel, NotificationRequest, Plan, Tenant } from '../../shared/types.ts';
import { transaction } from '../db/database.ts';
import {
  applyStatus,
  audit,
  campaignCustomerIds,
  cancelQueuedMessages,
  claimHeldCampaign,
  clearOverridesNotified,
  clearPendingRoutes,
  deleteOverride,
  findMessageByProviderId,
  getCampaign,
  getTenantById,
  insertCampaign,
  insertMessage,
  listHeldCampaigns,
  markOverridesNotified,
  newId,
  overridesNotifiedBy,
  queuedMessages,
  recordSendResult,
  setPendingRoute,
} from '../db/repo.ts';
import type { OutboundMessage, StatusSink } from '../providers/types.ts';
import { type AppContext, nowIso } from './context.ts';
import { buildPlan } from './plan.ts';

export interface ExecuteOptions {
  trigger: 'manual' | 'automation';
  actor: string;
  retryFailed?: boolean;
  /** Override the undo window (defaults: config for manual sends, none for automations). */
  holdSeconds?: number;
}

export interface ExecuteResult {
  campaign: Campaign;
  plan: Plan;
}

type Queued = { id: string; channel: Channel; to: string; subject: string | null; body: string };

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function executeNotification(ctx: AppContext, tenant: Tenant, req: NotificationRequest, opts: ExecuteOptions): Promise<ExecuteResult> {
  const plan = buildPlan(ctx, tenant, req, { retryFailed: opts.retryFailed });
  const campaignId = newId('cmp');
  const createdAt = nowIso(ctx);
  const holdSeconds = opts.holdSeconds ?? (opts.trigger === 'manual' ? ctx.config.sendHoldSeconds : 0);
  const hasMessages = plan.messages.some((m) => m.status === 'ready');
  const held = holdSeconds > 0 && hasMessages;
  const sendAt = held ? new Date(ctx.now().getTime() + holdSeconds * 1000).toISOString() : null;
  const queued: Queued[] = [];

  transaction(ctx.db, () => {
    insertCampaign(ctx.db, {
      id: campaignId,
      tenantId: tenant.id,
      kind: req.kind,
      title: opts.retryFailed ? `Retry: ${plan.title}` : plan.title,
      trigger: opts.trigger,
      params: req,
      createdAt,
      createdBy: opts.actor,
      status: held ? 'held' : 'sent',
      sendAt,
      correctsCampaignId: req.kind === 'correction' ? req.campaignId : null,
    });
    for (const m of plan.messages) {
      const id = newId('msg');
      insertMessage(ctx.db, {
        id,
        tenantId: tenant.id,
        campaignId,
        customerId: m.customerId,
        channel: m.channel,
        toAddress: m.to,
        subject: m.subject,
        body: m.body,
        segments: m.segments,
        status: m.status === 'ready' ? 'queued' : 'skipped',
        error: m.skipReason,
        templateKind: m.templateKind,
        dedupeKey: m.dedupeKey,
        createdAt,
      });
      if (m.status === 'ready' && m.channel && m.to && m.body) queued.push({ id, channel: m.channel, to: m.to, subject: m.subject, body: m.body });
    }

    // Side effects that belong to the operational change itself (reversed if the send is cancelled).
    if (req.kind === 'schedule_change') markOverridesNotified(ctx.db, tenant.id, req.overrideIds, campaignId);
    if (req.kind === 'route_change') {
      for (const id of new Set(plan.messages.map((m) => m.customerId))) setPendingRoute(ctx.db, tenant.id, id, req.toRouteId, req.effectiveDate);
    }
    if (!held && req.kind === 'correction') applyCorrectionUndo(ctx, tenant, req, opts.actor);

    const s = plan.summary;
    audit(
      ctx.db,
      tenant.id,
      opts.actor,
      held ? 'campaign.queued' : 'campaign.sent',
      `${plan.title}: ${s.reachedCustomers} of ${s.matchedCustomers} customers ${held ? `queued (sending in ${holdSeconds}s unless cancelled)` : 'reached'} (${s.smsMessages} SMS, ${s.emailMessages} email)${s.skippedCustomers ? `, ${s.skippedCustomers} skipped` : ''}.`,
      createdAt,
    );
  });

  if (held) scheduleRelease(ctx, tenant.id, campaignId, holdSeconds * 1000);
  else await dispatch(ctx, tenant, queued);
  return { campaign: getCampaign(ctx.db, tenant.id, campaignId)!, plan };
}

function scheduleRelease(ctx: AppContext, tenantId: string, campaignId: string, delayMs: number): void {
  clearTimeout(timers.get(campaignId));
  const timer = setTimeout(() => {
    timers.delete(campaignId);
    releaseCampaign(ctx, tenantId, campaignId, 'automation').catch((err) => console.error('[dispatch] release failed', err));
  }, Math.max(0, delayMs));
  timer.unref?.();
  timers.set(campaignId, timer);
}

/** Ends the undo window early (or on schedule) and sends. Returns false if it was already sent or cancelled. */
export async function releaseCampaign(ctx: AppContext, tenantId: string, campaignId: string, actor: string): Promise<boolean> {
  const tenant = getTenantById(ctx.db, tenantId);
  if (!tenant) return false;
  if (!claimHeldCampaign(ctx.db, tenantId, campaignId, 'sent', nowIso(ctx), null)) return false;
  clearTimeout(timers.get(campaignId));
  timers.delete(campaignId);
  const campaign = getCampaign(ctx.db, tenantId, campaignId)!;
  const req = campaign.params as NotificationRequest;
  if (req.kind === 'correction') transaction(ctx.db, () => applyCorrectionUndo(ctx, tenant, req, actor));
  if (actor !== 'automation') audit(ctx.db, tenantId, actor, 'campaign.released', `${campaign.title}: sent early with "Send now".`, nowIso(ctx));
  await dispatch(ctx, tenant, queuedMessages(ctx.db, campaignId));
  return true;
}

/** Cancels a campaign still in its undo window. Nothing is sent and the change it announced is un-marked. */
export function cancelCampaign(ctx: AppContext, tenantId: string, campaignId: string, actor: string): boolean {
  const now = nowIso(ctx);
  return transaction(ctx.db, () => {
    if (!claimHeldCampaign(ctx.db, tenantId, campaignId, 'cancelled', now, actor)) return false;
    clearTimeout(timers.get(campaignId));
    timers.delete(campaignId);
    const campaign = getCampaign(ctx.db, tenantId, campaignId)!;
    const n = cancelQueuedMessages(ctx.db, campaignId, `Cancelled by ${actor} before sending`, now);
    const req = campaign.params as NotificationRequest;
    if (req.kind === 'schedule_change') clearOverridesNotified(ctx.db, tenantId, campaignId);
    if (req.kind === 'route_change') clearPendingRoutes(ctx.db, tenantId, campaignCustomerIds(ctx.db, campaignId), req.toRouteId);
    audit(ctx.db, tenantId, actor, 'campaign.cancelled', `${campaign.title}: cancelled before sending; ${n} message${n === 1 ? '' : 's'} never left.`, now);
    return true;
  });
}

/** After a restart, pick held campaigns back up (sending any whose window has passed). */
export function resumeHeldCampaigns(ctx: AppContext): number {
  const held = listHeldCampaigns(ctx.db);
  for (const c of held) scheduleRelease(ctx, c.tenantId, c.id, c.sendAt ? new Date(c.sendAt).getTime() - ctx.now().getTime() : 0);
  return held.length;
}

function applyCorrectionUndo(ctx: AppContext, tenant: Tenant, req: Extract<NotificationRequest, { kind: 'correction' }>, actor: string): void {
  if (!req.undoChange) return;
  const original = getCampaign(ctx.db, tenant.id, req.campaignId);
  if (!original) return;
  const now = nowIso(ctx);
  const params = original.params as NotificationRequest;
  if (original.kind === 'schedule_change') {
    const overrides = overridesNotifiedBy(ctx.db, tenant.id, original.id);
    for (const o of overrides) deleteOverride(ctx.db, tenant.id, o.id);
    if (overrides.length) audit(ctx.db, tenant.id, actor, 'schedule.override_removed', `Removed ${overrides.length} schedule change(s) as part of a correction.`, now);
  }
  if (original.kind === 'route_change' && params.kind === 'route_change') {
    const n = clearPendingRoutes(ctx.db, tenant.id, campaignCustomerIds(ctx.db, original.id), params.toRouteId);
    if (n) audit(ctx.db, tenant.id, actor, 'route.move_cancelled', `Cancelled ${n} scheduled pickup-day change(s) as part of a correction.`, now);
  }
}

async function dispatch(ctx: AppContext, tenant: Tenant, queued: Queued[]): Promise<void> {
  const sink: StatusSink = (providerMessageId, status, detail, error) => {
    const found = findMessageByProviderId(ctx.db, providerMessageId);
    if (found) applyStatus(ctx.db, found.id, status, detail, error ?? null, nowIso(ctx));
  };

  // Small concurrency limit keeps live providers happy without being slow.
  const CONCURRENCY = 5;
  let index = 0;
  const worker = async () => {
    while (index < queued.length) {
      const m = queued[index++];
      const provider = ctx.providers.select(m.channel, m.to);
      const outbound: OutboundMessage = {
        messageId: m.id,
        channel: m.channel,
        to: m.to,
        subject: m.subject,
        text: m.body,
        html: m.channel === 'email' ? emailHtml(tenant, m.subject, m.body) : null,
        tenant,
      };
      let result;
      try {
        result = await provider.send(outbound);
      } catch (err) {
        result = { status: 'failed' as const, providerMessageId: null, error: err instanceof Error ? err.message : String(err), detail: 'Provider error' };
      }
      recordSendResult(ctx.db, m.id, { status: result.status, provider: provider.name, providerMessageId: result.providerMessageId, error: result.error, detail: result.detail }, nowIso(ctx));
      if (result.status === 'sent' && result.providerMessageId && provider.track) provider.track(result.providerMessageId, outbound, sink);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A simple branded HTML version of the plain-text email. */
export function emailHtml(tenant: Tenant, subject: string | null, text: string): string {
  const [main, footer] = text.split('\n\n--\n');
  const linkify = (s: string) => escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + tenant.brandPrimary + '">$1</a>');
  const paragraphs = main
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${linkify(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f3f6f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14263a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${tenant.brandDark};padding:18px 24px;color:#ffffff;font-weight:700;font-size:16px">
<span style="display:inline-block;background:${tenant.brandAccent};color:${tenant.brandDark};border-radius:6px;padding:4px 7px;margin-right:10px;font-size:13px">${escapeHtml(tenant.logoInitials)}</span>${escapeHtml(tenant.name)}</td></tr>
<tr><td style="padding:28px 24px 12px;font-size:15px">${subject ? `<h1 style="font-size:19px;margin:0 0 18px">${escapeHtml(subject)}</h1>` : ''}${paragraphs}</td></tr>
${footer ? `<tr><td style="padding:16px 24px 24px;border-top:1px solid #dfe6ee;font-size:12px;color:#5b6b7d;line-height:1.5">${linkify(footer).replace(/\n/g, '<br>')}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
