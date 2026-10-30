import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { smsSegments } from '../shared/catalog.ts';
import * as repo from '../server/db/repo.ts';
import { executeNotification } from '../server/engine/dispatch.ts';
import { isFictionalAddress } from '../server/lib/contact.ts';
import { ProviderRouter } from '../server/providers/index.ts';
import { verifyResendSignature, ResendEmailProvider } from '../server/providers/resend.ts';
import { TwilioSmsProvider, validateTwilioSignature } from '../server/providers/twilio.ts';
import type { NotificationProvider, OutboundMessage, SendResult } from '../server/providers/types.ts';
import { seedDemoHauler, testConfig, testContext } from './helpers.ts';

test('SMS segment math matches carrier rules', () => {
  assert.deepEqual(smsSegments('a'.repeat(160)).segments, 1);
  assert.deepEqual(smsSegments('a'.repeat(161)).segments, 2);
  const dash = smsSegments('Pickup moved — see you Friday');
  assert.equal(dash.encoding, 'UCS-2', 'an em dash forces Unicode');
  assert.deepEqual(dash.nonGsmChars, ['—']);
  assert.equal(smsSegments('x'.repeat(71) + '’').segments, 2);
});

test('fictional demo contacts are recognised and can never be sent live', () => {
  assert.ok(isFictionalAddress('(970) 555-0142'));
  assert.ok(isFictionalAddress('avery.collins12@example.com'));
  assert.ok(!isFictionalAddress('(970) 555-2368'));
  assert.ok(!isFictionalAddress('someone@gmail.com'));
});

class FakeLive implements NotificationProvider {
  readonly name = 'fake-live';
  readonly live = true;
  readonly channel = 'sms' as const;
  sent: OutboundMessage[] = [];
  async send(m: OutboundMessage): Promise<SendResult> {
    this.sent.push(m);
    return { status: 'sent', providerMessageId: `FAKE${this.sent.length}`, error: null, detail: 'ok' };
  }
}

test('live mode only reaches allowlisted recipients; everyone else stays simulated', async () => {
  const live = new FakeLive();
  const ctx = testContext({ env: { LIVE_ALLOWLIST: '+1 (720) 555-9876' }, live: { sms: live } });
  const tenant = await seedDemoHauler(ctx);
  const route = repo.listRoutes(ctx.db, tenant.id)[0];
  // The presenter adds themself as a demo customer.
  const me = { ...repo.listCustomers(ctx.db, tenant.id, { routeId: route.id })[0], id: 'cus_me', accountNumber: 'DEMO-1', phone: '(720) 555-9876', smsOptIn: true, notifyService: true, preferenceToken: 'tok_me', status: 'active' as const };
  repo.insertCustomer(ctx.db, me);

  const { campaign } = await executeNotification(ctx, tenant, { kind: 'alert', severity: 'advisory', routeIds: [route.id], channels: ['sms'], message: 'Live test' }, { trigger: 'manual', actor: 'test' });
  assert.equal(live.sent.length, 1, 'exactly one real text');
  assert.equal(live.sent[0].to, '(720) 555-9876');
  const { items } = repo.listMessages(ctx.db, tenant.id, { campaignId: campaign.id, limit: 500 });
  assert.equal(items.find((m) => m.customerId === 'cus_me')!.provider, 'fake-live');
  assert.ok(items.filter((m) => m.customerId !== 'cus_me' && m.status !== 'skipped').every((m) => m.provider === 'simulated'));
});

test('without credentials a "live" provider setting safely falls back to simulation', () => {
  const router = new ProviderRouter(testConfig({ SMS_PROVIDER: 'twilio', EMAIL_PROVIDER: 'resend' }));
  const status = router.status();
  assert.equal(status.sms.live, false);
  assert.equal(status.email.live, false);
  assert.match(status.sms.detail, /using simulation/);
  assert.equal(router.select('sms', '+19705551234').name, 'simulated');
});

test('Twilio adapter sends the right request and maps errors', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (calls.length === 1) return new Response(JSON.stringify({ sid: 'SM123', status: 'queued' }), { status: 201 });
    return new Response(JSON.stringify({ code: 21610, message: 'Attempt to send to unsubscribed recipient' }), { status: 400 });
  }) as typeof fetch;
  const twilio = new TwilioSmsProvider({ accountSid: 'AC1', authToken: 'secret', fromNumber: '+19705550000', messagingServiceSid: null, statusCallbackUrl: 'https://demo.example.com/api/webhooks/twilio/status', fetchImpl });
  const tenant = { name: 'Kestrel Ridge Disposal' } as OutboundMessage['tenant'];
  const ok = await twilio.send({ messageId: 'm1', channel: 'sms', to: '(970) 555-2368', subject: null, text: 'Hello', html: null, tenant });
  assert.equal(ok.status, 'sent');
  assert.equal(ok.providerMessageId, 'SM123');
  assert.equal(calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get('To'), '+19705552368');
  assert.equal(form.get('From'), '+19705550000');
  assert.equal(form.get('StatusCallback'), 'https://demo.example.com/api/webhooks/twilio/status');
  assert.match(String((calls[0].init.headers as Record<string, string>).Authorization), /^Basic /);

  const bad = await twilio.send({ messageId: 'm2', channel: 'sms', to: '9705552368', subject: null, text: 'Hello', html: null, tenant });
  assert.equal(bad.status, 'failed');
  assert.match(bad.error!, /21610/);
});

test('Resend adapter sends JSON with the tenant as sender name', async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
  }) as typeof fetch;
  const resend = new ResendEmailProvider({ apiKey: 're_x', from: 'alerts@notify.example.org', replyTo: null, usesWebhooks: true, fetchImpl });
  const r = await resend.send({ messageId: 'm1', channel: 'email', to: 'me@test.dev', subject: 'Hi', text: 'Body', html: '<p>Body</p>', tenant: { name: 'Kestrel Ridge Disposal' } as OutboundMessage['tenant'] });
  assert.equal(r.providerMessageId, 'em_1');
  assert.equal(body.from, 'Kestrel Ridge Disposal <alerts@notify.example.org>');
  assert.deepEqual(body.to, ['me@test.dev']);
});

test('webhook signatures are verified', () => {
  // Twilio: HMAC-SHA1 over URL + sorted params.
  const url = 'https://demo.example.com/api/webhooks/twilio/status';
  const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
  const sig = createHmac('sha1', 'tok').update(`${url}MessageSidSM1MessageStatusdelivered`).digest('base64');
  assert.ok(validateTwilioSignature('tok', url, params, sig));
  assert.ok(!validateTwilioSignature('tok', url, { ...params, MessageStatus: 'failed' }, sig));

  // Resend / Svix.
  const secret = `whsec_${Buffer.from('supersecretkey').toString('base64')}`;
  const ts = '1760000000';
  const raw = '{"type":"email.delivered"}';
  const s = createHmac('sha256', Buffer.from('supersecretkey')).update(`msg_1.${ts}.${raw}`).digest('base64');
  assert.ok(verifyResendSignature(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${s}` }, raw, 1760000010));
  assert.ok(!verifyResendSignature(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${s}` }, raw, 1760009999), 'stale timestamps are rejected');
});
