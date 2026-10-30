import { ArrowRightLeft, CalendarClock, Map as MapIcon, Recycle, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Customer, Route, ScheduleOverride } from '../../../shared/types.ts';
import { NotifyFlow } from '../components/NotifyFlow.tsx';
import { Badge, Button, Card, Field, Modal, PageHeader, Spinner, cx, inputClass } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { WEEKDAYS, addDays, shortDate, weekdayOf } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';

type RouteRow = Route & { serviceDayName: string; nextPickup: { originalDate: string; serviceDate: string; override: ScheduleOverride | null }; recyclingNext: boolean };

export function RoutesPage() {
  const q = useApi<RouteRow[]>('/routes');
  const [moving, setMoving] = useState<RouteRow | null>(null);

  return (
    <div>
      <PageHeader title="Routes" subtitle="Collection days, customer counts and the next pickup for each route, with holiday and weather changes included." />
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((r) => (
            <Card key={r.id} bodyClassName="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{r.code}</Badge>
                    <span className="text-sm font-semibold text-muted">{r.serviceDayName}s</span>
                  </div>
                  <h3 className="mt-2 text-lg font-bold">{r.name}</h3>
                  <p className="text-sm text-muted">{r.area}</p>
                </div>
                <div className="rounded-xl bg-brand/10 p-3 text-brand">
                  <MapIcon size={20} />
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-soft/70 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    <Users size={12} /> Customers
                  </div>
                  <div className="mt-0.5 text-lg font-bold">{r.customerCount}</div>
                </div>
                <div className={cx('rounded-xl px-3 py-2.5', r.nextPickup.override ? 'bg-amber-50' : 'bg-soft/70')}>
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    <CalendarClock size={12} /> Next pickup
                  </div>
                  <div className="mt-0.5 font-bold">{shortDate(r.nextPickup.serviceDate)}</div>
                  {r.nextPickup.override && <div className="truncate text-xs text-amber-800">{r.nextPickup.override.holidayName ?? r.nextPickup.override.reason}</div>}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                <Recycle size={13} className={r.recyclingNext ? 'text-emerald-600' : 'text-faint'} />
                {r.recyclingNext ? 'Recycling collected at next pickup' : 'Trash only at next pickup (recycling every other week)'}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => navigate(`/schedule?new=1&route=${r.id}`)}>
                  Change next pickup
                </Button>
                <Button size="sm" icon={ArrowRightLeft} onClick={() => setMoving(r)}>
                  Move customers
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/customers?route=${r.id}`)}>
                  View customers
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {moving && q.data && <MoveCustomersModal from={moving} routes={q.data} onClose={() => (setMoving(null), void q.reload())} />}
    </div>
  );
}

function MoveCustomersModal({ from, routes, onClose }: { from: RouteRow; routes: RouteRow[]; onClose: () => void }) {
  const { today } = useApp();
  const customers = useApi<Customer[]>(`/customers?routeId=${from.id}`);
  const others = routes.filter((r) => r.id !== from.id);
  const [toRouteId, setToRouteId] = useState(others[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const nextMonday = useMemo(() => {
    let d = addDays(today, 7);
    while (weekdayOf(d) !== 1) d = addDays(d, 1);
    return d;
  }, [today]);
  const [effective, setEffective] = useState(nextMonday);
  const [step, setStep] = useState<'pick' | 'notify'>('pick');
  const toRoute = routes.find((r) => r.id === toRouteId);
  const pending = (customers.data ?? []).filter((c) => !c.nextRouteId);

  return (
    <Modal open onClose={onClose} wide title={`Move customers off ${from.name}`} subtitle="For route rebalancing, for example after an acquisition. Customers are told their new day before it takes effect.">
      {step === 'pick' ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="New route">
              <select className={inputClass} value={toRouteId} onChange={(e) => setToRouteId(e.target.value)}>
                {others.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.serviceDayName})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective date" hint={toRoute ? `First ${WEEKDAYS[toRoute.serviceDay]} pickup on or after this date.` : undefined}>
              <input type="date" className={inputClass} value={effective} min={today} onChange={(e) => setEffective(e.target.value)} />
            </Field>
          </div>
          <Field label={`Customers to move (${selected.length} selected)`}>
            {!customers.data ? (
              <Spinner />
            ) : (
              <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-xl border border-line">
                <div className="flex items-center justify-between border-b border-line bg-slate-50 px-4 py-2 text-xs">
                  <button className="font-semibold text-brand" onClick={() => setSelected(selected.length === pending.length ? [] : pending.map((c) => c.id))}>
                    {selected.length === pending.length ? 'Clear all' : 'Select all'}
                  </button>
                  <span className="text-faint">{pending.length} eligible</span>
                </div>
                {pending.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2 text-sm last:border-0 hover:bg-soft/50">
                    <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
                    <span className="font-medium">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="text-muted">{c.serviceAddress}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!selected.length || !toRouteId} onClick={() => setStep('notify')}>
              Preview notices
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Button size="sm" variant="ghost" onClick={() => setStep('pick')}>
            ← Back
          </Button>
          <NotifyFlow request={{ kind: 'route_change', customerIds: selected, toRouteId, effectiveDate: effective }} sendLabel="Move & notify" />
        </div>
      )}
    </Modal>
  );
}
