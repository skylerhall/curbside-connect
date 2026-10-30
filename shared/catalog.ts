// Descriptions of notification templates and the variables each one can use.
// Shared so the template editor and the server agree on the same list.
import type { TemplateKind } from './types.ts';

export interface TemplateInfo {
  kind: TemplateKind;
  label: string;
  description: string;
  category: 'pickup' | 'service' | 'billing';
  variables: string[];
}

export const COMMON_VARIABLES = [
  'first_name',
  'last_name',
  'company_name',
  'support_phone',
  'cart_out_time',
  'service_address',
  'account_number',
  'route_name',
  'portal_url',
  'preferences_url',
];

export const TEMPLATE_CATALOG: TemplateInfo[] = [
  {
    kind: 'pickup_reminder',
    label: 'Next-day pickup reminder',
    description: 'Sent the evening before a customer’s collection day.',
    category: 'pickup',
    variables: ['service_date_short', 'service_date_long', 'pickup_type', 'schedule_note'],
  },
  {
    kind: 'holiday_change',
    label: 'Holiday schedule change',
    description: 'Sent when a holiday slides a route’s pickup to another day.',
    category: 'service',
    variables: ['holiday_name', 'original_day', 'original_date_short', 'original_date_long', 'new_date_short', 'new_date_long'],
  },
  {
    kind: 'service_change',
    label: 'Service delay / schedule change',
    description: 'Weather delays, road closures, truck issues and other one-off changes.',
    category: 'service',
    variables: ['change_summary', 'change_headline', 'reason', 'original_date_short', 'new_date_short'],
  },
  {
    kind: 'route_change',
    label: 'Permanent pickup-day change',
    description: 'Sent when customers are moved to a new route or collection day.',
    category: 'service',
    variables: ['old_service_day', 'new_service_day', 'effective_date_short', 'effective_date_long', 'first_new_pickup_long'],
  },
  {
    kind: 'billing_upcoming',
    label: 'Upcoming bill reminder',
    description: 'For customers who pay manually, a few days before the due date.',
    category: 'billing',
    variables: ['amount_due', 'due_date_short', 'due_date_long'],
  },
  {
    kind: 'billing_autopay',
    label: 'Autopay heads-up',
    description: 'Lets autopay customers know when their payment will process.',
    category: 'billing',
    variables: ['amount_due', 'due_date_short', 'due_date_long'],
  },
  {
    kind: 'billing_past_due',
    label: 'Past-due balance notice',
    description: 'A courteous follow-up for accounts with an unpaid balance.',
    category: 'billing',
    variables: ['past_due', 'amount_due'],
  },
  {
    kind: 'alert',
    label: 'Weather & emergency alert',
    description: 'Free-form operator message wrapped in your company’s voice.',
    category: 'service',
    variables: ['alert_label', 'alert_message'],
  },
  {
    kind: 'correction',
    label: 'Correction',
    description: 'Sent only to the people who received a message that went out by mistake.',
    category: 'service',
    variables: ['correction_message', 'original_title'],
  },
];

export function templateInfo(kind: TemplateKind): TemplateInfo {
  return TEMPLATE_CATALOG.find((t) => t.kind === kind) ?? TEMPLATE_CATALOG[0];
}

// ── SMS segment math (shared so the editor shows the same numbers the server bills) ──

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  length: number;
  segments: number;
  nonGsmChars: string[];
}

export function smsSegments(text: string): SegmentInfo {
  const nonGsm = new Set<string>();
  let gsmLength = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else nonGsm.add(ch);
  }
  if (nonGsm.size === 0) {
    return { encoding: 'GSM-7', length: gsmLength, segments: gsmLength === 0 ? 0 : gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153), nonGsmChars: [] };
  }
  // UCS-2 counts UTF-16 code units (emoji take two).
  const units = text.length;
  return { encoding: 'UCS-2', length: units, segments: units <= 70 ? 1 : Math.ceil(units / 67), nonGsmChars: [...nonGsm] };
}

export function renderTemplate(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, name: string) => {
    if (name in vars) return vars[name];
    missing.add(name);
    return match;
  });
  return { text: out, missing: [...missing] };
}
