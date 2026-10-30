// Resend transactional email adapter (REST API, no SDK).
// Docs: https://resend.com/docs/api-reference/emails/send-email
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageStatus } from '../../shared/types.ts';
import type { NotificationProvider, OutboundMessage, SendResult, StatusSink } from './types.ts';

export interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo: string | null;
  usesWebhooks: boolean;
  fetchImpl?: typeof fetch;
}

/** Maps Resend webhook event types / last_event values onto our statuses. */
export function mapResendEvent(event: string): MessageStatus | null {
  const e = event.replace(/^email\./, '');
  switch (e) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'bounced':
    case 'failed':
    case 'complained':
      return 'failed';
    default:
      return null; // opened, clicked, delivery_delayed… are informational
  }
}

export class ResendEmailProvider implements NotificationProvider {
  readonly name = 'resend';
  readonly channel = 'email' as const;
  readonly live = true;
  private readonly opts: ResendOptions;
  private readonly fetch: typeof fetch;

  constructor(opts: ResendOptions) {
    this.opts = opts;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const from = this.opts.from.includes('<') ? this.opts.from : `${message.tenant.name} <${this.opts.from}>`;
    const res = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject ?? message.tenant.name,
        text: message.text,
        html: message.html ?? undefined,
        reply_to: this.opts.replyTo ?? undefined,
        tags: [{ name: 'message_id', value: message.messageId }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !data.id) {
      return { status: 'failed', providerMessageId: null, error: `Resend ${res.status}: ${data.message ?? data.name ?? 'request failed'}`, detail: 'Rejected by Resend' };
    }
    return { status: 'sent', providerMessageId: data.id, error: null, detail: 'Accepted by Resend' };
  }

  track(id: string, _message: OutboundMessage, sink: StatusSink): void {
    if (this.opts.usesWebhooks) return;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const res = await this.fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } });
        const data = (await res.json()) as { last_event?: string };
        const mapped = data.last_event ? mapResendEvent(data.last_event) : null;
        if (mapped === 'delivered' || mapped === 'failed') {
          sink(id, mapped, `Resend reported ${data.last_event}`, mapped === 'failed' ? `Resend: ${data.last_event}` : null);
          return;
        }
      } catch {
        // try again
      }
      if (attempts < 20) setTimeout(poll, 3000).unref?.();
    };
    setTimeout(poll, 3000).unref?.();
  }
}

/**
 * Verifies a Resend webhook (Svix signature scheme).
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */
export function verifyResendSignature(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest('base64');
  return headers.signature.split(' ').some((part) => {
    const [, sig] = part.split(',');
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
