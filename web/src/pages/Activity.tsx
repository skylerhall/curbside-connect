import { Activity as ActivityIcon, ClipboardList, Search, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuditEntry, Campaign, Message, MessageEvent } from '../../../shared/types.ts';
import { CampaignProgress } from '../components/NotifyFlow.tsx';
import { EmailPreview, SmsBubble } from '../components/previews.tsx';
import { Badge, Button, Card, ChannelBadge, Drawer, EmptyState, PageHeader, Spinner, StatusPill, Tabs, cx, inputClass } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { plural, when } from '../lib/format.ts';
import { navigate, useLocation } from '../lib/router.ts';

const KIND_LABEL: Record<string, string> = {
  pickup_reminder: 'Pickup reminder',
  schedule_change: 'Schedule change',
  route_change: 'Pickup-day change',
  billing_reminder: 'Billing',
  alert: 'Alert',
  correction: 'Correction',
};

export function ActivityPage() {
  const { query } = useLocation();
  const [tab, setTab] = useState<'messages' | 'campaigns' | 'audit'>(query.get('campaign') ? 'campaigns' : 'messages');
  const [campaignId, setCampaignId] = useState<string | null>(query.get('campaign'));
  const campaigns = useApi<Campaign[]>(tab === 'campaigns' ? '/campaigns?limit=100' : null);

  useEffect(() => setCampaignId(query.get('campaign')), [query]);

  return (
    <div>
      <PageHeader title="Delivery log" subtitle="Every message attempt with its status history, every customer who wasn’t contacted and why, and every change made in the dashboard." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'messages', label: 'Messages' },
          { value: 'campaigns', label: 'Notifications sent' },
          { value: 'audit', label: 'Audit trail' },
        ]}
      />
      {tab === 'messages' && <MessageLog />}
      {tab === 'campaigns' && (
        <Card bodyClassName="p-0">
          <CampaignList campaigns={campaigns.data} onOpen={(id) => setCampaignId(id)} />
        </Card>
      )}
      {tab === 'audit' && <AuditLog />}

      <Drawer
        open={!!campaignId}
        onClose={() => {
          setCampaignId(null);
          if (query.get('campaign')) navigate('/activity');
        }}
        title="Notification details"
        wide
      >
        {campaignId && <CampaignProgress campaignId={campaignId} />}
      </Drawer>
    </div>
  );
}

