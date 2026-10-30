import { Copy, ExternalLink, MessageSquareReply, Plus, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConsentEvent, Customer, Message, Route } from '../../../shared/types.ts';
import { MessageDrawer } from './Activity.tsx';
import { Badge, Button, Card, ChannelBadge, ConsentDots, Drawer, EmptyState, Field, Modal, PageHeader, Spinner, StatusPill, Toggle, cx, inputClass, useToast } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { WEEKDAYS, money, shortDate, when } from '../lib/format.ts';
import { useLocation } from '../lib/router.ts';

export function CustomersPage() {
  const { routes } = useApp();
  const { query } = useLocation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [routeId, setRouteId] = useState(query.get('route') ?? '');
  const [consent, setConsent] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams();
  if (debounced) params.set('search', debounced);
  if (routeId) params.set('routeId', routeId);
  if (consent) params.set('consent', consent);
  const q = useApi<Customer[]>(`/customers?${params}`);
  const routeName = (id: string) => routes.find((r) => r.id === id)?.name ?? '';

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Fictional demo accounts on five routes. In production these sync nightly from the billing and routing system."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
            Add demo contact
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className={cx(inputClass, 'pl-9')} placeholder="Search name, address, account, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={cx(inputClass, 'md:w-56')} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({WEEKDAYS[r.serviceDay].slice(0, 3)})
              </option>
            ))}
          </select>
          <select className={cx(inputClass, 'md:w-48')} value={consent} onChange={(e) => setConsent(e.target.value)}>
            <option value="">Any consent</option>
            <option value="sms">SMS opted in</option>
            <option value="email">Email opted in</option>
            <option value="none">Not reachable</option>
          </select>
        </div>
        {!q.data ? (
          <Spinner />
        ) : q.data.length === 0 ? (
          <EmptyState icon={Users} title="No customers match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-2 py-3">Route</th>
                  <th className="px-2 py-3">Service address</th>
                  <th className="px-2 py-3">Contact</th>
                  <th className="px-2 py-3">Consent</th>
                  <th className="px-5 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer border-t border-line/70 hover:bg-soft/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 font-semibold">
                        {c.firstName} {c.lastName}
                        {c.isDemoContact && <Badge tone="purple">Demo contact</Badge>}
                      </div>
                      <div className="text-xs text-faint">{c.accountNumber}</div>
                    </td>
                    <td className="px-2 py-3">
                      <Badge tone="brand">{routeName(c.routeId)}</Badge>
                      {c.nextRouteId && <div className="mt-1 text-xs text-amber-700">→ {routeName(c.nextRouteId)} {c.nextRouteEffective && shortDate(c.nextRouteEffective)}</div>}
                    </td>
                    <td className="px-2 py-3 text-muted">
                      {c.serviceAddress}
                      <div className="text-xs text-faint">
                        {c.city}, {c.state} {c.zip}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-muted">
                      <div>{c.phone ?? <span className="text-faint">No phone</span>}</div>
                      <div className="text-xs text-faint">{c.email ?? 'No email'}</div>
                    </td>
                    <td className="px-2 py-3">
                      <ConsentDots sms={c.smsOptIn} email={c.emailOptIn} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className={cx('font-medium', c.pastDueCents > 0 && 'text-red-700')}>{money(c.monthlyRateCents + c.pastDueCents)}</div>
                      <div className="text-xs text-faint">{c.autopay ? 'Autopay' : c.pastDueCents > 0 ? `${money(c.pastDueCents)} past due` : 'Manual pay'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line px-5 py-3 text-sm text-muted">{q.data.length} customers</div>
          </div>
        )}
      </Card>
      <CustomerDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void q.reload()} />
      <AddCustomerModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          setAdding(false);
          void q.reload();
          setOpen(c.id);
        }}
      />
    </div>
  );
}

interface CustomerDetail {
  customer: Customer;
  route: Route | null;
  nextRoute: Route | null;
  nextPickup: { serviceDate: string; originalDate: string; override: { reason: string; holidayName: string | null } | null } | null;
  preferencesUrl: string;
  messages: Message[];
  consentEvents: ConsentEvent[];
}

