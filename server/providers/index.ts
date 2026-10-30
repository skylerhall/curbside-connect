// Chooses which provider delivers each message.
//
// Safety model: a live provider is only used when it is configured AND the
// recipient is on LIVE_ALLOWLIST (or LIVE_ALLOW_ALL=true). Reserved fictional
// numbers/emails are never sent live. Everyone else is simulated, so the demo
// can text the presenter's phone while the fictional customers stay simulated.
import type { AppConfig } from '../config.ts';
import { isFictionalAddress, maskAddress, normalizeAddress } from '../lib/contact.ts';
import type { Channel, ProviderStatus } from '../../shared/types.ts';
import { ResendEmailProvider } from './resend.ts';
import { SimulatedProvider } from './simulated.ts';
import { TwilioSmsProvider } from './twilio.ts';
import type { NotificationProvider } from './types.ts';

export class ProviderRouter {
  private readonly simulated: Record<Channel, NotificationProvider>;
  private readonly live: Partial<Record<Channel, NotificationProvider>> = {};
  private readonly problems: Partial<Record<Channel, string>> = {};
  private readonly allowlist: Set<string>;
  private readonly allowAll: boolean;

  constructor(config: AppConfig, overrides: Partial<Record<Channel, NotificationProvider>> = {}) {
    this.simulated = {
      sms: new SimulatedProvider('sms', config.simulatedDelayMs),
      email: new SimulatedProvider('email', config.simulatedDelayMs),
    };
    this.allowlist = new Set(config.liveAllowlist);
    this.allowAll = config.liveAllowAll;

    if (overrides.sms) this.live.sms = overrides.sms;
    else if (config.smsProvider === 'twilio') {
      const t = config.twilio;
      if (t.accountSid && t.authToken && (t.fromNumber || t.messagingServiceSid)) {
        this.live.sms = new TwilioSmsProvider({
          accountSid: t.accountSid,
          authToken: t.authToken,
          fromNumber: t.fromNumber,
          messagingServiceSid: t.messagingServiceSid,
          statusCallbackUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/api/webhooks/twilio/status` : null,
        });
      } else {
        this.problems.sms = 'SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender are not all set; using simulation.';
      }
    }

    if (overrides.email) this.live.email = overrides.email;
    else if (config.emailProvider === 'resend') {
      const r = config.resend;
      if (r.apiKey && r.from) {
        this.live.email = new ResendEmailProvider({
          apiKey: r.apiKey,
          from: r.from,
          replyTo: r.replyTo,
          usesWebhooks: Boolean(config.publicBaseUrl && r.webhookSecret),
        });
      } else {
        this.problems.email = 'EMAIL_PROVIDER=resend but RESEND_API_KEY and RESEND_FROM_EMAIL are not both set; using simulation.';
      }
    }

    for (const channel of ['sms', 'email'] as Channel[]) {
      if (this.problems[channel]) console.warn(`[providers] ${this.problems[channel]}`);
    }
  }

  /** Picks the provider for one recipient. */
  select(channel: Channel, to: string): NotificationProvider {
    const live = this.live[channel];
    if (!live || isFictionalAddress(to)) return this.simulated[channel];
    if (this.allowAll || this.allowlist.has(normalizeAddress(to))) return live;
    return this.simulated[channel];
  }

  byName(name: string): NotificationProvider | null {
    for (const p of [...Object.values(this.live), ...Object.values(this.simulated)]) if (p?.name === name) return p;
    return null;
  }

  status(): ProviderStatus {
    const describe = (channel: Channel) => {
      const live = this.live[channel];
      if (live) {
        const scope = this.allowAll ? 'all consented customers' : this.allowlist.size ? `${this.allowlist.size} allowlisted recipient(s); everyone else simulated` : 'no recipients yet (LIVE_ALLOWLIST is empty)';
        return { provider: live.name, live: true, configured: true, detail: `Live delivery to ${scope}.` };
      }
      return { provider: 'simulated', live: false, configured: !this.problems[channel], detail: this.problems[channel] ?? 'Simulated: nothing leaves the server.' };
    };
    return { sms: describe('sms'), email: describe('email'), allowlist: [...this.allowlist].map(maskAddress), allowAll: this.allowAll };
  }
}
