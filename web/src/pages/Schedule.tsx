import { ArrowRight, CalendarClock, CalendarDays, CheckCircle2, CloudSnow, PartyPopper, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OverrideKind, Route, ScheduleOverride } from '../../../shared/types.ts';
import { CorrectionModal } from '../components/CorrectionModal.tsx';
import { NotifyFlow } from '../components/NotifyFlow.tsx';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Segmented, Spinner, cx, inputClass, useToast } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { WEEKDAYS, addDays, dayName, dayNum, longDate, monthShort, shortDate, weekdayOf } from '../lib/format.ts';
import { navigate, useLocation } from '../lib/router.ts';
import { tourSignal } from '../lib/tour.ts';

type OverrideRow = ScheduleOverride & { routeName: string; routeCode: string };
interface HolidayRow {
  name: string;
  date: string;
  weekday: string;
  plan: { routeId: string; routeName: string; originalDate: string; newDate: string }[];
  applied: boolean;
  notified: boolean;
}
interface CalendarDay {
  date: string;
  pickups: { routeId: string; routeName: string; code: string; recycling: boolean; override: ScheduleOverride | null }[];
}

const KIND_LABEL: Record<OverrideKind, string> = { holiday: 'Holiday', weather: 'Weather', operational: 'Operational' };
const KIND_TONE = { holiday: 'purple', weather: 'blue', operational: 'amber' } as const;

