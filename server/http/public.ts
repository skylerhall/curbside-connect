// Routes reachable without the dashboard password: the customer-facing
// preference page (from the link in each email) and provider webhooks.
import express, { Router } from 'express';
import type { MessageStatus } from '../../shared/types.ts';
import * as repo from '../db/repo.ts';
import { handleInboundSms } from '../engine/consent.ts';
import { type AppContext, nowIso } from '../engine/context.ts';
import { maskAddress } from '../lib/contact.ts';
import { mapResendEvent, verifyResendSignature } from '../providers/resend.ts';
import { mapTwilioStatus, validateTwilioSignature } from '../providers/twilio.ts';

type RawRequest = express.Request & { rawBody?: string };

function captureRaw(req: RawRequest, _res: unknown, buf: Buffer): void {
  req.rawBody = buf.toString('utf8');
}

export function publicRouter(ctx: AppContext): Router {
  const { db, config } = ctx;
  const r = Router();

  // ── Customer preference page ────────────────────────────────────────────

  r.get('/public/preferences/:token', (req, res) => {
    const customer = repo.getCustomerByToken(db, req.params.token);
    if (!customer) return res.status(404).json({ error: 'This link is no longer valid.' });
    const tenant = repo.getTenantById(db, customer.tenantId)!;
    res.json({
      tenant: { name: tenant.name, logoInitials: tenant.logoInitials, brandPrimary: tenant.brandPrimary, brandDark: tenant.brandDark, brandAccent: tenant.brandAccent, supportPhone: tenant.supportPhone, website: tenant.website },
      customer: {
        firstName: customer.firstName,
        serviceAddress: customer.serviceAddress,
        phone: customer.phone ? maskAddress(customer.phone) : null,
        email: customer.email ? maskAddress(customer.email) : null,
        smsOptIn: customer.smsOptIn,
        emailOptIn: customer.emailOptIn,
        notifyPickup: customer.notifyPickup,
        notifyService: customer.notifyService,
        notifyBilling: customer.notifyBilling,
      },
    });
  });

  r.put('/public/preferences/:token', express.json({ limit: '10kb' }), (req, res) => {
    const customer = repo.getCustomerByToken(db, req.params.token);
    if (!customer) return res.status(404).json({ error: 'This link is no longer valid.' });
    const b = req.body ?? {};
    const patch: repo.PreferencePatch = {};
    for (const key of ['smsOptIn', 'emailOptIn', 'notifyPickup', 'notifyService', 'notifyBilling'] as const) {
      if (typeof b[key] === 'boolean') patch[key] = b[key];
    }
    if (patch.smsOptIn && !customer.phone) delete patch.smsOptIn;
    if (patch.emailOptIn && !customer.email) delete patch.emailOptIn;
    const now = nowIso(ctx);
    const changes = repo.updatePreferences(db, customer, patch, 'Customer preference link', now);
    if (changes.length) repo.audit(db, customer.tenantId, 'customer', 'consent.self_service', `${customer.firstName} ${customer.lastName} updated preferences: ${changes.join(', ')}.`, now);
    res.json({ ok: true, changes });
  });

  // ── Twilio webhooks ─────────────────────────────────────────────────────

  const twilioForm = express.urlencoded({ extended: false, verify: captureRaw as never });

  const twilioVerified = (req: RawRequest, path: string): boolean => {
    if (!config.twilio.authToken || !config.publicBaseUrl) return config.smsProvider !== 'twilio';
    const sig = req.header('x-twilio-signature') ?? '';
    return validateTwilioSignature(config.twilio.authToken, `${config.publicBaseUrl}${path}`, req.body ?? {}, sig);
  };

  r.post('/webhooks/twilio/status', twilioForm, (req: RawRequest, res) => {
    if (!twilioVerified(req, '/api/webhooks/twilio/status')) return res.status(403).send('Invalid signature');
    const sid = String(req.body?.MessageSid ?? '');
    const status = mapTwilioStatus(String(req.body?.MessageStatus ?? ''));
    const found = sid ? repo.findMessageByProviderId(db, sid) : null;
    if (found && status && status !== 'queued') {
      const code = req.body?.ErrorCode ? ` (error ${req.body.ErrorCode})` : '';
      repo.applyStatus(db, found.id, status as MessageStatus, `Twilio reported ${req.body.MessageStatus}${code}`, status === 'failed' ? `Twilio ${req.body.MessageStatus}${code}` : null, nowIso(ctx));
    }
    res.status(204).end();
  });

  r.post('/webhooks/twilio/inbound', twilioForm, (req: RawRequest, res) => {
    if (!twilioVerified(req, '/api/webhooks/twilio/inbound')) return res.status(403).send('Invalid signature');
    const tenant = repo.getTenantBySlug(db, config.defaultTenant);
    if (tenant) handleInboundSms(ctx, tenant, String(req.body?.From ?? ''), String(req.body?.Body ?? ''), 'SMS reply');
    // Twilio's built-in opt-out handling sends the STOP/HELP confirmations, so
    // we reply with empty TwiML to avoid double-texting.
    res.type('text/xml').send('<Response></Response>');
  });

  // ── Resend webhooks ─────────────────────────────────────────────────────

  r.post('/webhooks/resend', express.json({ limit: '200kb', verify: captureRaw as never }), (req: RawRequest, res) => {
    const secret = config.resend.webhookSecret;
    if (secret) {
      const ok = verifyResendSignature(
        secret,
        { id: req.header('svix-id') ?? '', timestamp: req.header('svix-timestamp') ?? '', signature: req.header('svix-signature') ?? '' },
        req.rawBody ?? '',
      );
      if (!ok) return res.status(403).send('Invalid signature');
    } else if (config.emailProvider === 'resend') {
      return res.status(403).send('RESEND_WEBHOOK_SECRET is not configured');
    }
    const type = String(req.body?.type ?? '');
    const emailId = String(req.body?.data?.email_id ?? '');
    const status = mapResendEvent(type);
    const found = emailId ? repo.findMessageByProviderId(db, emailId) : null;
    if (found && status) repo.applyStatus(db, found.id, status, `Resend reported ${type}`, status === 'failed' ? `Resend: ${type}` : null, nowIso(ctx));
    res.status(204).end();
  });

  return r;
}
