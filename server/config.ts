import { createHash } from 'node:crypto';
import { normalizeAddress } from './lib/contact.ts';

export interface AppConfig {
  port: number;
  databasePath: string;
  defaultTenant: string;
  publicBaseUrl: string | null;
  demoPassword: string | null;
  sessionSecret: string;
  smsProvider: 'simulated' | 'twilio';
  emailProvider: 'simulated' | 'resend';
  liveAllowlist: string[];
  liveAllowAll: boolean;
  simulatedDelayMs: number;
  /** Seconds a manual send waits (and can be cancelled) before going out. 0 = send immediately. */
  sendHoldSeconds: number;
  smsCostPerSegment: number;
  schedulerEnabled: boolean;
  twilio: {
    accountSid: string | null;
    authToken: string | null;
    fromNumber: string | null;
    messagingServiceSid: string | null;
  };
  resend: {
    apiKey: string | null;
    from: string | null;
    replyTo: string | null;
    webhookSecret: string | null;
  };
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const value = str(env, key);
  if (value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(env: Env, key: string, fallback: number): number {
  const value = Number(str(env, key));
  return Number.isFinite(value) && str(env, key) !== null ? value : fallback;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const demoPassword = str(env, 'DEMO_PASSWORD');
  const sms = str(env, 'SMS_PROVIDER') ?? 'simulated';
  const email = str(env, 'EMAIL_PROVIDER') ?? 'simulated';
  if (sms !== 'simulated' && sms !== 'twilio') throw new Error(`SMS_PROVIDER must be "simulated" or "twilio" (got "${sms}")`);
  if (email !== 'simulated' && email !== 'resend') throw new Error(`EMAIL_PROVIDER must be "simulated" or "resend" (got "${email}")`);

  return {
    port: num(env, 'PORT', 4100),
    databasePath: str(env, 'DATABASE_PATH') ?? './data/demo.db',
    defaultTenant: str(env, 'DEFAULT_TENANT') ?? 'kestrel-ridge',
    // Render and Railway expose the public URL automatically.
    publicBaseUrl:
      (str(env, 'PUBLIC_BASE_URL') ??
        str(env, 'RENDER_EXTERNAL_URL') ??
        (str(env, 'RAILWAY_PUBLIC_DOMAIN') ? `https://${str(env, 'RAILWAY_PUBLIC_DOMAIN')}` : null))?.replace(/\/+$/, '') ?? null,
    demoPassword,
    sessionSecret:
      str(env, 'SESSION_SECRET') ??
      createHash('sha256').update(`session:${demoPassword ?? 'open-demo'}`).digest('hex'),
    smsProvider: sms,
    emailProvider: email,
    liveAllowlist: (str(env, 'LIVE_ALLOWLIST') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map(normalizeAddress),
    liveAllowAll: bool(env, 'LIVE_ALLOW_ALL', false),
    simulatedDelayMs: num(env, 'SIMULATED_DELIVERY_DELAY_MS', 1200),
    sendHoldSeconds: Math.max(0, num(env, 'SEND_HOLD_SECONDS', 60)),
    smsCostPerSegment: num(env, 'SMS_COST_PER_SEGMENT', 0.011),
    schedulerEnabled: bool(env, 'SCHEDULER_ENABLED', true),
    twilio: {
      accountSid: str(env, 'TWILIO_ACCOUNT_SID'),
      authToken: str(env, 'TWILIO_AUTH_TOKEN'),
      fromNumber: str(env, 'TWILIO_FROM_NUMBER'),
      messagingServiceSid: str(env, 'TWILIO_MESSAGING_SERVICE_SID'),
    },
    resend: {
      apiKey: str(env, 'RESEND_API_KEY'),
      from: str(env, 'RESEND_FROM_EMAIL'),
      replyTo: str(env, 'RESEND_REPLY_TO'),
      webhookSecret: str(env, 'RESEND_WEBHOOK_SECRET'),
    },
  };
}
