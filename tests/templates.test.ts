import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderTemplate, smsSegments } from '../shared/catalog.ts';
import * as repo from '../server/db/repo.ts';
import { DEFAULT_TEMPLATES } from '../server/engine/default-templates.ts';
import { sampleVars } from '../server/engine/samples.ts';
import { seedDemoHauler, testContext } from './helpers.ts';

test('every default text message fits in a single GSM-7 segment', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  // Use the longest realistic values: biggest bill, longest holiday name, a past-due account.
  const customer = repo.listCustomers(ctx.db, tenant.id).sort((a, b) => b.monthlyRateCents + b.pastDueCents - (a.monthlyRateCents + a.pastDueCents))[0];
  const route = repo.getRoute(ctx.db, tenant.id, customer.routeId);
  for (const t of DEFAULT_TEMPLATES.filter((x) => x.channel === 'sms')) {
    const vars = { ...sampleVars(ctx, tenant, t.kind, customer, route), holiday_name: "New Year's Day", pickup_type: 'trash and recycling' };
    const { text, missing } = renderTemplate(t.body, vars);
    assert.deepEqual(missing, [], `${t.kind}: all variables resolve`);
    const seg = smsSegments(text);
    assert.equal(seg.encoding, 'GSM-7', `${t.kind}: no Unicode characters`);
    assert.equal(seg.segments, 1, `${t.kind} is ${seg.length} chars: "${text}"`);
    assert.match(text, /Reply STOP to opt out\.$/, `${t.kind}: ends with opt-out language`);
    assert.ok(text.startsWith(tenant.name), `${t.kind}: identifies the sender`);
  }
});

test('every default email template renders without unknown variables', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  for (const t of DEFAULT_TEMPLATES.filter((x) => x.channel === 'email')) {
    const vars = sampleVars(ctx, tenant, t.kind, null, null);
    assert.deepEqual(renderTemplate(t.body, vars).missing, [], t.kind);
    assert.deepEqual(renderTemplate(t.subject ?? '', vars).missing, [], `${t.kind} subject`);
  }
});
