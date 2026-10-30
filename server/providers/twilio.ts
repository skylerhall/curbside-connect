// Twilio Programmable Messaging adapter (REST API, no SDK).
// Docs: https://www.twilio.com/docs/messaging/api/message-resource
import { createHmac, timingSafeEqual } from 'node:crypto';
import { toE164 } from '../lib/contact.ts';
import type { MessageStatus } from '../../shared/types.ts';
import type { NotificationProvider, OutboundMessage, SendResult, StatusSink } from './types.ts';

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  fromNumber: string | null;
  messagingServiceSid: string | null;
  statusCallbackUrl: string | null;
  fetchImpl?: typeof fetch;
}

/** Maps Twilio message statuses onto ours. */
export function mapTwilioStatus(status: string): MessageStatus | null {
  switch (status) {
    case 'accepted':
    case 'scheduled':
    case 'queued':
    case 'sending':
      return 'queued';
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'undelivered':
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return null;
  }
}

export class TwilioSmsProvider implements NotificationProvider {
  readonly name = 'twilio';
  readonly channel = 'sms' as const;
  readonly live = true;
  private readonly opts: TwilioOptions;
  private readonly fetch: typeof fetch;

  constructor(opts: TwilioOptions) {
    if (!opts.fromNumber && !opts.messagingServiceSid) throw new Error('Twilio needs TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
    this.opts = opts;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  private get auth(): string {
    return `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = toE164(message.to);
    if (!to) return { status: 'failed', providerMessageId: null, error: `Invalid phone number: ${message.to}`, detail: 'Rejected before sending' };

    const form = new URLSearchParams({ To: to, Body: message.text });
    if (this.opts.messagingServiceSid) form.set('MessagingServiceSid', this.opts.messagingServiceSid);
    else if (this.opts.fromNumber) form.set('From', this.opts.fromNumber);
    if (this.opts.statusCallbackUrl) form.set('StatusCallback', this.opts.statusCallbackUrl);

    const res = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
    if (!res.ok || !data.sid) {
      const error = `Twilio ${res.status}${data.code ? ` (error ${data.code})` : ''}: ${data.message ?? 'request failed'}`;
      return { status: 'failed', providerMessageId: null, error, detail: 'Rejected by Twilio' };
    }
    return { status: 'sent', providerMessageId: data.sid, error: null, detail: `Accepted by Twilio (${data.status ?? 'queued'})` };
  }

  /** Without a public webhook URL (e.g. running on a laptop), poll for the final status. */
  track(sid: string, _message: OutboundMessage, sink: StatusSink): void {
    if (this.opts.statusCallbackUrl) return; // webhooks will report status
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const res = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages/${sid}.json`, {
          headers: { Authorization: this.auth },
        });
        const data = (await res.json()) as { status?: string; error_code?: number | null; error_message?: string | null };
        const mapped = data.status ? mapTwilioStatus(data.status) : null;
        if (mapped === 'delivered' || mapped === 'failed') {
          const error = mapped === 'failed' ? `Twilio ${data.status}${data.error_code ? ` (error ${data.error_code})` : ''}` : null;
          sink(sid, mapped, `Twilio reported ${data.status}`, error);
          return;
        }
      } catch {
        // network hiccup — try again
      }
      if (attempts < 20) setTimeout(poll, 3000).unref?.();
    };
    setTimeout(poll, 2000).unref?.();
  }
}

/**
 * Validates the X-Twilio-Signature header.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validateTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
