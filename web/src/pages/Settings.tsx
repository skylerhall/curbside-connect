import { Building2, Database, Mail, MessageSquare, Palette, PlugZap, RefreshCw, Save } from 'lucide-react';
import { useState } from 'react';
import type { Tenant } from '../../../shared/types.ts';
import { Badge, Button, Card, Field, PageHeader, cx, inputClass, useToast } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';

export function SettingsPage() {
  const app = useApp();
  const { tenant, providers, tenants } = app;
  const toast = useToast();
  const [form, setForm] = useState<Tenant>(tenant);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const set = (patch: Partial<Tenant>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(tenant);

  const save = async () => {
    setSaving(true);
    try {
      await api('/tenant', { method: 'PATCH', body: form });
      await app.reload();
      toast('Company profile saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset all demo data? Customers, messages, templates and schedule changes go back to the original fictional set.')) return;
    setResetting(true);
    try {
      await api('/demo/reset', { body: {} });
      toast('Demo data reset');
      setTimeout(() => window.location.assign('/'), 400);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setResetting(false);
    }
  };

  const preview = (patch: Partial<Tenant>) => {
    set(patch);
    const root = document.documentElement.style;
    if (patch.brandPrimary) root.setProperty('--brand', patch.brandPrimary);
    if (patch.brandDark) root.setProperty('--brand-dark', patch.brandDark);
    if (patch.brandAccent) root.setProperty('--brand-accent', patch.brandAccent);
  };

  const base = window.location.origin;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Company profile, branding and delivery providers. Each hauler on the platform has its own copy of everything here."
        actions={
          <Button variant="primary" icon={Save} disabled={!dirty} loading={saving} onClick={save}>
            Save changes
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Company profile" subtitle="Used in every message." icon={Building2}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Short name">
              <input className={inputClass} value={form.shortName} onChange={(e) => set({ shortName: e.target.value })} />
            </Field>
            <Field label="Customer service phone">
              <input className={inputClass} value={form.supportPhone} onChange={(e) => set({ supportPhone: e.target.value })} />
            </Field>
            <Field label="Cart-out time">
              <input className={inputClass} value={form.cartOutTime} onChange={(e) => set({ cartOutTime: e.target.value })} />
            </Field>
            <Field label="Website">
              <input className={inputClass} value={form.website} onChange={(e) => set({ website: e.target.value })} />
            </Field>
            <Field label="Bill-pay link">
              <input className={inputClass} value={form.portalUrl} onChange={(e) => set({ portalUrl: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Branding" subtitle="The dashboard, emails and the customer preference page all use these." icon={Palette}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary" value={form.brandPrimary} onChange={(v) => preview({ brandPrimary: v })} />
            <ColorField label="Sidebar / header" value={form.brandDark} onChange={(v) => preview({ brandDark: v })} />
            <ColorField label="Accent" value={form.brandAccent} onChange={(v) => preview({ brandAccent: v })} />
            <Field label="Logo initials">
              <input className={inputClass} maxLength={3} value={form.logoInitials} onChange={(e) => set({ logoInitials: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-brand-dark px-4 py-3 text-white">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-xs font-black text-brand-dark">{form.logoInitials}</div>
            <div className="font-semibold">{form.name}</div>
            <span className="ml-auto rounded-lg bg-brand px-3 py-1 text-xs font-semibold">Button</span>
          </div>
        </Card>
      </div>

      <Card title="Delivery providers" subtitle="Configured with environment variables on the server. Credentials never appear in the dashboard." icon={PlugZap}>
        <div className="grid gap-4 md:grid-cols-2">
          <ProviderTile icon={MessageSquare} title="Text messages" status={providers.sms} />
          <ProviderTile icon={Mail} title="Email" status={providers.email} />
        </div>
        {(providers.sms.live || providers.email.live) && (
          <div className="mt-4 rounded-xl border border-line px-4 py-3 text-sm">
            <span className="font-semibold">Live allowlist:</span>{' '}
            {providers.allowAll ? 'all consented customers (LIVE_ALLOW_ALL=true)' : providers.allowlist.length ? providers.allowlist.join(', ') : 'empty, so nobody receives real messages yet'}
          </div>
        )}
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
          <Step n={1} title="Twilio (SMS)">
            Set <code>SMS_PROVIDER=twilio</code>, <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and a sending number. US texting needs toll-free verification or A2P 10DLC registration.
          </Step>
          <Step n={2} title="Resend (email)">
            Set <code>EMAIL_PROVIDER=resend</code>, <code>RESEND_API_KEY</code> and <code>RESEND_FROM_EMAIL</code> on a domain you’ve verified (SPF/DKIM).
          </Step>
          <Step n={3} title="Allowlist">
            Put your own phone/email in <code>LIVE_ALLOWLIST</code>. Only those get real messages; fictional customers stay simulated.
          </Step>
        </div>
        <div className="mt-5 rounded-xl bg-soft/70 px-4 py-3 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
          <div className="mb-1 font-semibold text-ink">Webhook URLs (set PUBLIC_BASE_URL when hosted)</div>
          Twilio status callback: <code>{base}/api/webhooks/twilio/status</code>
          <br />
          Twilio incoming messages: <code>{base}/api/webhooks/twilio/inbound</code>
          <br />
          Resend events: <code>{base}/api/webhooks/resend</code>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Demo data" subtitle="Everything here is fictional: 555-01xx phone numbers and example.com emails." icon={Database}>
          <p className="mb-4 text-sm text-muted">Reset before each pitch to start from a clean, realistic two-week history.</p>
          <Button variant="danger" icon={RefreshCw} loading={resetting} onClick={reset}>
            Reset demo data
          </Button>
        </Card>
        <Card title="Platform" subtitle="One deployment can serve many haulers, each with isolated data and branding." icon={Building2}>
          <ul className="space-y-2 text-sm">
            {tenants.map((t) => (
              <li key={t.slug} className="flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                {t.slug === tenant.slug ? <Badge tone="green">Current</Badge> : <a className="text-sm font-semibold text-brand" href={`/?tenant=${t.slug}`}>Switch</a>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="color" className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1" value={value} onChange={(e) => onChange(e.target.value)} />
        <input className={inputClass} value={value} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function ProviderTile({ icon: Icon, title, status }: { icon: typeof Mail; title: string; status: { provider: string; live: boolean; configured: boolean; detail: string } }) {
  return (
    <div className={cx('rounded-xl border px-4 py-4', status.live ? 'border-emerald-200 bg-emerald-50/60' : status.configured ? 'border-line' : 'border-amber-200 bg-amber-50/60')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Icon size={16} /> {title}
        </div>
        <Badge tone={status.live ? 'green' : status.configured ? 'gray' : 'amber'}>{status.live ? `Live · ${status.provider}` : 'Simulated'}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted">{status.detail}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-1.5 flex items-center gap-2 font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-xs text-white">{n}</span>
        {title}
      </div>
      <p className="text-xs leading-relaxed text-muted [&_code]:rounded [&_code]:bg-soft [&_code]:px-1">{children}</p>
    </div>
  );
}
