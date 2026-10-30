// Opt-in / opt-out handling. Every change is written to consent_events so the
// hauler can show when and how each customer agreed (or stopped agreeing).
import type { Customer, Tenant } from '../../shared/types.ts';
import { audit, findCustomersByPhone, updatePreferences } from '../db/repo.ts';
import { type AppContext, nowIso } from './context.ts';

// Carrier / CTIA standard keywords.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

export type InboundAction = 'opt_out' | 'opt_in' | 'help' | 'none';

export interface InboundResult {
  action: InboundAction;
  reply: string | null;
  customers: Customer[];
}

export function classifyKeyword(body: string): InboundAction {
  const word = body.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (STOP_WORDS.has(word)) return 'opt_out';
  if (START_WORDS.has(word)) return 'opt_in';
  if (HELP_WORDS.has(word)) return 'help';
  return 'none';
}

export function handleInboundSms(ctx: AppContext, tenant: Tenant, from: string, body: string, source = 'sms_reply'): InboundResult {
  const action = classifyKeyword(body);
  const customers = findCustomersByPhone(ctx.db, tenant.id, from);
  const now = nowIso(ctx);

  if (action === 'opt_out' || action === 'opt_in') {
    for (const c of customers) {
      const changes = updatePreferences(ctx.db, c, { smsOptIn: action === 'opt_in' }, source, now);
      if (changes.length) audit(ctx.db, tenant.id, 'customer', 'consent.sms', `${c.firstName} ${c.lastName} replied "${body.trim()}" (${changes.join(', ')}).`, now);
    }
  }

  const reply =
    action === 'opt_out'
      ? `${tenant.name}: You're unsubscribed and will get no more texts. Reply START to resubscribe.`
      : action === 'opt_in'
        ? `${tenant.name}: You're subscribed to service and billing texts. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel.`
        : action === 'help'
          ? `${tenant.name}: Help at ${tenant.supportPhone} or ${tenant.website}. Msg & data rates may apply. Reply STOP to cancel.`
          : null;

  return { action, reply, customers };
}
