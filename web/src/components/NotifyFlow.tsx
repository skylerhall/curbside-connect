import { AlertTriangle, Ban, CheckCircle2, ChevronDown, ExternalLink, Mail, MessageSquare, RotateCw, Send, Timer, Undo2, UserX, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Campaign, Message, NotificationRequest, Plan } from '../../../shared/types.ts';
import { api, useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { pct, plural } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { CorrectionModal } from './CorrectionModal.tsx';
import { EmailPreview, SmsBubble } from './previews.tsx';
import { Badge, Button, ChannelBadge, ErrorNote, StatusPill, cx, useToast } from './ui.tsx';

/**
 * The core workflow UI: shows exactly who a notification will reach (and who
 * it won't, and why), previews the rendered messages, sends, then tracks
 * delivery live.
 */
export function NotifyFlow({
  request,
  disabledReason,
  sendLabel,
  onSent,
  emptyText = 'Nobody matches this notification.',
}: {
  request: NotificationRequest | null;
  disabledReason?: string | null;
  sendLabel?: string;
  onSent?: (campaign: Campaign) => void;
  emptyText?: string;
}) {
  const { providers } = useApp();
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const key = request ? JSON.stringify(request) : null;
  const seq = useRef(0);

  useEffect(() => {
    setCampaignId(null);
    if (!key || disabledReason) {
      setPlan(null);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const p = await api<Plan>('/notifications/preview', { body: { request: JSON.parse(key) } });
        if (mine === seq.current) {
          setPlan(p);
          setError(null);
        }
      } catch (err) {
        if (mine === seq.current) {
          setPlan(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [key, disabledReason]);

  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [plan]);

  const send = async () => {
    if (!request) return;
    setSending(true);
    try {
      const res = await api<{ campaign: Campaign }>('/notifications/send', { body: { request } });
      setCampaignId(res.campaign.id);
      toast(
        res.campaign.status === 'held'
          ? `${plural(res.campaign.counts.queued, 'message')} will send shortly. You can still cancel.`
          : `Sending ${plural(res.campaign.counts.messages, 'message')}…`,
        'info',
      );
      onSent?.(res.campaign);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSending(false);
    }
  };

  if (campaignId) return <CampaignProgress campaignId={campaignId} onDone={() => setCampaignId(null)} />;
  if (disabledReason) return <div className="rounded-2xl border border-dashed border-line bg-soft/50 px-5 py-8 text-center text-sm text-muted">{disabledReason}</div>;
  if (error) return <ErrorNote error={error} />;
  if (!plan) return <div className="rounded-2xl border border-line bg-soft/40 px-5 py-8 text-center text-sm text-muted">{loading ? 'Finding affected customers…' : 'Set up the notification to preview recipients.'}</div>;

  const s = plan.summary;
  const ready = plan.messages.filter((m) => m.status === 'ready');
  const live = providers.sms.live || providers.email.live;

  return (
    <div className={cx('space-y-5 transition', loading && 'opacity-60')}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={Users} label="Customers matched" value={s.matchedCustomers} />
        <Metric icon={CheckCircle2} label="Will be reached" value={s.reachedCustomers} tone="green" note={s.matchedCustomers ? pct(s.reachedCustomers, s.matchedCustomers) : undefined} />
        <Metric icon={MessageSquare} label="Texts · Emails" value={`${s.smsMessages} · ${s.emailMessages}`} note={s.smsMessages ? `≈ $${s.estimatedSmsCost.toFixed(2)} SMS cost` : 'No texts'} />
        <Metric icon={UserX} label="Not reached" value={s.skippedCustomers} tone={s.skippedCustomers ? 'amber' : undefined} />
      </div>

      {Object.keys(s.skipReasons).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Not reached because:</span>
          {Object.entries(s.skipReasons).map(([reason, n]) => (
            <Badge key={reason} tone="amber">
              {reason} · {n}
            </Badge>
          ))}
        </div>
      )}

      {ready.length === 0 ? (
        <div className="rounded-2xl border border-line bg-soft/40 px-5 py-8 text-center text-sm text-muted">{s.matchedCustomers ? 'Everyone affected has already been notified or can’t be reached.' : emptyText}</div>
      ) : (
        <SamplePreviews plan={plan} />
      )}

      <RecipientTable plan={plan} />

      {plan.warnings.length > 0 && ready.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} /> Double-check before sending
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I’ve checked this and it’s correct
          </label>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          <span className="font-semibold text-ink">{plan.title}</span>
          <br />
          {live ? 'Live delivery for allowlisted recipients; everyone else is simulated.' : 'Simulation mode: messages are recorded but nothing leaves the demo.'}
        </div>
        <Button variant="accent" size="lg" icon={Send} data-tour="notify-send" loading={sending} disabled={!ready.length || loading || (plan.warnings.length > 0 && !ack)} onClick={send}>
          {sendLabel ?? 'Send'} {ready.length ? plural(ready.length, 'message') : ''}
        </Button>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: typeof Users; label: string; value: React.ReactNode; note?: string; tone?: 'green' | 'amber' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon size={13} className={cx(tone === 'green' && 'text-emerald-600', tone === 'amber' && 'text-amber-600')} /> {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {note && <div className="text-[11px] text-faint">{note}</div>}
    </div>
  );
}

function SamplePreviews({ plan }: { plan: Plan }) {
  const sms = plan.messages.find((m) => m.status === 'ready' && m.channel === 'sms');
  const email = plan.messages.find((m) => m.status === 'ready' && m.channel === 'email');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sms && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <MessageSquare size={13} /> Text message · {sms.customerName}
          </div>
          <SmsBubble body={sms.body!} />
        </div>
      )}
      {email && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <Mail size={13} /> Email · {email.customerName}
          </div>
          <EmailPreview subject={email.subject} body={email.body!} />
        </div>
      )}
    </div>
  );
}

