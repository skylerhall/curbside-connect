import { CheckCircle2, Mail, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Toggle } from '../components/ui.tsx';

interface PublicPrefs {
  tenant: { name: string; logoInitials: string; brandPrimary: string; brandDark: string; brandAccent: string; supportPhone: string; website: string };
  customer: { firstName: string; serviceAddress: string; phone: string | null; email: string | null; smsOptIn: boolean; emailOptIn: boolean; notifyPickup: boolean; notifyService: boolean; notifyBilling: boolean };
}

type Prefs = Pick<PublicPrefs['customer'], 'smsOptIn' | 'emailOptIn' | 'notifyPickup' | 'notifyService' | 'notifyBilling'>;

/** Customer-facing page reached from the link in each email. No login. */
export function PreferencePage({ token }: { token: string }) {
  const [data, setData] = useState<PublicPrefs | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/public/preferences/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'This link is not valid.');
        setData(body);
        const c = body.customer;
        setPrefs({ smsOptIn: c.smsOptIn, emailOptIn: c.emailOptIn, notifyPickup: c.notifyPickup, notifyService: c.notifyService, notifyBilling: c.notifyBilling });
        const root = document.documentElement.style;
        root.setProperty('--brand', body.tenant.brandPrimary);
        root.setProperty('--brand-dark', body.tenant.brandDark);
        root.setProperty('--brand-accent', body.tenant.brandAccent);
        document.title = `Notification preferences · ${body.tenant.name}`;
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const save = async (next: Prefs) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/public/preferences/${encodeURIComponent(token)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      if (!r.ok) throw new Error((await r.json()).error);
      setPrefs(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <Shell>{<p className="text-center text-sm text-muted">{error}</p>}</Shell>;
  if (!data || !prefs) return <Shell>{<p className="text-center text-sm text-muted">Loading…</p>}</Shell>;
  const { tenant, customer } = data;
  const update = (patch: Partial<Prefs>) => {
    setSaved(false);
    setPrefs({ ...prefs, ...patch });
  };

  return (
    <Shell tenant={tenant}>
      <h1 className="text-xl font-bold">Hi {customer.firstName}, how should we reach you?</h1>
      <p className="mt-1 text-sm text-muted">Notifications for {customer.serviceAddress}. Change these any time.</p>

      <div className="mt-6 space-y-3">
        <Section title="Channels">
          <Row icon={<MessageSquare size={16} />} label="Text messages" hint={customer.phone ?? 'No mobile number on file'} checked={prefs.smsOptIn} disabled={!customer.phone} onChange={(v) => update({ smsOptIn: v })} />
          <Row icon={<Mail size={16} />} label="Email" hint={customer.email ?? 'No email on file'} checked={prefs.emailOptIn} disabled={!customer.email} onChange={(v) => update({ emailOptIn: v })} />
        </Section>
        <Section title="What you’d like to hear about">
          <Row label="Pickup reminders" hint="The evening before collection" checked={prefs.notifyPickup} onChange={(v) => update({ notifyPickup: v })} />
          <Row label="Schedule changes & service alerts" hint="Holidays, weather delays, route changes" checked={prefs.notifyService} onChange={(v) => update({ notifyService: v })} />
          <Row label="Billing reminders" hint="Upcoming bills and autopay notices" checked={prefs.notifyBilling} onChange={(v) => update({ notifyBilling: v })} />
        </Section>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Button variant="primary" size="lg" loading={saving} onClick={() => save(prefs)}>
          Save preferences
        </Button>
        <button className="py-2 text-sm text-muted underline-offset-2 hover:underline" onClick={() => save({ smsOptIn: false, emailOptIn: false, notifyPickup: false, notifyService: false, notifyBilling: false })}>
          Unsubscribe from everything
        </button>
      </div>
      {saved && (
        <div className="animate-rise mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={16} /> Saved. Thanks, {customer.firstName}!
        </div>
      )}
      <p className="mt-6 text-center text-xs text-faint">
        Questions? Call {tenant.supportPhone} · {tenant.website}
      </p>
    </Shell>
  );
}

function Shell({ tenant, children }: { tenant?: PublicPrefs['tenant']; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-brand-dark px-4 py-4 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          {tenant && <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-xs font-black text-brand-dark">{tenant.logoInitials}</div>}
          <div className="font-semibold">{tenant?.name ?? 'Notification preferences'}</div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">{children}</div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{title}</div>
      <div className="divide-y divide-line rounded-xl border border-line">{children}</div>
    </div>
  );
}

function Row({ icon, label, hint, checked, disabled, onChange }: { icon?: React.ReactNode; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-start gap-3">
        {icon && <span className="mt-0.5 text-muted">{icon}</span>}
        <div>
          <div className="text-sm font-medium">{label}</div>
          {hint && <div className="text-xs text-faint">{hint}</div>}
        </div>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}