export function SchedulePage() {
  const { query } = useLocation();
  const toast = useToast();
  const holidays = useApi<HolidayRow[]>('/holidays');
  const overrides = useApi<OverrideRow[]>('/overrides');
  const schedule = useApi<{ from: string; calendar: CalendarDay[] }>('/schedule?days=28');
  const [wizard, setWizard] = useState<{ routeId?: string } | null>(query.get('new') ? { routeId: query.get('route') ?? undefined } : null);
  const [notify, setNotify] = useState<{ title: string; ids: string[] } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  // Opening /schedule?new=1 while already on this page (e.g. from the tour) opens the wizard too.
  useEffect(() => {
    if (query.get('new')) setWizard({ routeId: query.get('route') ?? undefined });
  }, [query]);

  const reloadAll = () => {
    void holidays.reload();
    void overrides.reload();
    void schedule.reload();
  };

  const applyHoliday = async (h: HolidayRow) => {
    setApplying(h.date);
    try {
      const created = await api<ScheduleOverride[]>('/overrides/holiday-slide', { body: { date: h.date, name: h.name } });
      toast(`${h.name} schedule applied to ${created.length} route${created.length === 1 ? '' : 's'}`);
      reloadAll();
      setNotify({ title: `${h.name} schedule change`, ids: created.map((o) => o.id) });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setApplying(null);
    }
  };

  const holidayOverrideIds = (h: HolidayRow) =>
    (overrides.data ?? []).filter((o) => h.plan.some((p) => p.routeId === o.routeId && p.originalDate === o.originalDate)).map((o) => o.id);

  const [correcting, setCorrecting] = useState<string | null>(null);

  const remove = async (o: OverrideRow) => {
    await api(`/overrides/${o.id}`, { method: 'DELETE' });
    toast('Schedule change removed', 'info');
    reloadAll();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service schedule"
        subtitle="Holiday slides, weather delays and one-off route changes. Make the change once and the right customers hear about it automatically."
        actions={
          <Button variant="accent" icon={Plus} data-tour="change-pickup" onClick={() => setWizard({})}>
            Change a pickup
          </Button>
        }
      />

      <Card title="Upcoming holidays" subtitle="Weekday holidays slide that day’s and later pickups one day (Friday moves to Saturday)." icon={PartyPopper} bodyClassName="divide-y divide-line">
        {!holidays.data ? (
          <Spinner />
        ) : (
          holidays.data.slice(0, 4).map((h) => (
            <div key={h.date} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <DateTile date={h.date} />
                <div>
                  <div className="font-semibold">{h.name}</div>
                  <div className="text-sm text-muted">
                    {h.plan.length ? (
                      <>
                        {h.weekday}: {h.plan.map((p) => `${dayName(p.originalDate)} → ${dayName(p.newDate)}`).join(', ')}
                      </>
                    ) : (
                      `${h.weekday}: falls on a weekend, so no pickups move`
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!h.plan.length ? (
                  <Badge>No change</Badge>
                ) : h.notified ? (
                  <Badge tone="green">
                    <CheckCircle2 size={12} /> Customers notified
                  </Badge>
                ) : h.applied ? (
                  <Button variant="primary" size="sm" onClick={() => setNotify({ title: `${h.name} schedule change`, ids: holidayOverrideIds(h) })}>
                    Notify customers
                  </Button>
                ) : (
                  <Button size="sm" loading={applying === h.date} onClick={() => applyHoliday(h)}>
                    Apply holiday schedule
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card title="Next four weeks" subtitle="Regular collection plus every exception. Moved pickups are highlighted." icon={CalendarDays} bodyClassName="p-0">
        {schedule.data ? <CalendarGrid days={schedule.data.calendar} holidays={holidays.data ?? []} /> : <Spinner />}
      </Card>

      <Card title="Schedule changes" subtitle="Every exception, whether customers were notified, and by which campaign." icon={CalendarClock} bodyClassName="p-0">
        {!overrides.data ? (
          <Spinner />
        ) : overrides.data.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No schedule changes yet" text="Use “Change a pickup” for weather or truck delays, or apply a holiday schedule above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-2 py-3">Change</th>
                  <th className="px-2 py-3">Reason</th>
                  <th className="px-2 py-3">Customers</th>
                  <th className="px-5 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {overrides.data.map((o) => (
                  <tr key={o.id} className="border-t border-line/70">
                    <td className="px-5 py-3">
                      <div className="font-semibold">{o.routeName}</div>
                      <div className="text-xs text-faint">{o.routeCode}</div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        {shortDate(o.originalDate)} <ArrowRight size={14} className="text-faint" /> {o.newDate ? shortDate(o.newDate) : <span className="text-red-700">Cancelled</span>}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={KIND_TONE[o.kind]}>{KIND_LABEL[o.kind]}</Badge>
                        <span className="text-muted">{o.holidayName ?? o.reason}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {o.notifiedCampaignId ? (
                        <button onClick={() => navigate(`/activity?campaign=${o.notifiedCampaignId}`)} className="text-left">
                          <Badge tone="green">
                            <CheckCircle2 size={12} /> Notified
                          </Badge>
                        </button>
                      ) : (
                        <Badge tone="amber">Not notified</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {!o.notifiedCampaignId && (
                          <Button size="sm" variant="primary" onClick={() => setNotify({ title: `${o.routeName}: ${shortDate(o.originalDate)}`, ids: [o.id] })}>
                            Notify
                          </Button>
                        )}
                        {o.notifiedCampaignId ? (
                          <Button size="sm" variant="ghost" icon={Undo2} title="Customers were told about this. Undo it and send them a correction." onClick={() => setCorrecting(o.notifiedCampaignId)}>
                            Undo &amp; correct
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(o)} aria-label="Remove" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {wizard && (
        <ScheduleChangeWizard
          initialRouteId={wizard.routeId}
          onClose={() => {
            setWizard(null);
            reloadAll();
            if (query.get('new')) navigate('/schedule');
          }}
          onChanged={reloadAll}
        />
      )}

      {correcting && <CorrectionModal campaignId={correcting} onClose={() => (setCorrecting(null), reloadAll())} onChanged={reloadAll} />}

      <Modal open={!!notify} onClose={() => (setNotify(null), reloadAll())} title={notify?.title ?? ''} subtitle="Preview who’s affected, then send." wide>
        {notify && <NotifyFlow request={{ kind: 'schedule_change', overrideIds: notify.ids }} sendLabel="Notify" onSent={reloadAll} />}
      </Modal>
    </div>
  );
}

function DateTile({ date }: { date: string }) {
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
      <div className="text-center leading-none">
        <div className="text-[10px] font-bold uppercase tracking-wider">{monthShort(date)}</div>
        <div className="mt-1 text-xl font-bold">{dayNum(date)}</div>
      </div>
    </div>
  );
}

function CalendarGrid({ days, holidays }: { days: CalendarDay[]; holidays: HolidayRow[] }) {
  const { today } = useApp();
  // Align to Monday, show Mon–Sat.
  const start = addDays(days[0].date, -((weekdayOf(days[0].date) + 6) % 7));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks: string[][] = [];
  for (let w = 0; w < 4; w++) weeks.push(Array.from({ length: 6 }, (_, i) => addDays(start, w * 7 + i)));
  const holidayOn = new Map(holidays.map((h) => [h.date, h.name]));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-6 border-b border-line bg-slate-50 text-xs font-semibold uppercase tracking-wide text-faint">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-3 py-2">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid min-w-[760px] grid-cols-6 border-b border-line last:border-0">
          {week.map((date) => {
            const day = byDate.get(date);
            const past = date < today;
            return (
              <div key={date} className={cx('min-h-24 border-r border-line/60 p-2 last:border-0', past && 'bg-slate-50/70 opacity-55', date === today && 'bg-brand/5')}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={cx('text-xs font-semibold', date === today ? 'rounded-md bg-brand px-1.5 py-0.5 text-white' : 'text-muted')}>
                    {monthShort(date)} {dayNum(date)}
                  </span>
                  {holidayOn.has(date) && <span className="truncate pl-1 text-[10px] font-semibold text-violet-700">{holidayOn.get(date)}</span>}
                </div>
                <div className="space-y-1">
                  {day?.pickups.map((p) => (
                    <div
                      key={p.routeId + (p.override?.id ?? '')}
                      title={p.override ? `Moved from ${shortDate(p.override.originalDate)}: ${p.override.holidayName ?? p.override.reason}` : p.recycling ? 'Trash + recycling' : 'Trash'}
                      className={cx('truncate rounded-md px-1.5 py-1 text-[11px] font-medium', p.override ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-brand/10 text-brand')}
                    >
                      {p.override ? '↪ ' : ''}
                      {p.routeName}
                      {p.recycling && !p.override && <span className="ml-1 opacity-60">♻</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const REASONS: { label: string; kind: OverrideKind; icon?: typeof CloudSnow }[] = [
  { label: 'Snow and icy roads', kind: 'weather' },
  { label: 'High winds', kind: 'weather' },
  { label: 'Severe weather', kind: 'weather' },
  { label: 'Road closure', kind: 'operational' },
  { label: 'Truck breakdown', kind: 'operational' },
  { label: 'Landfill closed early', kind: 'operational' },
];

export function ScheduleChangeWizard({ initialRouteId, onClose, onChanged }: { initialRouteId?: string; onClose: () => void; onChanged: () => void }) {
  const { routes, today } = useApp();
  const toast = useToast();
  const firstServiceDate = useMemo(() => {
    if (initialRouteId) {
      const r = routes.find((x) => x.id === initialRouteId);
      if (r) for (let i = 1; i <= 7; i++) if (weekdayOf(addDays(today, i)) === r.serviceDay) return addDays(today, i);
    }
    for (let i = 1; i <= 7; i++) if (routes.some((r) => r.serviceDay === weekdayOf(addDays(today, i)))) return addDays(today, i);
    return addDays(today, 1);
  }, [routes, today, initialRouteId]);

  const [date, setDate] = useState(firstServiceDate);
  const scheduled = routes.filter((r) => r.serviceDay === weekdayOf(date));
  const [selected, setSelected] = useState<string[]>(initialRouteId ? [initialRouteId] : scheduled.map((r) => r.id));
  const [mode, setMode] = useState<'move' | 'cancel'>('move');
  const [newDate, setNewDate] = useState(addDays(firstServiceDate, 1));
  const [reason, setReason] = useState(REASONS[0].label);
  const [kind, setKind] = useState<OverrideKind>('weather');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<ScheduleOverride[] | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    tourSignal('wizard_opened');
    return () => tourSignal('wizard_closed');
  }, []);

  useEffect(() => {
    if (!initialRouteId || date !== firstServiceDate) setSelected(routes.filter((r) => r.serviceDay === weekdayOf(date)).map((r) => r.id));
    setNewDate(addDays(date, 1));
  }, [date]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api<ScheduleOverride[]>('/overrides', { body: { routeIds: selected, originalDate: date, newDate: mode === 'move' ? newDate : null, kind, reason } });
      setCreated(result);
      onChanged();
      tourSignal('schedule_updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!created) return;
    await Promise.all(created.map((o) => api(`/overrides/${o.id}`, { method: 'DELETE' })));
    setCreated(null);
    onChanged();
  };

  const canSave = selected.length > 0 && reason.trim() && (mode === 'cancel' || (newDate && newDate !== date));

  return (
    <Modal open onClose={onClose} wide title={created ? 'Notify affected customers' : 'Change a pickup'} subtitle={created ? 'The schedule is updated. Review the messages and send.' : 'Weather, road closures, truck problems: anything that moves a collection day.'}>
      {!created ? (
        <div className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Which collection day is affected?" hint={date ? longDate(date) : undefined}>
              <input type="date" className={inputClass} value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <Field label="What’s happening?">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'move', label: 'Move to another day' },
                  { value: 'cancel', label: 'Cancel this pickup' },
                ]}
              />
            </Field>
          </div>

          <Field label={`Routes collected ${dayName(date)}`}>
            {scheduled.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">No routes are collected on {WEEKDAYS[weekdayOf(date)]}s. Pick another date.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {scheduled.map((r: Route) => {
                  const on = selected.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelected(on ? selected.filter((x) => x !== r.id) : [...selected, r.id])}
                      className={cx('rounded-xl border px-3 py-2 text-left text-sm transition', on ? 'border-brand bg-brand/8 ring-2 ring-brand/20' : 'border-line hover:bg-soft')}
                    >
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-xs text-muted">
                        {r.code} · {r.customerCount} customers
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {mode === 'move' && (
            <Field label="New collection date" hint={newDate ? longDate(newDate) : undefined}>
              <input type="date" className={cx(inputClass, 'max-w-xs')} value={newDate} min={date} onChange={(e) => setNewDate(e.target.value)} />
              {newDate && (weekdayOf(newDate) === 0 || newDate < date || newDate < today) && (
                <span className="mt-1.5 block text-xs font-semibold text-amber-700">
                  {newDate < today ? 'That date is in the past.' : newDate < date ? 'That’s earlier than the original pickup.' : 'That’s a Sunday.'} Double-check before continuing.
                </span>
              )}
            </Field>
          )}

          <Field label="Reason (customers will see this)">
            <div className="mb-2 flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => {
                    setReason(r.label);
                    setKind(r.kind);
                  }}
                  className={cx('rounded-full border px-3 py-1 text-xs font-medium transition', reason === r.label ? 'border-brand bg-brand text-white' : 'border-line hover:bg-soft')}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input className={inputClass} value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} />
              <select className={cx(inputClass, 'w-40')} value={kind} onChange={(e) => setKind(e.target.value as OverrideKind)}>
                <option value="weather">Weather</option>
                <option value="operational">Operational</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>
          </Field>

          <div className="flex justify-end gap-2 border-t border-line pt-5">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={ArrowRight} data-tour="update-schedule" disabled={!canSave} loading={saving} onClick={save}>
              Update schedule & find affected customers
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>
                Schedule updated: {created.map((o) => routes.find((r) => r.id === o.routeId)?.name).join(', ')} {shortDate(created[0].originalDate)} →{' '}
                {created[0].newDate ? shortDate(created[0].newDate) : 'cancelled'}.
              </span>
            </div>
            {!sent && (
              <Button size="sm" variant="ghost" icon={Undo2} onClick={undo}>
                Undo change
              </Button>
            )}
          </div>
          <NotifyFlow request={{ kind: 'schedule_change', overrideIds: created.map((o) => o.id) }} sendLabel="Notify" onSent={() => (setSent(true), onChanged(), tourSignal('notified'))} />
        </div>
      )}
    </Modal>
  );
}
