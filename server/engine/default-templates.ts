// Starting templates for a new tenant. SMS bodies deliberately avoid
// characters outside the GSM-7 alphabet (curly quotes, em dashes, emoji),
// which would force Unicode encoding and roughly double the per-text cost.
import type { Channel, TemplateKind } from '../../shared/types.ts';

export interface DefaultTemplate {
  kind: TemplateKind;
  channel: Channel;
  subject: string | null;
  body: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    kind: 'pickup_reminder',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: Reminder, your {{pickup_type}} pickup is tomorrow, {{service_date_short}}.{{schedule_note}} Please have carts at the curb by {{cart_out_time}}. Reply STOP to opt out.',
  },
  {
    kind: 'pickup_reminder',
    channel: 'email',
    subject: 'Pickup reminder: {{service_date_long}}',
    body: `Hi {{first_name}},

This is a friendly reminder that your {{pickup_type}} pickup at {{service_address}} is tomorrow, {{service_date_long}}.{{schedule_note}}

Please have your carts at the curb by {{cart_out_time}} with lids closed.

Thank you for choosing {{company_name}}!
{{support_phone}}`,
  },
  {
    kind: 'holiday_change',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: {{holiday_name}} schedule. Your {{original_day}} pickup moves to {{new_date_short}} this week. Carts out by {{cart_out_time}}. Reply STOP to opt out.',
  },
  {
    kind: 'holiday_change',
    channel: 'email',
    subject: '{{holiday_name}} schedule: your pickup moves to {{new_date_long}}',
    body: `Hi {{first_name}},

In observance of {{holiday_name}}, collection this week slides one day. Your regular {{original_day}} pickup on {{original_date_long}} will be collected on {{new_date_long}} instead.

Please have your carts at the curb by {{cart_out_time}}.

Happy holidays from all of us at {{company_name}}!
{{support_phone}}`,
  },
  {
    kind: 'service_change',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: {{change_summary}} Reason: {{reason}}. Reply STOP to opt out.',
  },
  {
    kind: 'service_change',
    channel: 'email',
    subject: 'Service update: {{change_headline}}',
    body: `Hi {{first_name}},

{{change_summary}}

Reason: {{reason}}

Please have your carts at the curb by {{cart_out_time}}. We're sorry for the inconvenience and appreciate your patience.

{{company_name}}
{{support_phone}}`,
  },
  {
    kind: 'route_change',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: Starting {{effective_date_short}}, your pickup day changes from {{old_service_day}} to {{new_service_day}}. Reply STOP to opt out.',
  },
  {
    kind: 'route_change',
    channel: 'email',
    subject: 'Your pickup day is changing to {{new_service_day}}',
    body: `Hi {{first_name}},

To keep routes running on time, we're updating collection days in your area. Starting {{effective_date_long}}, your pickup at {{service_address}} moves from {{old_service_day}} to {{new_service_day}}.

Your first {{new_service_day}} pickup will be {{first_new_pickup_long}}. Please have your carts at the curb by {{cart_out_time}}.

Questions? Call us at {{support_phone}}.

{{company_name}}`,
  },
  {
    kind: 'billing_upcoming',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: Your bill of {{amount_due}} is due {{due_date_short}}. Pay online at {{portal_url}} or call {{support_phone}}. Reply STOP to opt out.',
  },
  {
    kind: 'billing_upcoming',
    channel: 'email',
    subject: 'Your {{company_name}} bill of {{amount_due}} is due {{due_date_short}}',
    body: `Hi {{first_name}},

Your bill for account {{account_number}} is {{amount_due}} and is due on {{due_date_long}}.

Pay online: {{portal_url}}

Prefer not to think about it? Ask us about autopay at {{support_phone}}.

Thank you,
{{company_name}}`,
  },
  {
    kind: 'billing_autopay',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: Heads up, your autopay of {{amount_due}} will process on {{due_date_short}}. No action needed. Reply STOP to opt out.',
  },
  {
    kind: 'billing_autopay',
    channel: 'email',
    subject: 'Autopay of {{amount_due}} scheduled for {{due_date_short}}',
    body: `Hi {{first_name}},

Just a heads-up: your autopay payment of {{amount_due}} for account {{account_number}} will process on {{due_date_long}}. No action is needed.

Thank you,
{{company_name}}`,
  },
  {
    kind: 'billing_past_due',
    channel: 'sms',
    subject: null,
    body: '{{company_name}}: Your account has a past-due balance of {{past_due}}. Please pay at {{portal_url}} or call {{support_phone}}. Reply STOP to opt out.',
  },
  {
    kind: 'billing_past_due',
    channel: 'email',
    subject: 'Past-due balance on your {{company_name}} account',
    body: `Hi {{first_name}},

Our records show a past-due balance of {{past_due}} on account {{account_number}}. If you've already paid, thank you, and please disregard this notice.

Pay online: {{portal_url}}
Questions: {{support_phone}}

{{company_name}}`,
  },
  {
    kind: 'alert',
    channel: 'sms',
    subject: null,
    body: '{{company_name}} {{alert_label}}: {{alert_message}} Reply STOP to opt out.',
  },
  {
    kind: 'alert',
    channel: 'email',
    subject: '{{alert_label}} from {{company_name}}',
    body: `Hi {{first_name}},

{{alert_message}}

We'll keep you posted if anything changes. Questions? Call {{support_phone}}.

{{company_name}}`,
  },
  {
    kind: 'correction',
    channel: 'sms',
    subject: null,
    body: '{{company_name}} correction: {{correction_message}} Reply STOP to opt out.',
  },
  {
    kind: 'correction',
    channel: 'email',
    subject: 'Correction: please disregard our earlier message',
    body: `Hi {{first_name}},

We sent you a message by mistake. {{correction_message}}

We're sorry for the mix-up. Questions? Call {{support_phone}}.

{{company_name}}`,
  },
];

export function defaultTemplate(kind: TemplateKind, channel: Channel): DefaultTemplate {
  const found = DEFAULT_TEMPLATES.find((t) => t.kind === kind && t.channel === channel);
  if (!found) throw new Error(`No default template for ${kind}/${channel}`);
  return found;
}
