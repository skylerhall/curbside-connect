import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repo from '../server/db/repo.ts';
import { runAutomation } from '../server/engine/automations.ts';
import { buildPlan } from '../server/engine/plan.ts';
import { holidaySlidePlan, pickupsOn } from '../server/engine/schedule.ts';
import { observedHolidays } from '../server/lib/dates.ts';
import { FIXED_NOW, seedDemoHauler, testContext } from './helpers.ts';

test('observed holidays for 2026 land on the right dates', () => {
  const byName = Object.fromEntries(observedHolidays(2026).map((h) => [h.name, h.date]));
  assert.equal(byName['Thanksgiving Day'], '2026-11-26');
  assert.equal(byName['Memorial Day'], '2026-05-25');
  assert.equal(byName['Labor Day'], '2026-09-07');
  assert.equal(byName['Christmas Day'], '2026-12-25');
});

test('Thanksgiving slides Thursday to Friday and Friday to Saturday, nothing earlier', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const routes = repo.listRoutes(ctx.db, tenant.id);
  const plan = holidaySlidePlan(routes, '2026-11-26');
  assert.deepEqual(
    plan.map((p) => [p.originalDate, p.newDate]),
    [
      ['2026-11-26', '2026-11-27'],
      ['2026-11-27', '2026-11-28'],
    ],
  );
  // Weekend holidays change nothing (Independence Day 2026 is a Saturday).
  assert.equal(holidaySlidePlan(routes, '2026-07-04').length, 0);
});

test('pickup reminders follow the holiday slide', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const routes = repo.listRoutes(ctx.db, tenant.id);
  for (const p of holidaySlidePlan(routes, '2026-11-26')) {
    repo.insertOverride(ctx.db, {
      id: repo.newId('ov'),
      tenantId: tenant.id,
      routeId: p.routeId,
      originalDate: p.originalDate,
      newDate: p.newDate,
      kind: 'holiday',
      reason: 'Thanksgiving Day holiday schedule',
      holidayName: 'Thanksgiving Day',
      createdAt: ctx.now().toISOString(),
      notifiedCampaignId: null,
    });
  }
  const thu = routes.find((r) => r.serviceDay === 4)!;
  const fri = routes.find((r) => r.serviceDay === 5)!;
  assert.equal(pickupsOn(ctx.db, tenant.id, '2026-11-26').length, 0, 'no pickups on Thanksgiving');
  assert.deepEqual(pickupsOn(ctx.db, tenant.id, '2026-11-27').map((p) => p.route.id), [thu.id]);
  assert.deepEqual(pickupsOn(ctx.db, tenant.id, '2026-11-28').map((p) => p.route.id), [fri.id]);

  const plan = buildPlan(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-11-27' });
  const ready = plan.messages.filter((m) => m.status === 'ready');
  assert.ok(ready.length > 0);
  assert.ok(ready.every((m) => m.routeName === thu.name));
  assert.match(ready.find((m) => m.channel === 'sms')!.body!, /tomorrow, Fri, Nov 27\. Note: this week's pickup moved from Thu, Nov 26 \(Thanksgiving Day\)/);

  // The holiday notice itself.
  const notice = buildPlan(ctx, tenant, { kind: 'schedule_change', overrideIds: repo.listOverrides(ctx.db, tenant.id).map((o) => o.id) });
  assert.equal(notice.title, 'Thanksgiving Day schedule change');
  const sms = notice.messages.find((m) => m.channel === 'sms' && m.routeName === thu.name)!;
  assert.equal(
    sms.body,
    'Kestrel Ridge Disposal: Thanksgiving Day schedule. Your Thursday pickup moves to Fri, Nov 27 this week. Carts out by 6:00 AM. Reply STOP to opt out.',
  );
  assert.equal(sms.segments, 1, 'default holiday SMS fits in one segment');
});

test('pickup reminder automation sends tomorrow’s reminders once, and respects opt-outs', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const thursday = repo.listRoutes(ctx.db, tenant.id).find((r) => r.serviceDay === 4)!;
  const optedOut = repo.listCustomers(ctx.db, tenant.id, { routeId: thursday.id }).find((c) => c.smsOptIn && c.notifyPickup)!;
  repo.updatePreferences(ctx.db, optedOut, { notifyPickup: false }, 'test', FIXED_NOW.toISOString());

  const first = await runAutomation(ctx, tenant, 'pickup_reminder');
  assert.equal(first.campaigns.length, 1);
  const { items } = repo.listMessages(ctx.db, tenant.id, { campaignId: first.campaigns[0].id, limit: 500 });
  assert.ok(items.every((m) => m.routeName === thursday.name), 'Wednesday run reminds the Thursday route');
  const skipped = items.find((m) => m.customerId === optedOut.id)!;
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.error, 'Opted out of pickup reminders');

  const second = await runAutomation(ctx, tenant, 'pickup_reminder');
  assert.equal(second.campaigns.length, 0, 'idempotent: nobody is reminded twice');
});

test('recycling alternates weekly and shows up in the reminder', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const a = buildPlan(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-10-08' }).messages.find((m) => m.channel === 'sms')!;
  const b = buildPlan(ctx, tenant, { kind: 'pickup_reminder', serviceDate: '2026-10-15' }).messages.find((m) => m.channel === 'sms')!;
  const types = [a.body, b.body].map((body) => (/trash and recycling/.test(body!) ? 'recycling' : 'trash'));
  assert.deepEqual(types.sort(), ['recycling', 'trash']);
});

test('route change schedules the move and notifies with the new day', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const routes = repo.listRoutes(ctx.db, tenant.id);
  const tue = routes.find((r) => r.serviceDay === 2)!;
  const wed = routes.find((r) => r.serviceDay === 3)!;
  const movers = repo.listCustomers(ctx.db, tenant.id, { routeId: tue.id }).slice(0, 5);
  const { executeNotification } = await import('../server/engine/dispatch.ts');
  const { plan } = await executeNotification(ctx, tenant, { kind: 'route_change', customerIds: movers.map((c) => c.id), toRouteId: wed.id, effectiveDate: '2026-10-19' }, { trigger: 'manual', actor: 'test' });
  const sms = plan.messages.find((m) => m.channel === 'sms')!;
  assert.match(sms.body!, /Starting Mon, Oct 19, your pickup day changes from Tuesday to Wednesday\./);
  const moved = repo.getCustomer(ctx.db, tenant.id, movers[0].id)!;
  assert.equal(moved.nextRouteId, wed.id);
  assert.equal(repo.routeOn(moved, '2026-10-13'), tue.id, 'still Tuesday before the effective date');
  assert.equal(repo.routeOn(moved, '2026-10-21'), wed.id, 'Wednesday after');
  assert.equal(repo.applyDueRouteMoves(ctx.db, tenant.id, '2026-10-19'), movers.length);
});
