// Mistake handling: the undo-send window, corrections, and pre-send warnings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repo from '../server/db/repo.ts';
import { cancelCampaign, executeNotification, releaseCampaign } from '../server/engine/dispatch.ts';
import { buildPlan } from '../server/engine/plan.ts';
import { seedDemoHauler, testContext } from './helpers.ts';
import type { AppContext } from '../server/engine/context.ts';
import type { Tenant } from '../shared/types.ts';

function weatherDelay(ctx: AppContext, tenant: Tenant, id: string, newDate = '2026-10-09') {
  const thursday = repo.listRoutes(ctx.db, tenant.id).find((r) => r.serviceDay === 4)!;
  repo.insertOverride(ctx.db, {
    id,
    tenantId: tenant.id,
    routeId: thursday.id,
    originalDate: '2026-10-08',
    newDate,
    kind: 'weather',
    reason: 'Snow and icy roads',
    holidayName: null,
    createdAt: ctx.now().toISOString(),
    notifiedCampaignId: null,
  });
  return thursday;
}

test('a manual send waits in the undo window; cancelling means nothing is sent', async () => {
  const ctx = testContext({ env: { SEND_HOLD_SECONDS: '60' } });
  const tenant = await seedDemoHauler(ctx);
  weatherDelay(ctx, tenant, 'ov_hold');

  const { campaign } = await executeNotification(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_hold'] }, { trigger: 'manual', actor: 'test' });
  assert.equal(campaign.status, 'held');
  assert.ok(campaign.sendAt && new Date(campaign.sendAt).getTime() - ctx.now().getTime() === 60_000);
  const before = repo.listMessages(ctx.db, tenant.id, { campaignId: campaign.id, limit: 500 }).items.filter((m) => m.status !== 'skipped');
  assert.ok(before.length > 0);
  assert.ok(before.every((m) => m.status === 'queued' && !m.providerMessageId), 'nothing handed to a provider yet');

  assert.equal(cancelCampaign(ctx, tenant.id, campaign.id, 'test'), true);
  const after = repo.getCampaign(ctx.db, tenant.id, campaign.id)!;
  assert.equal(after.status, 'cancelled');
  assert.equal(after.counts.cancelled, before.length);
  assert.equal(after.counts.messages, 0);
  assert.equal(repo.getOverride(ctx.db, tenant.id, 'ov_hold')!.notifiedCampaignId, null, 'schedule change shows as not notified again');
  assert.equal(await releaseCampaign(ctx, tenant.id, campaign.id, 'test'), false, 'a cancelled send can never go out');
  assert.equal(cancelCampaign(ctx, tenant.id, campaign.id, 'test'), false);

  // Cancelled messages don't count as "already notified", so the fixed version can be sent.
  const again = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_hold'] });
  assert.equal(again.messages.filter((m) => m.status === 'ready').length, before.length);
});

test('"Send now" ends the undo window and delivers', async () => {
  const ctx = testContext({ env: { SEND_HOLD_SECONDS: '60' } });
  const tenant = await seedDemoHauler(ctx);
  weatherDelay(ctx, tenant, 'ov_now');
  const { campaign } = await executeNotification(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_now'] }, { trigger: 'manual', actor: 'test' });
  assert.equal(await releaseCampaign(ctx, tenant.id, campaign.id, 'test'), true);
  const sent = repo.getCampaign(ctx.db, tenant.id, campaign.id)!;
  assert.equal(sent.status, 'sent');
  assert.equal(sent.counts.queued, 0);
  assert.equal(sent.counts.delivered + sent.counts.failed, sent.counts.messages);
  assert.equal(cancelCampaign(ctx, tenant.id, campaign.id, 'test'), false, 'too late to cancel once sent');
});

test('scheduled automations are not held', async () => {
  const ctx = testContext({ env: { SEND_HOLD_SECONDS: '60' } });
  const tenant = await seedDemoHauler(ctx);
  const { campaign } = await executeNotification(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-10-08' }, { trigger: 'automation', actor: 'automation' });
  assert.equal(campaign.status, 'sent');
});

test('a correction goes only to people who actually received the original, and can undo the change', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  weatherDelay(ctx, tenant, 'ov_oops', '2026-10-11'); // wrong date: a Sunday
  const { campaign: original } = await executeNotification(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_oops'] }, { trigger: 'manual', actor: 'test' });
  const originalMsgs = repo.listMessages(ctx.db, tenant.id, { campaignId: original.id, limit: 500 }).items;
  const received = originalMsgs.filter((m) => m.status === 'delivered');
  const failed = originalMsgs.filter((m) => m.status === 'failed');
  assert.ok(failed.length > 0, 'seed data includes a failed delivery');

  const req = { kind: 'correction' as const, campaignId: original.id, message: 'Please disregard our last text. Your Thu, Oct 8 pickup is still on schedule. Sorry!', undoChange: true };
  const plan = buildPlan(ctx, tenant, req);
  const ready = plan.messages.filter((m) => m.status === 'ready');
  assert.equal(ready.length, received.length, 'one correction per delivered message');
  for (const m of ready) assert.ok(received.some((r) => r.customerId === m.customerId && r.channel === m.channel), 'same person, same channel');
  for (const f of failed) assert.ok(!ready.some((m) => m.customerId === f.customerId && m.channel === f.channel), 'no correction for a message that never arrived');
  const sms = ready.find((m) => m.channel === 'sms')!;
  assert.equal(sms.body, 'Kestrel Ridge Disposal correction: Please disregard our last text. Your Thu, Oct 8 pickup is still on schedule. Sorry! Reply STOP to opt out.');
  assert.equal(sms.segments, 1);

  const { campaign: correction } = await executeNotification(ctx, tenant, req, { trigger: 'manual', actor: 'test' });
  assert.equal(correction.correctsCampaignId, original.id);
  assert.equal(repo.getOverride(ctx.db, tenant.id, 'ov_oops'), null, 'the wrong schedule change is removed');
  assert.ok(buildPlan(ctx, tenant, req).messages.every((m) => m.status === 'skipped'), 'nobody gets the same correction twice');
});

test('corrections are refused for sends that never went out', async () => {
  const ctx = testContext({ env: { SEND_HOLD_SECONDS: '60' } });
  const tenant = await seedDemoHauler(ctx);
  weatherDelay(ctx, tenant, 'ov_held');
  const { campaign } = await executeNotification(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_held'] }, { trigger: 'manual', actor: 'test' });
  assert.throws(() => buildPlan(ctx, tenant, { kind: 'correction', campaignId: campaign.id, message: 'x' }), /Cancel it instead/);
  cancelCampaign(ctx, tenant.id, campaign.id, 'test');
  assert.throws(() => buildPlan(ctx, tenant, { kind: 'correction', campaignId: campaign.id, message: 'x' }), /nobody received it/);
});

test('sanity checks flag likely mistakes before sending', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  weatherDelay(ctx, tenant, 'ov_sunday', '2026-10-11');
  const sunday = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_sunday'] });
  assert.ok(sunday.warnings.some((w) => /Sunday/.test(w)));

  repo.deleteOverride(ctx.db, tenant.id, 'ov_sunday');
  weatherDelay(ctx, tenant, 'ov_earlier', '2026-10-06');
  const earlier = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_earlier'] });
  assert.ok(earlier.warnings.some((w) => /EARLIER/.test(w)));
  assert.ok(earlier.warnings.some((w) => /in the past/.test(w)));

  repo.deleteOverride(ctx.db, tenant.id, 'ov_earlier');
  weatherDelay(ctx, tenant, 'ov_fine', '2026-10-09');
  assert.deepEqual(buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_fine'] }).warnings, [], 'a normal one-day delay has no warnings');

  const notTomorrow = buildPlan(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-10-09' });
  assert.ok(notTomorrow.warnings.some((w) => /tomorrow/.test(w)));
  assert.deepEqual(buildPlan(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-10-08' }).warnings, []);
});
