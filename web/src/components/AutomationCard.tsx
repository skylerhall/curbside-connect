import { Play, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Automation, Campaign } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { to12h, when } from '../lib/format.ts';
import { Button, Card, Toggle, inputClass, useToast } from './ui.tsx';

export function AutomationCard({ automation, title, description, onChange, children }: { automation: Automation; title: string; description: ReactNode; onChange: () => void; children?: ReactNode }) {
  const { tenant } = useApp();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  const patch = async (body: Partial<Automation>) => {
    try {
      await api(`/automations/${automation.kind}`, { method: 'PATCH', body });
      onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await api<{ campaigns: Campaign[]; note: string }>(`/automations/${automation.kind}/run`, { body: {} });
      toast(res.note, res.campaigns.length ? 'success' : 'info');
      onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card title={title} subtitle={description} icon={Zap} action={<Toggle checked={automation.enabled} onChange={(enabled) => patch({ enabled })} label="Enabled" />}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Runs daily at ({tenant.timezone.split('/')[1]?.replace('_', ' ')} time)</span>
          <input type="time" className={`${inputClass} w-36`} value={automation.runTime} onChange={(e) => e.target.value && patch({ runTime: e.target.value })} />
        </label>
        {children}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right text-xs text-muted">
            {automation.enabled ? `Next: ${to12h(automation.runTime)}` : 'Paused'}
            <br />
            Last run: {automation.lastRunAt ? when(automation.lastRunAt, tenant.timezone) : 'never'}
          </div>
          <Button icon={Play} loading={running} onClick={runNow}>
            Run now
          </Button>
        </div>
      </div>
    </Card>
  );
}
