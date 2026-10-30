// Safe default provider. Nothing leaves the server; messages move through the
// same sent → delivered/failed lifecycle a real carrier would report.
import { randomString } from '../db/repo.ts';
import { toE164 } from '../lib/contact.ts';
import type { Channel } from '../../shared/types.ts';
import type { NotificationProvider, OutboundMessage, SendResult, StatusSink } from './types.ts';

/**
 * Deterministic failure rules so the demo log shows realistic problems:
 *  - SMS to a number ending in 0199 → carrier reports unreachable handset
 *  - email to an address @bounced.example.com → hard bounce
 */
export function simulatedOutcome(channel: Channel, to: string): { ok: true } | { ok: false; error: string } {
  if (channel === 'sms' && toE164(to)?.endsWith('0199')) {
    return { ok: false, error: 'Unreachable destination handset (carrier error 30003, simulated)' };
  }
  if (channel === 'email' && to.toLowerCase().endsWith('@bounced.example.com')) {
    return { ok: false, error: 'Mailbox does not exist (hard bounce, simulated)' };
  }
  return { ok: true };
}

export class SimulatedProvider implements NotificationProvider {
  readonly name = 'simulated';
  readonly live = false;
  readonly channel: Channel;
  private readonly delayMs: number;

  constructor(channel: Channel, delayMs: number) {
    this.channel = channel;
    this.delayMs = delayMs;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const prefix = message.channel === 'sms' ? 'SMsim' : 'EMsim';
    return {
      status: 'sent',
      providerMessageId: `${prefix}_${randomString(16)}`,
      error: null,
      detail: message.channel === 'sms' ? 'Accepted by simulated SMS carrier' : 'Accepted by simulated mail server',
    };
  }

  track(providerMessageId: string, message: OutboundMessage, sink: StatusSink): void {
    const outcome = simulatedOutcome(message.channel, message.to);
    const finish = () =>
      outcome.ok
        ? sink(providerMessageId, 'delivered', message.channel === 'sms' ? 'Delivered to handset (simulated)' : 'Delivered to inbox (simulated)')
        : sink(providerMessageId, 'failed', outcome.error, outcome.error);
    if (this.delayMs <= 0) return finish();
    // Jitter so a batch "lands" over a second or two, like real traffic.
    const delay = this.delayMs * (0.5 + Math.random());
    setTimeout(finish, delay).unref?.();
  }
}