export function CampaignList({ campaigns, onOpen }: { campaigns: Campaign[] | null; onOpen?: (id: string) => void }) {
  const { tenant } = useApp();
  if (!campaigns) return <Spinner />;
  if (!campaigns.length) return <EmptyState icon={Send} title="Nothing sent yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-faint">
          <tr>
            <th className="px-5 py-3">Notification</th>
            <th className="px-2 py-3">Sent</th>
            <th className="px-2 py-3">Reached</th>
            <th className="px-2 py-3">Delivery</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const total = c.counts.messages || 1;
            return (
              <tr key={c.id} onClick={() => (onOpen ? onOpen(c.id) : navigate(`/activity?campaign=${c.id}`))} className="cursor-pointer border-t border-line/70 hover:bg-soft/50">
                <td className="px-5 py-3">
                  <div className="font-medium">{c.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <Badge tone={c.kind === 'correction' ? 'purple' : 'gray'}>{KIND_LABEL[c.kind]}</Badge>
                    {c.status === 'held' && <Badge tone="amber">Sending soon</Badge>}
                    {c.status === 'cancelled' && <Badge>Cancelled, never sent</Badge>}
                    {c.trigger === 'automation' ? 'Automatic' : c.createdBy}
                  </div>
                </td>
                <td className="px-2 py-3 text-muted">{when(c.createdAt, tenant.timezone)}</td>
                <td className="px-2 py-3">
                  {plural(c.counts.recipients - c.counts.skipped, 'customer')}
                  {c.counts.skipped > 0 && <div className="text-xs text-amber-700">{c.counts.skipped} not reached</div>}
                </td>
                <td className="w-56 px-2 py-3 pr-5">
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-emerald-500" style={{ width: `${(c.counts.delivered / total) * 100}%` }} />
                    <div className="bg-sky-400" style={{ width: `${((c.counts.sent + c.counts.queued) / total) * 100}%` }} />
                    <div className="bg-red-500" style={{ width: `${(c.counts.failed / total) * 100}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {c.counts.delivered}/{c.counts.messages} delivered{c.counts.failed ? ` · ${c.counts.failed} failed` : ''}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MessageLog() {
  const { tenant } = useApp();
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set('status', status);
  if (channel) params.set('channel', channel);
  if (kind) params.set('kind', kind);
  if (debounced) params.set('search', debounced);
  const q = useApi<{ items: Message[]; total: number }>(`/messages?${params}`, { pollMs: 5000 });

  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={cx(inputClass, 'pl-9')} placeholder="Search customer, phone, email or message text" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={cx(inputClass, 'w-auto')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="delivered">Delivered</option>
            <option value="sent">Sent</option>
            <option value="queued">Queued</option>
            <option value="failed">Failed</option>
            <option value="skipped">Not sent</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className={cx(inputClass, 'w-auto')} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">SMS + email</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <select className={cx(inputClass, 'w-auto')} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!q.data ? (
        <Spinner />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No messages match" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-2 py-3">Channel</th>
                  <th className="px-2 py-3">Message</th>
                  <th className="px-2 py-3">Time</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((m) => (
                  <tr key={m.id} onClick={() => setOpen(m.id)} className="cursor-pointer border-t border-line/70 hover:bg-soft/50">
                    <td className="px-5 py-3">
                      <div className="font-medium">{m.customerName}</div>
                      <div className="text-xs text-faint">{m.routeName}</div>
                    </td>
                    <td className="px-2 py-3">
                      <ChannelBadge channel={m.channel} />
                    </td>
                    <td className="max-w-md px-2 py-3">
                      <div className="truncate text-muted">{m.status === 'skipped' ? <span className="text-amber-700">{m.error}</span> : (m.subject ?? m.body)}</div>
                      <div className="truncate text-xs text-faint">{m.campaignTitle}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-muted">{when(m.createdAt, tenant.timezone)}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
            <span>
              Showing {q.data.items.length} of {q.data.total.toLocaleString()}
            </span>
            {q.data.items.length < q.data.total && (
              <Button size="sm" onClick={() => setLimit((n) => n + 50)}>
                Load more
              </Button>
            )}
          </div>
        </>
      )}
      <MessageDrawer id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

export function MessageDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tenant } = useApp();
  const q = useApi<Message & { events: MessageEvent[] }>(id ? `/messages/${id}` : null);
  const m = q.data && q.data.id === id ? q.data : null;
  return (
    <Drawer open={!!id} onClose={onClose} title={m ? m.customerName : 'Message'} subtitle={m?.campaignTitle}>
      {!m ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={m.status} />
            <ChannelBadge channel={m.channel} />
            <Badge>{m.provider === 'simulated' ? 'Simulated provider' : (m.provider ?? 'Not sent')}</Badge>
            {m.toAddress && <span className="text-sm text-muted">to {m.toAddress}</span>}
          </div>
          {m.error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{m.error}</div>}
          {m.body && (m.channel === 'sms' ? <SmsBubble body={m.body} /> : <EmailPreview subject={m.subject} body={m.body} />)}
          <div>
            <h4 className="mb-3 text-sm font-semibold">Status history</h4>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {m.events.map((e, i) => (
                <li key={i}>
                  <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', e.status === 'delivered' ? 'bg-emerald-500' : e.status === 'failed' ? 'bg-red-500' : e.status === 'skipped' ? 'bg-amber-500' : e.status === 'cancelled' ? 'bg-slate-400' : 'bg-sky-400')} />
                  <div className="text-sm font-medium capitalize">{e.status === 'skipped' ? 'Not sent' : e.status}</div>
                  <div className="text-xs text-muted">
                    {new Date(e.at).toLocaleString('en-US', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'medium' })}
                    {e.detail && ` · ${e.detail}`}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {m.providerMessageId && (
            <div className="text-xs text-faint">
              Provider message ID: <code>{m.providerMessageId}</code>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function AuditLog() {
  const { tenant } = useApp();
  const q = useApi<AuditEntry[]>('/audit');
  if (!q.data) return <Spinner />;
  return (
    <Card bodyClassName="p-0">
      {q.data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No activity yet" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-36 shrink-0 text-xs text-faint">{when(a.at, tenant.timezone)}</span>
              <span className="w-36 shrink-0 text-xs font-semibold text-muted">{a.actor === 'automation' ? 'Automation' : a.actor}</span>
              <span className="text-sm">{a.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