function RecipientTable({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const byCustomer = new Map<string, { name: string; route: string | null; channels: ('sms' | 'email')[]; skip: string | null }>();
    for (const m of plan.messages) {
      const row = byCustomer.get(m.customerId) ?? { name: m.customerName, route: m.routeName, channels: [], skip: null };
      if (m.channel) row.channels.push(m.channel);
      if (m.status === 'skipped') row.skip = m.skipReason;
      byCustomer.set(m.customerId, row);
    }
    return [...byCustomer.values()].sort((a, b) => Number(Boolean(a.skip)) - Number(Boolean(b.skip)) || a.name.localeCompare(b.name));
  }, [plan]);
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold">
        <span>Recipient list ({rows.length})</span>
        <ChevronDown size={16} className={cx('transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="scrollbar-thin max-h-80 overflow-auto border-t border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-2 py-2">Route</th>
                <th className="px-2 py-2">Channels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.name}-${i}`} className="border-t border-line/60">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2 text-muted">{r.route}</td>
                  <td className="px-2 py-2">
                    {r.skip ? (
                      <Badge tone="amber">{r.skip}</Badge>
                    ) : (
                      <div className="flex gap-1">
                        {r.channels.map((c) => (
                          <ChannelBadge key={c} channel={c} />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Live view of a notification: undo window, delivery progress, then retry/correct. */
export function CampaignProgress({ campaignId, onDone }: { campaignId: string; onDone?: () => void }) {
  const [id, setId] = useState(campaignId);
  const [polls, setPolls] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<'cancel' | 'now' | 'retry' | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const q = useApi<{ campaign: Campaign; messages: Message[] }>(`/campaigns/${id}`);
  const toast = useToast();
  const held = q.data?.campaign.status === 'held';
  const inFlight = q.data?.campaign.inFlight ?? true;

  useEffect(() => setId(campaignId), [campaignId]);

  // Poll while held (no limit) or while delivering (about 30 seconds).
  useEffect(() => {
    if (!inFlight || (!held && polls > 45)) return;
    const t = setTimeout(() => {
      void q.reload();
      setPolls((n) => n + 1);
    }, held ? 1000 : 700);
    return () => clearTimeout(t);
  }, [inFlight, held, polls, q]);

  useEffect(() => {
    if (!held) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [held]);

  if (!q.data) return <div className="py-8 text-center text-sm text-muted">Loading…</div>;
  const { campaign, messages } = q.data;
  const c = campaign.counts;
  const total = c.messages || 1;
  const sent = messages.filter((m) => m.status !== 'skipped');

  const act = async (kind: 'cancel' | 'now') => {
    setBusy(kind);
    try {
      await api(`/campaigns/${campaign.id}/${kind === 'cancel' ? 'cancel' : 'send-now'}`, { body: {} });
      toast(kind === 'cancel' ? 'Cancelled. Nothing was sent.' : 'Sending now', kind === 'cancel' ? 'success' : 'info');
      setPolls(0);
      await q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      await q.reload();
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      const res = await api<{ campaign: Campaign }>('/notifications/send', { body: { request: campaign.params, retryFailed: true } });
      toast('Retrying failed messages', 'info');
      setId(res.campaign.id);
      setPolls(0);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const secondsLeft = campaign.sendAt ? Math.max(0, Math.ceil((new Date(campaign.sendAt).getTime() - now) / 1000)) : 0;
  const canCorrect = campaign.status === 'sent' && campaign.kind !== 'correction' && !inFlight && c.delivered + c.sent > 0;

  return (
    <div className="animate-rise space-y-4">
      {campaign.correctsCampaignId && (
        <button onClick={() => setId(campaign.correctsCampaignId!)} className="flex items-center gap-2 text-sm font-medium text-brand hover:underline">
          <Undo2 size={14} /> Correction of an earlier notification. View the original
        </button>
      )}

      {held ? (
        <div className="rounded-2xl border-2 border-accent bg-accent/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white font-display text-lg font-bold text-brand-dark shadow-sm">{secondsLeft}</div>
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  <Timer size={16} /> Sending in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}
                </div>
                <div className="text-sm text-muted">
                  {plural(c.queued, 'message')} waiting. Spotted a mistake? Cancel now and nobody receives anything.
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" icon={Ban} loading={busy === 'cancel'} disabled={!!busy} onClick={() => act('cancel')}>
                Cancel send
              </Button>
              <Button variant="primary" icon={Send} loading={busy === 'now'} disabled={!!busy} onClick={() => act('now')}>
                Send now
              </Button>
            </div>
          </div>
        </div>
      ) : campaign.status === 'cancelled' ? (
        <div className="rounded-2xl border border-line bg-slate-50 p-5">
          <div className="flex items-center gap-2 font-semibold">
            <Ban size={18} className="text-muted" /> Cancelled. Nothing was sent.
          </div>
          <div className="mt-1 text-sm text-muted">
            {campaign.title}. Cancelled by {campaign.cancelledBy}
            {campaign.cancelledAt ? ` at ${new Date(campaign.cancelledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}; {plural(c.cancelled, 'message')} never left.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                {inFlight ? <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" /> : <CheckCircle2 size={18} className="text-emerald-600" />}
                {inFlight ? 'Delivering…' : 'Delivery complete'}
              </div>
              <div className="mt-1 text-sm text-muted">{campaign.title}</div>
            </div>
            <div className="text-right text-sm">
              <div className="font-display text-2xl font-bold">
                {c.delivered}/{c.messages}
              </div>
              <div className="text-xs text-faint">delivered</div>
            </div>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {[
              { n: c.delivered, cls: 'bg-emerald-500' },
              { n: c.sent, cls: 'bg-sky-400' },
              { n: c.queued, cls: 'bg-slate-300' },
              { n: c.failed, cls: 'bg-red-500' },
            ].map((x, i) => x.n > 0 && <div key={i} className={cx('h-full transition-all duration-500', x.cls)} style={{ width: `${(x.n / total) * 100}%` }} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <Legend cls="bg-emerald-500" label="Delivered" n={c.delivered} />
            <Legend cls="bg-sky-400" label="Sent" n={c.sent} />
            <Legend cls="bg-slate-300" label="Queued" n={c.queued} />
            <Legend cls="bg-red-500" label="Failed" n={c.failed} />
            {c.skipped > 0 && <span>Not reached {c.skipped}</span>}
          </div>
        </div>
      )}

      <div className="scrollbar-thin max-h-72 overflow-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {sent.slice(0, 80).map((m) => (
              <tr key={m.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2 font-medium">{m.customerName}</td>
                <td className="px-2 py-2">
                  <ChannelBadge channel={m.channel} />
                </td>
                <td className="px-2 py-2 text-xs text-faint">{held ? 'Waiting' : m.provider === 'simulated' ? 'Simulated' : (m.provider ?? '')}</td>
                <td className="px-4 py-2 text-right">
                  <StatusPill status={m.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {canCorrect && (
          <Button icon={Undo2} onClick={() => setCorrecting(true)}>
            Send a correction
          </Button>
        )}
        {!inFlight && campaign.status === 'sent' && c.failed > 0 && (
          <Button icon={RotateCw} loading={busy === 'retry'} onClick={retry}>
            Retry {plural(c.failed, 'failed message')}
          </Button>
        )}
        <Button icon={ExternalLink} onClick={() => navigate(`/activity?campaign=${campaign.id}`)}>
          Open in delivery log
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        )}
      </div>

      {correcting && (
        <CorrectionModal
          campaignId={campaign.id}
          onClose={() => setCorrecting(false)}
          onSent={(correction) => {
            setCorrecting(false);
            setId(correction.id);
            setPolls(0);
          }}
        />
      )}
    </div>
  );
}

function Legend({ cls, label, n }: { cls: string; label: string; n: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx('h-2 w-2 rounded-full', cls)} /> {label} {n}
    </span>
  );
}
