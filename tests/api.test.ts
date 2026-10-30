// End-to-end through HTTP, the way the dashboard drives it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedDemoHauler, startServer, testContext } from './helpers.ts';

async function json(res: Response): Promise<any> {
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  return body;
}

test('dashboard API: create a schedule change, preview, send, and see it in the delivery log', async () => {
  const ctx = testContext();
  await seedDemoHauler(ctx, true);
  const server = await startServer(ctx);
  const api = (path: string, init?: RequestInit) => fetch(`${server.url}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  try {
    const boot = await json(await api('/bootstrap'));
    assert.equal(boot.tenant.name, 'Kestrel Ridge Disposal');
    const thursday = boot.routes.find((r: { serviceDay: number }) => r.serviceDay === 4);

    const [override] = await json(await api('/overrides', { method: 'POST', body: JSON.stringify({ routeIds: [thursday.id], originalDate: '2026-10-08', newDate: '2026-10-09', kind: 'weather', reason: 'Snow and icy roads' }) }));
    const request = { request: { kind: 'schedule_change', overrideIds: [override.id] } };

    const plan = await json(await api('/notifications/preview', { method: 'POST', body: JSON.stringify(request) }));
    assert.ok(plan.summary.reachedCustomers > 0);

    const sent = await json(await api('/notifications/send', { method: 'POST', body: JSON.stringify(request) }));
    assert.equal(sent.summary.reachedCustomers, plan.summary.reachedCustomers);

    const detail = await json(await api(`/campaigns/${sent.campaign.id}`));
    assert.equal(detail.messages.length, plan.messages.length);
    assert.ok(detail.messages.every((m: { status: string }) => ['delivered', 'failed', 'skipped'].includes(m.status)));

    const log = await json(await api(`/messages?kind=schedule_change&limit=5`));
    assert.ok(log.total >= plan.summary.smsMessages + plan.summary.emailMessages);

    const overview = await json(await api('/overview'));
    assert.ok(overview.recentCampaigns.some((c: { id: string }) => c.id === sent.campaign.id));

    // Bad input gets a clear 400.
    const bad = await api('/notifications/preview', { method: 'POST', body: JSON.stringify({ request: { kind: 'alert', severity: 'delay', routeIds: 'all', channels: ['sms'], message: '' } }) });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /alert message/);

    // Unknown tenant header is rejected.
    assert.equal((await api('/bootstrap', { headers: { 'x-tenant': 'nope' } })).status, 404);
  } finally {
    await server.close();
  }
});

test('customer preference link works without the dashboard password', async () => {
  const ctx = testContext({ env: { DEMO_PASSWORD: 'pitch-day' } });
  const tenant = await seedDemoHauler(ctx);
  const customer = ctx.db.prepare('SELECT preference_token, id FROM customers WHERE tenant_id = ? AND email IS NOT NULL LIMIT 1').get(tenant.id) as { preference_token: string; id: string };
  const server = await startServer(ctx);
  try {
    assert.equal((await fetch(`${server.url}/api/bootstrap`)).status, 401, 'dashboard is locked');

    const prefs = await json(await fetch(`${server.url}/api/public/preferences/${customer.preference_token}`));
    assert.equal(prefs.tenant.name, 'Kestrel Ridge Disposal');
    assert.ok(!prefs.customer.email.includes('example.com') || prefs.customer.email.includes('***'), 'contact details are masked');

    const update = await json(await fetch(`${server.url}/api/public/preferences/${customer.preference_token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notifyBilling: !prefs.customer.notifyBilling }) }));
    assert.equal(update.changes.length, 1);

    const login = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pitch-day' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const events = await json(await fetch(`${server.url}/api/consent-events`, { headers: { cookie } }));
    assert.equal(events[0].source, 'Customer preference link');

    assert.equal((await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status, 401);
  } finally {
    await server.close();
  }
});

test('Twilio inbound STOP webhook updates consent', async () => {
  const ctx = testContext();
  const tenant = await seedDemoHauler(ctx);
  const c = ctx.db.prepare('SELECT id, phone FROM customers WHERE tenant_id = ? AND sms_opt_in = 1 LIMIT 1').get(tenant.id) as { id: string; phone: string };
  const server = await startServer(ctx);
  try {
    const res = await fetch(`${server.url}/api/webhooks/twilio/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: `+1${c.phone.replace(/\D/g, '')}`, Body: 'STOP' }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Response>/);
    const row = ctx.db.prepare('SELECT sms_opt_in FROM customers WHERE id = ?').get(c.id) as { sms_opt_in: number };
    assert.equal(row.sms_opt_in, 0);
  } finally {
    await server.close();
  }
});
