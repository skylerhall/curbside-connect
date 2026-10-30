import { BellRing, Recycle } from 'lucide-react';
import { useState } from 'react';
import type { Automation, Campaign, ScheduleOverride } from '../../../shared/types.ts';
import { AutomationCard } from '../components/AutomationCard.tsx';
import { NotifyFlow } from '../components/NotifyFlow.tsx';
import { CampaignList } from './Activity.tsx';
import { Badge, Card, Field, PageHeader, Spinner, inputClass } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { addDays, longDate, shortDate } from '../lib/format.ts';

interface CalendarDay {
  date: string;
  pickups: { routeId: string; routeName: string; code: string; recycling: boolean; override: ScheduleOverride | null }[];
}

export function RemindersPage() {
  const { today } = useApp();
  const [serviceDate, setServiceDate] = useState(addDays(today, 1));
  const automations = useApi<Automation[]>('/automations');
  const day = useApi<{ calendar: CalendarDay[] }>(`/schedule?from=${serviceDate}&days=1`);
  const campaigns = useApi<Campaign[]>('/campaigns?kind=pickup_reminder&limit=8');
  const auto = automations.data?.find((a) => a.kind === 'pickup_reminder');
  const pickups = day.data?.calendar[0]?.pickups ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Next-day pickup reminders"
        subtitle="Every evening, customers collected tomorrow get a text or email. Holiday and weather changes are built in, so a moved pickup gets a reminder on the right day."
      />

      {auto ? (
        <AutomationCard
          automation={auto}
          title="Automatic evening reminders"
          description="Sends to every customer collected tomorrow who has opted in. Safe to re-run: no one is reminded twice."
          onChange={() => (void automations.reload(), void campaigns.reload())}
        />
      ) : (
        <Spinner />
      )}

      <Card title="Preview or send reminders for a specific day" icon={BellRing}>
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end">
          <Field label="Collection date" hint={longDate(serviceDate)}>
            <input type="date" className={`${inputClass} w-52`} value={serviceDate} onChange={(e) => e.target.value && setServiceDate(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2 pb-6">
            {pickups.length === 0 && !day.loading && <Badge>No collection on {shortDate(serviceDate)}</Badge>}
            {pickups.map((p) => (
              <Badge key={p.routeId + (p.override?.id ?? '')} tone={p.override ? 'amber' : 'brand'}>
                {p.routeName}
                {p.recycling && !p.override && <Recycle size={11} />}
                {p.override && ` · moved from ${shortDate(p.override.originalDate)}`}
              </Badge>
            ))}
          </div>
        </div>
        <NotifyFlow request={{ kind: 'pickup_reminder', serviceDate }} sendLabel="Send" emptyText={`No routes are collected on ${shortDate(serviceDate)}.`} onSent={() => void campaigns.reload()} />
      </Card>

      <Card title="Recent reminder runs" bodyClassName="p-0">
        <CampaignList campaigns={campaigns.data} />
      </Card>
    </div>
  );
}
