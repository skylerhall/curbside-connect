import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repo from '../server/db/repo.ts';
import { seedTenant } from '../server/db/seed.ts';
import { handleInboundSms } from '../server/engine/consent.ts';
import { executeNotification } from '../server/engine/dispatch.ts';
import { buildPlan } from '../server/engine/plan.ts';
import { OTHER_HAULER, seedDemoHauler, testContext } from './helpers.ts';

test('billing reminders target the right accounts with the right amounts', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const customers = repo.listCustomers(ctx.db, tenant.id);

  const upcoming = buildPlan(ctx, tenant, { kind: 'billing_reminder', mode: 'upcoming' });
  const upcomingIds = new Set(upcoming.messages.map((m) => m.customerId));
  assert.ok(customers.filter((c) => c.autopay).every((c) => !upcomingIds.has(c.id)), 'autopay customers are not asked to pay');
  const sample = upcoming.messages.find((m) => m.channel === 'sms')!;
  const c = customers.find((x) => x.id === sample.customerId)!;
  const amount = `$${((c.monthlyRateCents + c.pastDueCents) / 100).toFixed(2)}`;
  assert.ok(sample.body!.includes(`Your bill of ${amount} is due Sun, Nov 1`), sample.body!);

  const autopay = buildPlan(ctx, tenant, { kind: 'billing_reminder', mode: 'autopay' });
  assert.ok(autopay.messages.every((m) => customers.find((x) => x.id === m.customerId)!.autopay));

  const pastDue = buildPlan(ctx, tenant, { kind: 'billing_reminder', mode: 'past_due' });
  assert.ok(pastDue.messages.length > 0);
  assert.ok(pastDue.messages.every((m) => customers.find((x) => x.id === m.customerId)!.pastDueCents > 0));

  const optedOut = customers.find((x) => !x.notifyBilling && x.pastDueCents > 0);
  if (optedOut) assert.equal(pastDue.messages.find((m) => m.customerId === optedOut.id)?.skipReason, 'Opted out of billing reminders');
});

test('STOP reply opts a customer out of SMS, is logged, and is honoured by the next send', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const customer = repo.listCustomers(ctx.db, tenant.id).find((c) => c.smsOptIn && c.phone && c.emailOptIn && c.email)!;

  const result = handleInboundSms(ctx, tenant, `+1${customer.phone!.replace(/\D/g, '')}`, ' stop ');
  assert.equal(result.action, 'opt_out');
  assert.match(result.reply!, /unsubscribed/);
  assert.equal(repo.getCustomer(ctx.db, tenant.id, customer.id)!.smsOptIn, false);
  const events = repo.listConsentEvents(ctx.db, tenant.id, 5, customer.id);
  assert.equal(events[0].change, 'SMS off');
  assert.equal(events[0].source, 'sms_reply');

  const plan = buildPlan(ctx, tenant, { kind: 'alert', severity: 'emergency', routeIds: [customer.routeId], channels: ['sms', 'email'], message: 'Test' });
  const mine = plan.messages.filter((m) => m.customerId === customer.id);
  assert.deepEqual(mine.map((m) => m.channel), ['email'], 'even emergency alerts never text an opted-out number');

  assert.equal(handleInboundSms(ctx, tenant, customer.phone!, 'START').action, 'opt_in');
  assert.equal(repo.getCustomer(ctx.db, tenant.id, customer.id)!.smsOptIn, true);
  assert.equal(handleInboundSms(ctx, tenant, customer.phone!, 'thanks!').action, 'none');
});

test('emergency alerts bypass category preferences but advisories do not', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const c = repo.listCustomers(ctx.db, tenant.id).find((x) => x.smsOptIn && x.phone)!;
  repo.updatePreferences(ctx.db, c, { notifyService: false }, 'test', ctx.now().toISOString());
  const req = (severity: 'advisory' | 'emergency') => ({ kind: 'alert' as const, severity, routeIds: [c.routeId], channels: ['sms' as const], message: 'Wildfire smoke' });
  assert.equal(buildPlan(ctx, tenant, req('advisory')).messages.find((m) => m.customerId === c.id)!.status, 'skipped');
  assert.equal(buildPlan(ctx, tenant, req('emergency')).messages.find((m) => m.customerId === c.id)!.status, 'ready');
});

test('tenants are isolated: one hauler never messages another hauler’s customers', async () => {
  const ctx = testContext();
  const mh = await seedDemoHauler(ctx);
  const cc = await seedTenant(ctx, OTHER_HAULER, { history: false, seed: 7 });
  const ccIds = new Set(repo.listCustomers(ctx.db, cc.id).map((c) => c.id));
  assert.ok(ccIds.size > 0);

  const { campaign } = await executeNotification(ctx, mh, { kind: 'alert', severity: 'advisory', routeIds: 'all', channels: ['sms', 'email'], message: 'Hello' }, { trigger: 'manual', actor: 'test' });
  const { items } = repo.listMessages(ctx.db, mh.id, { campaignId: campaign.id, limit: 1000 });
  assert.ok(items.length > 0);
  assert.ok(items.every((m) => !ccIds.has(m.customerId)));
  assert.equal(repo.listMessages(ctx.db, cc.id).total, 0);
  assert.equal(repo.getCampaign(ctx.db, cc.id, campaign.id), null, 'cannot read another tenant’s campaign');

  // Canyon Creek's own messages carry its own branding.
  const plan = buildPlan(ctx, cc, { kind: 'pickup_reminder', serviceDate: '2026-10-12' });
  assert.ok(plan.messages.filter((m) => m.status === 'ready').every((m) => m.body!.startsWith('Canyon Creek Waste') || m.channel === 'email'));
});