export function CustomerDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged?: () => void }) {
  const { tenant } = useApp();
  const toast = useToast();
  const q = useApi<CustomerDetail>(id ? `/customers/${id}` : null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const d = q.data && q.data.customer.id === id ? q.data : null;

  const setPref = async (patch: Partial<Customer>) => {
    if (!d) return;
    try {
      await api(`/customers/${d.customer.id}/preferences`, { method: 'PATCH', body: patch });
      void q.reload();
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const reply = async (body: string) => {
    if (!d) return;
    const res = await api<{ action: string; reply: string | null }>(`/customers/${d.customer.id}/simulate-reply`, { body: { body } });
    toast(res.reply ? `Auto-reply: “${res.reply}”` : 'No keyword recognised, so nothing changed.', res.action === 'none' ? 'info' : 'success');
    void q.reload();
    onChanged?.();
  };

  return (
    <Drawer open={!!id} onClose={onClose} title={d ? `${d.customer.firstName} ${d.customer.lastName}` : 'Customer'} subtitle={d ? `${d.customer.accountNumber} · ${d.customer.serviceAddress}, ${d.customer.city}` : undefined}>
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Route" value={d.route ? `${d.route.name} · ${WEEKDAYS[d.route.serviceDay]}` : '-'} />
            <Info
              label="Next pickup"
              value={d.nextPickup ? `${shortDate(d.nextPickup.serviceDate)}${d.nextPickup.override ? ` (moved: ${d.nextPickup.override.holidayName ?? d.nextPickup.override.reason})` : ''}` : '-'}
            />
            <Info label="Mobile" value={d.customer.phone ?? 'None on file'} />
            <Info label="Email" value={d.customer.email ?? 'None on file'} />
            <Info label="Service" value={d.customer.serviceLevel} />
            <Info label="Billing" value={`${money(d.customer.monthlyRateCents)}/mo · ${d.customer.autopay ? 'autopay' : 'manual'}${d.customer.pastDueCents ? ` · ${money(d.customer.pastDueCents)} past due` : ''}`} />
          </div>
          {d.nextRoute && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Moving to {d.nextRoute.name} ({WEEKDAYS[d.nextRoute.serviceDay]}) on {d.customer.nextRouteEffective && shortDate(d.customer.nextRouteEffective)}.
            </div>
          )}

          <section>
            <h4 className="mb-3 text-sm font-semibold">Notification preferences</h4>
            <div className="divide-y divide-line rounded-xl border border-line">
              <PrefRow label="Text messages" hint={d.customer.phone ? undefined : 'No mobile number'} checked={d.customer.smsOptIn} disabled={!d.customer.phone} onChange={(v) => setPref({ smsOptIn: v })} />
              <PrefRow label="Email" hint={d.customer.email ? undefined : 'No email address'} checked={d.customer.emailOptIn} disabled={!d.customer.email} onChange={(v) => setPref({ emailOptIn: v })} />
              <PrefRow label="Pickup reminders" checked={d.customer.notifyPickup} onChange={(v) => setPref({ notifyPickup: v })} />
              <PrefRow label="Service alerts & schedule changes" checked={d.customer.notifyService} onChange={(v) => setPref({ notifyService: v })} />
              <PrefRow label="Billing reminders" checked={d.customer.notifyBilling} onChange={(v) => setPref({ notifyBilling: v })} />
            </div>
            <div className="mt-2 text-xs text-faint">
              Consent source: {d.customer.consentSource} · updated {when(d.customer.consentUpdatedAt, tenant.timezone)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={Copy}
                onClick={async () => {
                  await navigator.clipboard?.writeText(d.preferencesUrl);
                  toast('Preference link copied');
                }}
              >
                Copy preference link
              </Button>
              <Button size="sm" icon={ExternalLink} onClick={() => window.open(d.preferencesUrl.replace(/^https?:\/\/[^/]+/, window.location.origin), '_blank')}>
                Open customer view
              </Button>
            </div>
          </section>

          {d.customer.phone && (
            <section>
              <h4 className="mb-1 text-sm font-semibold">Simulate a text reply</h4>
              <p className="mb-3 text-xs text-muted">What happens when this customer texts back. With Twilio connected, real replies arrive through the inbound webhook.</p>
              <div className="flex flex-wrap gap-2">
                {['STOP', 'START', 'HELP'].map((w) => (
                  <Button key={w} size="sm" icon={MessageSquareReply} onClick={() => reply(w)}>
                    {w}
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="mb-3 text-sm font-semibold">Message history</h4>
            {d.messages.length === 0 ? (
              <p className="text-sm text-muted">No messages yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {d.messages.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => setMessageId(m.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft/60">
                      <ChannelBadge channel={m.channel} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{m.campaignTitle}</div>
                        <div className="text-xs text-faint">{when(m.createdAt, tenant.timezone)}</div>
                      </div>
                      <StatusPill status={m.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-3 text-sm font-semibold">Consent history</h4>
            {d.consentEvents.length === 0 ? (
              <p className="text-sm text-muted">Consent recorded at sign-up ({d.customer.consentSource}).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.consentEvents.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>
                      <span className="font-medium">{e.change}</span> <span className="text-muted">via {e.source}</span>
                    </span>
                    <span className="shrink-0 text-xs text-faint">{when(e.at, tenant.timezone)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <MessageDrawer id={messageId} onClose={() => setMessageId(null)} />
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-soft/70 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function PrefRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

function AddCustomerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Customer) => void }) {
  const { routes, providers } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', routeId: routes.find((r) => r.serviceDay === 4)?.id ?? routes[0]?.id ?? '', smsOptIn: true, emailOptIn: true });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const c = await api<Customer>('/customers', { body: form });
      toast(`${c.firstName} added to ${routes.find((r) => r.id === c.routeId)?.name}`);
      onCreated(c);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a demo contact"
      subtitle="Add yourself (or someone in the meeting) to a route, then trigger a schedule change and watch the message arrive."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Plus} loading={saving} onClick={save}>
            Add contact
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <input className={inputClass} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Field>
        <Field label="Last name">
          <input className={inputClass} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Field>
        <Field label="Mobile number">
          <input className={inputClass} inputMode="tel" placeholder="(970) 555-0123" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Route" className="sm:col-span-2">
          <select className={inputClass} value={form.routeId} onChange={(e) => set({ routeId: e.target.value })}>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({WEEKDAYS[r.serviceDay]})
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={form.smsOptIn} onChange={(e) => set({ smsOptIn: e.target.checked })} />
          <span>This person agreed to receive text messages</span>
        </label>
        <label className="-mt-2 flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={form.emailOptIn} onChange={(e) => set({ emailOptIn: e.target.checked })} />
          <span>This person agreed to receive emails</span>
        </label>
      </div>
      <div className={cx('mt-5 rounded-xl px-4 py-3 text-xs leading-relaxed', providers.sms.live ? 'bg-emerald-50 text-emerald-900' : 'bg-soft text-muted')}>
        {providers.sms.live
          ? 'Live SMS is on. This number gets a real text only if it is on LIVE_ALLOWLIST; otherwise it is simulated like everyone else.'
          : 'Simulation mode: messages to this contact are recorded but not delivered. To receive a real text, set SMS_PROVIDER=twilio and add the number to LIVE_ALLOWLIST (see README).'}
      </div>
    </Modal>
  );
}
