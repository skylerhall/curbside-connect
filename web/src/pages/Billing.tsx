import { AlertTriangle, CalendarClock, CreditCard, Receipt, WalletCards } from 'lucide-react';
import { useState } from 'react';
import type { Automation, BillingMode, Campaign } from '../../../shared/types.ts';
import { AutomationCard } from '../components/AutomationCard.tsx';
import { NotifyFlow } from '../components/NotifyFlow.tsx';
import { CampaignList } from './Activity.tsx';
import { Card, PageHeader, Segmented, Spinner, Stat, inputClass, useToast } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { longDate, money, plural, shortDate } from '../lib/format.ts';

interface BillingData {
  today: string;
  nextDue: string;
  lastDue: string;
  dueDay: number;
  manual: { count: number; totalCents: number };
  autopay: { count: number; totalCents: number };
  pastDue: { count: number; totalCents: number };
  automation: Automation | null;
  campaigns: Campaign[];
}

const MODES: { value: BillingMode; label: string; help: string }[] = [
  { value: 'upcoming', label: 'Upcoming bill', help: 'Customers who pay manually get the amount and due date, with a link to pay.' },
  { value: 'autopay', label: 'Autopay heads-up', help: 'Autopay customers get a friendly note before their payment processes, which cuts down on “why was I charged?” calls.' },
  { value: 'past_due', label: 'Past due', help: 'A courteous nudge for accounts with an unpaid balance from the last statement.' },
];

export function BillingPage() {
  const q = useApi<BillingData>('/billing');
  const [mode, setMode] = useState<BillingMode>('upcoming');
  const toast = useToast();
  if (!q.data) return <Spinner />;
  const b = q.data;
  const help = MODES.find((m) => m.value === mode)!.help;

  const updateConfig = async (config: Automation['config']) => {
    try {
      await api('/automations/billing_reminder', { method: 'PATCH', body: { config: { ...b.automation?.config, ...config } } });
      void q.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing reminders"
        subtitle={`Statements are due on day ${b.dueDay} of each month and autopay processes the same day. Reminders use balances from the billing system (Soft-Pak export in production).`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Next due date" value={shortDate(b.nextDue)} icon={CalendarClock} note={longDate(b.nextDue)} />
        <Stat label="Pay manually" value={b.manual.count} icon={Receipt} note={`${money(b.manual.totalCents)} expected`} />
        <Stat label="On autopay" value={b.autopay.count} icon={CreditCard} tone="blue" note={`${money(b.autopay.totalCents)} processing ${shortDate(b.nextDue)}`} />
        <Stat label="Past due" value={b.pastDue.count} icon={AlertTriangle} tone="amber" note={`${money(b.pastDue.totalCents)} outstanding`} />
      </div>

      {b.automation && (
        <AutomationCard
          automation={b.automation}
          title="Automatic billing reminders"
          description="Upcoming-bill and autopay notes go out a few days before the due date; past-due notices after a grace period. Each customer gets each reminder once per billing cycle."
          onChange={() => void q.reload()}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Days before due date</span>
            <input type="number" min={1} max={14} className={`${inputClass} w-28`} value={b.automation.config.daysBefore ?? 3} onChange={(e) => updateConfig({ daysBefore: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Past-due grace (days)</span>
            <input type="number" min={1} max={30} className={`${inputClass} w-28`} value={b.automation.config.pastDueGraceDays ?? 5} onChange={(e) => updateConfig({ pastDueGraceDays: Number(e.target.value) })} />
          </label>
        </AutomationCard>
      )}

      <Card title="Send billing reminders now" subtitle={help} icon={WalletCards}>
        <div className="mb-5">
          <Segmented value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />
        </div>
        <NotifyFlow request={{ kind: 'billing_reminder', mode }} sendLabel="Send" onSent={() => void q.reload()} />
      </Card>

      <Card title="Recent billing reminders" subtitle={`${plural(b.campaigns.length, 'run')} shown`} bodyClassName="p-0">
        <CampaignList campaigns={b.campaigns} />
      </Card>
    </div>
  );
}
