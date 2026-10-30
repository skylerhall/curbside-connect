import { ArrowRight, BellRing, CalendarClock, CheckCircle2, CloudSnow, Recycle, Send, ShieldCheck, Siren, Undo2, Users, WalletCards, Zap } from 'lucide-react';
import type { Automation, Campaign, ScheduleOverride } from '../../../shared/types.ts';
import { Badge, Button, Card, EmptyState, Spinner, Stat, cx } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { dayName, dayNum, longDate, money, monthShort, pct, plural, shortDate, to12h, when } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';

interface Overview {
  today: string;
  customers: number;
  reachable: number;
  smsConsent: number;
  emailConsent: number;
  last7: { sent: number; delivered: number; failed: number };
  series: { day: string; sms: number; email: number; failed: number }[];
  tomorrow: { date: string; pickups: { routeId: string; routeName: string; customers: number; recycling: boolean; moved: { from: string; reason: string } | null }[]; automation: Automation | null };
  upcomingOverrides: (ScheduleOverride & { routeName: string })[];
  holidays: { name: string; date: string; applied: boolean }[];
  billing: { nextDue: string; pastDueAccounts: number; pastDueCents: number };
  recentCampaigns: Campaign[];
}

const KIND_ICON = { pickup_reminder: BellRing, schedule_change: CalendarClock, route_change: CalendarClock, billing_reminder: WalletCards, alert: Siren, correction: Undo2 };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const { tenant, routes } = useApp();
  const q = useApi<Overview>('/overview', { pollMs: 15000 });
  if (!q.data) return <Spinner />;
  const o = q.data;
  const auto = o.tomorrow.automation;
  const tomorrowCustomers = o.tomorrow.pickups.reduce((n, p) => n + p.customers, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting()}, {tenant.shortName} team.</h2>
          <p className="mt-1.5 text-muted">{longDate(o.today)} · Service changes reach the right customers, and every send is on the record.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={Siren} onClick={() => navigate('/alerts')}>
            Send an alert
          </Button>
          <Button variant="accent" icon={CloudSnow} data-tour="change-pickup" onClick={() => navigate('/schedule?new=1')}>
            Change a pickup
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active customers" value={o.customers.toLocaleString()} icon={Users} note={`${plural(routes.length, 'route')} · fictional demo accounts`} />
        <Stat label="Reachable by consent" value={pct(o.reachable, o.customers)} icon={ShieldCheck} note={`${o.smsConsent} SMS · ${o.emailConsent} email opted in`} />
        <Stat label="Messages, last 7 days" value={o.last7.sent.toLocaleString()} icon={Send} tone="blue" note={`${pct(o.last7.delivered, o.last7.sent)} delivered · ${o.last7.failed} failed`} />
        <Stat label="Past-due accounts" value={o.billing.pastDueAccounts} icon={WalletCards} tone="amber" note={`${money(o.billing.pastDueCents)} outstanding · next bill ${shortDate(o.billing.nextDue)}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title={`Tomorrow · ${longDate(o.tomorrow.date)}`}
          subtitle={o.tomorrow.pickups.length ? `${plural(tomorrowCustomers, 'customer')} on ${plural(o.tomorrow.pickups.length, 'route')}` : 'No collection scheduled'}
          icon={BellRing}
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('/reminders')}>
              Reminders <ArrowRight size={14} />
            </Button>
          }
        >
          {o.tomorrow.pickups.length === 0 ? (
            <p className="text-sm text-muted">Nothing to remind customers about tonight.</p>
          ) : (
            <div className="space-y-3">
              {o.tomorrow.pickups.map((p) => (
                <div key={p.routeId} className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
                  <div>
                    <div className="font-semibold">{p.routeName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {p.customers} customers
                      {p.recycling && (
                        <Badge tone="green">
                          <Recycle size={11} /> Recycling week
                        </Badge>
                      )}
                      {p.moved && <Badge tone="amber">Moved from {shortDate(p.moved.from)}: {p.moved.reason}</Badge>}
                    </div>
                  </div>
                </div>
              ))}
              {auto && (
                <div className={cx('flex items-center gap-3 rounded-xl px-4 py-3 text-sm', auto.enabled ? 'bg-brand/8 text-brand' : 'bg-slate-100 text-muted')}>
                  <Zap size={16} />
                  {auto.enabled
                    ? auto.lastRunDate === o.today
                      ? `Reminders went out today at ${when(auto.lastRunAt!, tenant.timezone).replace('Today ', '')}.`
                      : `Reminders send automatically today at ${to12h(auto.runTime)}.`
                    : 'Automatic reminders are paused.'}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Messages per day" subtitle="Last 14 days, all notification types" icon={Send}>
          <BarChart series={o.series} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
        <Card
          title="Coming up"
          subtitle="Exceptions to the regular schedule"
          icon={CalendarClock}
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('/schedule')}>
              Schedule <ArrowRight size={14} />
            </Button>
          }
          bodyClassName="divide-y divide-line"
        >
          {o.upcomingOverrides.map((x) => (
            <Row key={x.id} date={x.newDate ?? x.originalDate} title={`${x.routeName}: ${shortDate(x.originalDate)} → ${x.newDate ? shortDate(x.newDate) : 'cancelled'}`} detail={x.holidayName ?? x.reason} badge={x.notifiedCampaignId ? <Badge tone="green">Notified</Badge> : <Badge tone="amber">Not notified</Badge>} />
          ))}
          {o.holidays
            .filter((h) => !h.applied)
            .map((h) => (
              <Row key={h.date} date={h.date} title={h.name} detail={`${dayName(h.date)} holiday: schedule not applied yet`} badge={<Button size="sm" onClick={() => navigate('/schedule')}>Plan</Button>} />
            ))}
          {!o.upcomingOverrides.length && !o.holidays.some((h) => !h.applied) && <p className="px-5 py-4 text-sm text-muted">No exceptions coming up.</p>}
        </Card>

        <Card
          title="Recent notifications"
          icon={CheckCircle2}
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('/activity')}>
              Delivery log <ArrowRight size={14} />
            </Button>
          }
          bodyClassName="divide-y divide-line"
        >
          {o.recentCampaigns.length === 0 ? (
            <EmptyState icon={Send} title="Nothing sent yet" />
          ) : (
            o.recentCampaigns.map((c) => {
              const Icon = KIND_ICON[c.kind];
              return (
                <button key={c.id} onClick={() => navigate(`/activity?campaign=${c.id}`)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-soft/60">
                  <div className="rounded-xl bg-brand/10 p-2.5 text-brand">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.title}</div>
                    <div className="text-xs text-muted">
                      {when(c.createdAt, tenant.timezone)} · {c.trigger === 'automation' ? 'Automatic' : c.createdBy} · {plural(c.counts.recipients - c.counts.skipped, 'customer')}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    {c.status === 'cancelled' ? <div className="font-semibold text-muted">Cancelled</div> : c.status === 'held' ? <div className="font-semibold text-amber-700">Sending soon</div> : <div className="font-semibold text-emerald-700">{c.counts.delivered} delivered</div>}
                    {c.counts.failed > 0 && <div className="text-red-600">{c.counts.failed} failed</div>}
                  </div>
                </button>
              );
            })
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ date, title, detail, badge }: { date: string; title: string; detail: string; badge: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-soft text-center leading-none">
        <div>
          <div className="text-[9px] font-bold uppercase text-faint">{monthShort(date)}</div>
          <div className="text-base font-bold">{dayNum(date)}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-muted">{detail}</div>
      </div>
      {badge}
    </div>
  );
}

function BarChart({ series }: { series: Overview['series'] }) {
  const max = Math.max(1, ...series.map((d) => d.sms + d.email));
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {series.map((d) => {
          const total = d.sms + d.email;
          return (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.sms} SMS, ${d.email} email${d.failed ? `, ${d.failed} failed` : ''}`}>
              <div className="flex flex-col overflow-hidden rounded-t-md" style={{ height: `${(total / max) * 100}%` }}>
                <div className="bg-sky-accent" style={{ flex: d.email }} />
                <div className="bg-brand" style={{ flex: d.sms }} />
              </div>
              <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] text-white group-hover:block">{total}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 text-[10px] text-faint">
        {series.map((d, i) => (
          <div key={d.day} className="flex-1 text-center">
            {i % 2 === 0 ? `${monthShort(d.day)} ${dayNum(d.day)}` : ''}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> SMS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-accent" /> Email
        </span>
      </div>
    </div>
  );
}
