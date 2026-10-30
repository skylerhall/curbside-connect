import { Mail, MessageSquare, ShieldAlert, Siren } from 'lucide-react';
import { useState } from 'react';
import type { AlertSeverity, Campaign, Channel } from '../../../shared/types.ts';
import { NotifyFlow } from '../components/NotifyFlow.tsx';
import { CampaignList } from './Activity.tsx';
import { Card, Field, PageHeader, Segmented, cx } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';

// Each preset fits in one SMS segment once the company name, label and opt-out text are added.
const PRESETS: { label: string; severity: AlertSeverity; text: string }[] = [
  { label: 'Snow delay', severity: 'delay', text: "Snow is slowing routes. If your cart isn't emptied by 5 PM, leave it out. We'll return tomorrow." },
  { label: 'High winds', severity: 'advisory', text: 'High winds today. Please close cart lids and set carts with handles facing your home.' },
  { label: 'Road closure', severity: 'delay', text: 'A road closure is delaying service in your area. Please leave carts out until emptied.' },
  { label: 'Extreme cold', severity: 'advisory', text: "Extreme cold tonight. Please bag trash so it doesn't freeze to the cart." },
  { label: 'Wildfire smoke', severity: 'emergency', text: "Wildfire smoke and road closures: no collection today. Keep carts home. We'll update you soon." },
];

export function AlertsPage() {
  const { routes } = useApp();
  const [severity, setSeverity] = useState<AlertSeverity>('delay');
  const [scope, setScope] = useState<'all' | string[]>('all');
  const [channels, setChannels] = useState<Channel[]>(['sms', 'email']);
  const [message, setMessage] = useState(PRESETS[0].text);
  const history = useApi<Campaign[]>('/campaigns?kind=alert&limit=8');

  const toggleChannel = (c: Channel) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const toggleRoute = (id: string) => {
    const current = scope === 'all' ? [] : scope;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setScope(next.length ? next : 'all');
  };

  const disabledReason = !message.trim() ? 'Write the alert message to preview recipients.' : !channels.length ? 'Pick at least one channel.' : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Weather & emergency alerts" subtitle="Reach a whole service area, or just the affected routes, in seconds. Alerts use your message wrapped in your company’s voice." />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <Card title="Compose" icon={Siren}>
          <div className="space-y-5">
            <Field label="Type">
              <Segmented
                value={severity}
                onChange={setSeverity}
                options={[
                  { value: 'advisory', label: 'Service advisory' },
                  { value: 'delay', label: 'Weather delay' },
                  { value: 'emergency', label: 'Emergency' },
                ]}
              />
            </Field>
            {severity === 'emergency' && (
              <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                Emergency alerts also reach customers who turned off routine service alerts. They never go to anyone who hasn’t consented to that channel.
              </div>
            )}
            <Field label="Quick start">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setMessage(p.text);
                      setSeverity(p.severity);
                    }}
                    className={cx('rounded-full border px-3 py-1 text-xs font-medium', message === p.text ? 'border-brand bg-brand text-white' : 'border-line hover:bg-soft')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Message" hint={`${message.length} characters. Company name, label and “Reply STOP to opt out” are added automatically for texts.`}>
              <textarea className="min-h-28 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-brand/50 focus:ring-3 focus:ring-brand/15" value={message} maxLength={480} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <Field label="Who">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setScope('all')} className={cx('rounded-xl border px-3 py-1.5 text-sm font-medium', scope === 'all' ? 'border-brand bg-brand/8 ring-2 ring-brand/20' : 'border-line hover:bg-soft')}>
                  All routes
                </button>
                {routes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => toggleRoute(r.id)}
                    className={cx('rounded-xl border px-3 py-1.5 text-sm', scope !== 'all' && scope.includes(r.id) ? 'border-brand bg-brand/8 font-medium ring-2 ring-brand/20' : 'border-line hover:bg-soft')}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Channels">
              <div className="flex gap-2">
                {(['sms', 'email'] as Channel[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => toggleChannel(c)}
                    className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm', channels.includes(c) ? 'border-brand bg-brand/8 font-medium ring-2 ring-brand/20' : 'border-line text-muted hover:bg-soft')}
                  >
                    {c === 'sms' ? <MessageSquare size={15} /> : <Mail size={15} />}
                    {c === 'sms' ? 'Text message' : 'Email'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card title="Preview & send">
          <NotifyFlow request={{ kind: 'alert', severity, routeIds: scope, channels, message }} disabledReason={disabledReason} sendLabel="Send alert:" onSent={() => void history.reload()} />
        </Card>
      </div>

      <Card title="Recent alerts" bodyClassName="p-0">
        <CampaignList campaigns={history.data} />
      </Card>
    </div>
  );
}
