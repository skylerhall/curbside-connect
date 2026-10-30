import { MailCheck, MessageSquareOff, Search, ShieldCheck, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConsentEvent, Customer } from '../../../shared/types.ts';
import { CustomerDrawer } from './Customers.tsx';
import { Badge, Card, PageHeader, Spinner, Stat, Toggle, cx, inputClass, useToast } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { pct, when } from '../lib/format.ts';

type PrefKey = 'smsOptIn' | 'emailOptIn' | 'notifyPickup' | 'notifyService' | 'notifyBilling';
const COLUMNS: { key: PrefKey; label: string }[] = [
  { key: 'smsOptIn', label: 'SMS' },
  { key: 'emailOptIn', label: 'Email' },
  { key: 'notifyPickup', label: 'Pickup' },
  { key: 'notifyService', label: 'Service' },
  { key: 'notifyBilling', label: 'Billing' },
];

export function PreferencesPage() {
  const { tenant } = useApp();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const customers = useApi<Customer[]>(`/customers${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`);
  const all = useApi<Customer[]>('/customers');
  const events = useApi<ConsentEvent[]>('/consent-events');

  const set = async (c: Customer, key: PrefKey, value: boolean) => {
    try {
      await api(`/customers/${c.id}/preferences`, { method: 'PATCH', body: { [key]: value } });
      void customers.reload();
      void all.reload();
      void events.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const list = all.data ?? [];
  const sms = list.filter((c) => c.smsOptIn && c.phone).length;
  const email = list.filter((c) => c.emailOptIn && c.email).length;
  const none = list.filter((c) => !(c.smsOptIn && c.phone) && !(c.emailOptIn && c.email)).length;
  const stops = (events.data ?? []).filter((e) => e.change.includes('SMS off')).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consent & preferences"
        subtitle="Nobody gets a text or email without opting in. Customers choose their channels and topics, STOP replies are honoured instantly, and every change is recorded with its source."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="SMS opted in" value={pct(sms, list.length)} icon={ShieldCheck} note={`${sms} of ${list.length} customers`} />
        <Stat label="Email opted in" value={pct(email, list.length)} icon={MailCheck} tone="blue" note={`${email} of ${list.length} customers`} />
        <Stat label="Not reachable" value={none} icon={UserX} tone="amber" note="No consented channel; a good target for an opt-in campaign" />
        <Stat label="Recent SMS opt-outs" value={stops} icon={MessageSquareOff} tone="red" note="STOP replies and preference changes" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card bodyClassName="p-0">
          <div className="border-b border-line p-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className={cx(inputClass, 'pl-9')} placeholder="Find a customer" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {!customers.data ? (
            <Spinner />
          ) : (
            <div className="scrollbar-thin max-h-[620px] overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-5 py-3">Customer</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="px-2 py-3 text-center">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.data.map((c) => (
                    <tr key={c.id} className="border-t border-line/70">
                      <td className="px-5 py-2.5">
                        <button onClick={() => setOpen(c.id)} className="text-left font-medium hover:text-brand">
                          {c.firstName} {c.lastName}
                        </button>
                        <div className="text-xs text-faint">{c.consentSource}</div>
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="px-2 py-2.5 text-center">
                          <Toggle small checked={c[col.key]} disabled={(col.key === 'smsOptIn' && !c.phone) || (col.key === 'emailOptIn' && !c.email)} onChange={(v) => set(c, col.key, v)} label={`${col.label} for ${c.firstName}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="How opt-out works">
            <ul className="space-y-3 text-sm leading-relaxed text-muted">
              <li>
                <Badge tone="purple">STOP</Badge> Replying STOP, UNSUBSCRIBE, CANCEL, END or QUIT turns off texts immediately and logs it. START turns them back on.
              </li>
              <li>
                <Badge tone="blue">Email</Badge> Every email carries a personal link where customers pick channels and topics, with no login needed.
              </li>
              <li>
                <Badge tone="red">Emergency</Badge> Emergency alerts can override topic choices but never send on a channel without consent.
              </li>
            </ul>
          </Card>
          <Card title="Consent activity" bodyClassName="p-0">
            {!events.data ? (
              <Spinner />
            ) : events.data.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No changes yet.</p>
            ) : (
              <ul className="scrollbar-thin max-h-96 divide-y divide-line overflow-y-auto">
                {events.data.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <button className="font-medium hover:text-brand" onClick={() => setOpen(e.customerId)}>
                        {e.customerName}
                      </button>
                      <span className="text-xs text-faint">{when(e.at, tenant.timezone)}</span>
                    </div>
                    <div className="text-muted">
                      {e.change} <span className="text-faint">· {e.source}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <CustomerDrawer
        id={open}
        onClose={() => setOpen(null)}
        onChanged={() => {
          void customers.reload();
          void all.reload();
          void events.reload();
        }}
      />
    </div>
  );
}
