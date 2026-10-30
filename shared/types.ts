// Types shared by the API server and the dashboard. Pure types only.

export type Channel = 'sms' | 'email';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'cancelled';
export type Category = 'pickup' | 'service' | 'billing';

export type NotificationKind =
  | 'pickup_reminder'
  | 'schedule_change'
  | 'route_change'
  | 'billing_reminder'
  | 'alert'
  | 'correction';

export type TemplateKind =
  | 'pickup_reminder'
  | 'holiday_change'
  | 'service_change'
  | 'route_change'
  | 'billing_upcoming'
  | 'billing_past_due'
  | 'billing_autopay'
  | 'alert'
  | 'correction';

export type OverrideKind = 'holiday' | 'weather' | 'operational';
export type AlertSeverity = 'advisory' | 'delay' | 'emergency';
export type BillingMode = 'upcoming' | 'past_due' | 'autopay';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  timezone: string;
  brandPrimary: string;
  brandDark: string;
  brandAccent: string;
  logoInitials: string;
  supportPhone: string;
  supportEmail: string;
  website: string;
  portalUrl: string;
  cartOutTime: string;
  billingDueDay: number;
  serviceArea: string;
}

export interface Route {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  serviceDay: number; // 1 = Monday … 5 = Friday
  area: string;
  recyclingAnchor: string; // a date (YYYY-MM-DD) on which recycling was collected; recycling is every other week
  customerCount?: number;
}

export interface Customer {
  id: string;
  tenantId: string;
  routeId: string;
  accountNumber: string;
  firstName: string;
  lastName: string;
  serviceAddress: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  email: string | null;
  serviceLevel: string;
  monthlyRateCents: number;
  pastDueCents: number;
  autopay: boolean;
  status: 'active' | 'suspended';
  smsOptIn: boolean;
  emailOptIn: boolean;
  notifyPickup: boolean;
  notifyService: boolean;
  notifyBilling: boolean;
  consentSource: string;
  consentUpdatedAt: string;
  preferenceToken: string;
  nextRouteId: string | null;
  nextRouteEffective: string | null;
  isDemoContact: boolean;
  createdAt: string;
}

export interface Template {
  id: string;
  tenantId: string;
  kind: TemplateKind;
  channel: Channel;
  subject: string | null;
  body: string;
  isCustomized: boolean;
  updatedAt: string;
}

export interface ScheduleOverride {
  id: string;
  tenantId: string;
  routeId: string;
  originalDate: string;
  newDate: string | null; // null = pickup cancelled
  kind: OverrideKind;
  reason: string;
  holidayName: string | null;
  createdAt: string;
  notifiedCampaignId: string | null;
}

export interface CampaignCounts {
  recipients: number;
  messages: number;
  skipped: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  cancelled: number;
}

/** held = waiting out the undo window; sent = handed to providers; cancelled = stopped before sending. */
export type CampaignStatus = 'held' | 'sent' | 'cancelled';

export interface Campaign {
  id: string;
  tenantId: string;
  kind: NotificationKind;
  title: string;
  trigger: 'manual' | 'automation';
  params: unknown;
  createdAt: string;
  createdBy: string;
  counts: CampaignCounts;
  inFlight: boolean;
  status: CampaignStatus;
  sendAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  correctsCampaignId: string | null;
}

export interface Message {
  id: string;
  tenantId: string;
  campaignId: string;
  campaignTitle?: string;
  customerId: string;
  customerName: string;
  routeName: string | null;
  channel: Channel | null;
  toAddress: string | null;
  subject: string | null;
  body: string | null;
  segments: number;
  status: MessageStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  templateKind: TemplateKind | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface MessageEvent {
  status: MessageStatus;
  detail: string | null;
  at: string;
}

// ── Notification requests (what an operator or automation asks for) ──────

export type NotificationRequest =
  | { kind: 'pickup_reminder'; serviceDate: string; routeIds?: string[] }
  | { kind: 'schedule_change'; overrideIds: string[] }
  | { kind: 'route_change'; customerIds: string[]; toRouteId: string; effectiveDate: string }
  | { kind: 'billing_reminder'; mode: BillingMode; customerIds?: string[] }
  | {
      kind: 'alert';
      severity: AlertSeverity;
      routeIds: string[] | 'all';
      message: string;
      channels: Channel[];
    }
  | {
      kind: 'correction';
      campaignId: string;
      message: string;
      /** Also reverse the original change (remove the schedule change / cancel the route move). */
      undoChange?: boolean;
    };

export interface PlannedMessage {
  customerId: string;
  customerName: string;
  routeName: string | null;
  channel: Channel | null;
  to: string | null;
  subject: string | null;
  body: string | null;
  segments: number;
  status: 'ready' | 'skipped';
  skipReason: string | null;
  templateKind: TemplateKind;
  dedupeKey: string | null;
}

export interface PlanSummary {
  matchedCustomers: number;
  reachedCustomers: number;
  smsMessages: number;
  emailMessages: number;
  skippedCustomers: number;
  skipReasons: Record<string, number>;
  estimatedSmsCost: number;
}

export interface Plan {
  kind: NotificationKind;
  title: string;
  description: string;
  bypassCategory: boolean;
  messages: PlannedMessage[];
  summary: PlanSummary;
  /** Things worth a second look before sending (Sunday date, past date, large send…). */
  warnings: string[];
}

export interface ProviderStatus {
  sms: { provider: string; live: boolean; configured: boolean; detail: string };
  email: { provider: string; live: boolean; configured: boolean; detail: string };
  allowlist: string[];
  allowAll: boolean;
}

export interface Automation {
  id: string;
  tenantId: string;
  kind: 'pickup_reminder' | 'billing_reminder';
  enabled: boolean;
  runTime: string; // HH:MM tenant-local
  config: { daysBefore?: number; pastDueGraceDays?: number };
  lastRunDate: string | null;
  lastRunAt: string | null;
  lastCampaignId: string | null;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  summary: string;
  at: string;
}

export interface ConsentEvent {
  id: number;
  customerId: string;
  customerName: string;
  change: string;
  source: string;
  at: string;
}
