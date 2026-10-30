// The flow the pitch depends on:
// schedule change → affected customers → targeted messages → send → delivery status recorded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repo from '../server/db/repo.ts';
import { executeNotification } from '../server/engine/dispatch.ts';
import { buildPlan } from '../server/engine/plan.ts';
import { nextPickupForRoute } from '../server/engine/schedule.ts';
import { seedDemoHauler, testContext } from './helpers.ts';

test('a weather delay on one route notifies exactly that route, respecting consent, and records delivery', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const routes = repo.listRoutes(ctx.db, tenant.id);
  const thursday = routes.find((r) => r.serviceDay === 4)!;
  const pickup = nextPickupForRoute(ctx.db, thursday, '2026-10-07');
  assert.equal(pickup.originalDate, '2026-10-08');

  // 1. The schedule change.
  repo.insertOverride(ctx.db, {
    id: 'ov_test',
    tenantId: tenant.id,
    routeId: thursday.id,
    originalDate: '2026-10-08',
    newDate: '2026-10-09',
    kind: 'weather',
    reason: 'Snow and icy roads',
    holidayName: null,
    createdAt: ctx.now().toISOString(),
    notifiedCampaignId: null,
  });

  // 2. Identify affected customers.
  const onRoute = repo.listCustomers(ctx.db, tenant.id, { routeId: thursday.id });
  const plan = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_test'] });
  assert.equal(plan.summary.matchedCustomers, onRoute.length, 'every customer on the route is considered');
  for (const m of plan.messages) assert.ok(onRoute.some((c) => c.id === m.customerId), 'no one from other routes is included');

  // 3. Messages are targeted per channel consent.
  for (const m of plan.messages.filter((x) => x.status === 'ready')) {
    const c = onRoute.find((x) => x.id === m.customerId)!;
    if (m.channel === 'sms') assert.ok(c.smsOptIn && c.phone);
    if (m.channel === 'email') assert.ok(c.emailOptIn && c.email);
    assert.match(m.body!, /Your Thu, Oct 8 pickup moves to Fri, Oct 9\./);
    assert.match(m.body!, /Snow and icy roads/);
  }
  const unreachable = onRoute.filter((c) => !(c.smsOptIn && c.phone) && !(c.emailOptIn && c.email));
  assert.equal(plan.messages.filter((m) => m.status === 'skipped').length, unreachable.length);
  assert.ok(plan.summary.smsMessages > 0 && plan.summary.emailMessages > 0);

  // 4. Send (simulated) and 5. record delivery status.
  const { campaign } = await executeNotification(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_test'] }, { trigger: 'manual', actor: 'test' });
  const { items } = repo.listMessages(ctx.db, tenant.id, { campaignId: campaign.id, limit: 500 });
  const sent = items.filter((m) => m.status !== 'skipped');
  assert.equal(sent.length, plan.summary.smsMessages + plan.summary.emailMessages);
  for (const m of sent) {
    assert.ok(m.status === 'delivered' || m.status === 'failed', `final status recorded (got ${m.status})`);
    assert.equal(m.provider, 'simulated');
    assert.ok(m.providerMessageId);
    const detail = repo.getMessage(ctx.db, tenant.id, m.id)!;
    assert.deepEqual(detail.events.map((e) => e.status), ['queued', 'sent', m.status], 'status timeline is kept');
  }
  // The seeded unreachable handset on this route fails like a real carrier error.
  assert.ok(sent.some((m) => m.status === 'failed' && /30003/.test(m.error ?? '')));
  assert.equal(campaign.counts.delivered + campaign.counts.failed, sent.length);

  // The override is marked as notified and the action is audited.
  assert.equal(repo.getOverride(ctx.db, tenant.id, 'ov_test')!.notifiedCampaignId, campaign.id);
  assert.ok(repo.listAudit(ctx.db, tenant.id).some((a) => a.action === 'campaign.sent'));

  // Sending again doesn't double-notify anyone…
  const again = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_test'] });
  assert.equal(again.messages.filter((m) => m.status === 'ready').length, 0);
  assert.ok(again.summary.skipReasons['Already notified'] > 0);
  // …and an explicit retry only re-attempts what failed.
  const failed = sent.filter((m) => m.status === 'failed');
  const retries = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_test'] }, { retryFailed: true }).messages.filter((m) => m.status === 'ready');
  assert.equal(retries.length, failed.length);
  for (const m of retries) assert.ok(failed.some((f) => f.customerId === m.customerId && f.channel === m.channel));
});

test('a cancelled pickup tells customers when the next pickup is', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const monday = repo.listRoutes(ctx.db, tenant.id).find((r) => r.serviceDay === 1)!;
  repo.insertOverride(ctx.db, {
    id: 'ov_cancel',
    tenantId: tenant.id,
    routeId: monday.id,
    originalDate: '2026-10-12',
    newDate: null,
    kind: 'operational',
    reason: 'Truck breakdown',
    holidayName: null,
    createdAt: ctx.now().toISOString(),
    notifiedCampaignId: null,
  });
  const plan = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: ['ov_cancel'] });
  const sms = plan.messages.find((m) => m.channel === 'sms')!;
  assert.match(sms.body!, /Mon, Oct 12 pickup is cancelled\. Your next pickup is Mon, Oct 19\./);
});
