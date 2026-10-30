import { AlertTriangle, Check, Mail, MessageSquare, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMON_VARIABLES, type SegmentInfo } from '../../../shared/catalog.ts';
import type { Channel, Template, TemplateKind } from '../../../shared/types.ts';
import { EmailPreview, SmsBubble } from '../components/previews.tsx';
import { Badge, Button, Card, Field, PageHeader, Spinner, cx, inputClass, useToast } from '../components/ui.tsx';
import { api, useApi } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { when } from '../lib/format.ts';

const CATEGORY_LABEL = { pickup: 'Pickup', service: 'Service changes', billing: 'Billing' } as const;

export function TemplatesPage() {
  const { catalog } = useApp();
  const q = useApi<Template[]>('/templates');
  const [kind, setKind] = useState<TemplateKind>('pickup_reminder');
  const [channel, setChannel] = useState<Channel>('sms');

  if (!q.data) return <Spinner />;
  const template = q.data.find((t) => t.kind === kind && t.channel === channel);
  const groups = (['pickup', 'service', 'billing'] as const).map((cat) => ({ cat, items: catalog.filter((c) => c.category === cat) }));

  return (
    <div>
      <PageHeader title="Message templates" subtitle="Edit exactly what customers receive. Variables like {{first_name}} fill in per customer at send time; the preview uses a real (fictional) customer." />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card bodyClassName="p-2">
          {groups.map((g) => (
            <div key={g.cat} className="mb-2">
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[.14em] text-faint">{CATEGORY_LABEL[g.cat]}</div>
              {g.items.map((info) => {
                const customized = q.data!.some((t) => t.kind === info.kind && t.isCustomized);
                return (
                  <button key={info.kind} onClick={() => setKind(info.kind)} className={cx('w-full rounded-xl px-3 py-2.5 text-left transition', kind === info.kind ? 'bg-brand/10' : 'hover:bg-soft')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-sm font-medium', kind === info.kind && 'text-brand')}>{info.label}</span>
                      {customized && <Badge tone="brand">Edited</Badge>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </Card>
        {template ? <Editor key={template.id + template.updatedAt} template={template} channel={channel} setChannel={setChannel} onSaved={() => void q.reload()} /> : <Spinner />}
      </div>
    </div>
  );
}

function Editor({ template, channel, setChannel, onSaved }: { template: Template; channel: Channel; setChannel: (c: Channel) => void; onSaved: () => void }) {
  const { catalog, tenant } = useApp();
  const toast = useToast();
  const info = catalog.find((c) => c.kind === template.kind)!;
  const [body, setBody] = useState(template.body);
  const [subject, setSubject] = useState(template.subject ?? '');
  const [preview, setPreview] = useState<{ body: string; subject: string | null; missing: string[]; sms: SegmentInfo | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dirty = body !== template.body || (template.channel === 'email' && subject !== (template.subject ?? ''));

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setPreview(await api('/templates/preview', { body: { kind: template.kind, channel: template.channel, body, subject } }));
      } catch {
        // preview is best-effort
      }
    }, 200);
    return () => clearTimeout(t);
  }, [body, subject, template.kind, template.channel]);

  const insert = (name: string) => {
    const el = textarea.current;
    const token = `{{${name}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/templates/${template.id}`, { method: 'PUT', body: { body, subject } });
      toast('Template saved. New messages will use it right away.');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset this template to the default wording?')) return;
    await api(`/templates/${template.id}/reset`, { body: {} });
    toast('Template reset to default', 'info');
    onSaved();
  };

  const variables = useMemo(() => [...info.variables, ...COMMON_VARIABLES], [info]);

  return (
    <Card
      title={info.label}
      subtitle={info.description}
      action={
        <div className="inline-flex rounded-xl border border-line bg-soft p-1">
          {(['sms', 'email'] as Channel[]).map((c) => (
            <button key={c} onClick={() => setChannel(c)} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium', channel === c ? 'bg-white shadow-sm' : 'text-muted')}>
              {c === 'sms' ? <MessageSquare size={14} /> : <Mail size={14} />}
              {c === 'sms' ? 'SMS' : 'Email'}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {template.channel === 'email' && (
            <Field label="Subject">
              <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label={template.channel === 'sms' ? 'Text message' : 'Email body'} hint={template.channel === 'email' ? 'A footer with the customer’s preference link is added automatically.' : 'Keep “Reply STOP to opt out” in texts. Carriers expect it.'}>
            <textarea ref={textarea} className="min-h-52 w-full rounded-xl border border-line bg-slate-50/50 px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-brand/50 focus:bg-white focus:ring-3 focus:ring-brand/15" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div>
            <div className="mb-2 text-xs font-medium text-muted">Insert a variable</div>
            <div className="flex flex-wrap gap-1.5">
              {variables.map((v) => (
                <button key={v} onClick={() => insert(v)} className={cx('rounded-md border px-2 py-1 font-mono text-[11px]', info.variables.includes(v) ? 'border-brand/30 bg-brand/5 text-brand' : 'border-line text-muted hover:bg-soft')}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="text-xs text-faint">{template.isCustomized ? `Edited ${when(template.updatedAt, tenant.timezone)}` : 'Default wording'}</div>
            <div className="flex gap-2">
              {template.isCustomized && (
                <Button variant="ghost" icon={RotateCcw} onClick={reset}>
                  Reset
                </Button>
              )}
              <Button variant="primary" icon={dirty ? Save : Check} disabled={!dirty} loading={saving} onClick={save}>
                {dirty ? 'Save template' : 'Saved'}
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">Live preview</div>
          {preview ? template.channel === 'sms' ? <SmsBubble body={preview.body} /> : <EmailPreview subject={preview.subject} body={`${preview.body}\n\n--\nYou're receiving this as a ${tenant.name} customer.\nManage your notification preferences: (personal link)`} /> : <Spinner />}
          {preview?.missing.length ? (
            <Warning>
              Unknown variable{preview.missing.length > 1 ? 's' : ''}: {preview.missing.map((m) => `{{${m}}}`).join(', ')}. These would be sent as-is.
            </Warning>
          ) : null}
          {preview?.sms?.encoding === 'UCS-2' && (
            <Warning>
              Contains {preview.sms.nonGsmChars.map((c) => `“${c}”`).join(' ')}, which forces Unicode: 70 characters per segment instead of 160. Swap curly quotes and dashes for plain ones to cut SMS cost.
            </Warning>
          )}
          {preview?.sms && preview.sms.segments > 1 && preview.sms.encoding === 'GSM-7' && <Warning>This text is {preview.sms.segments} segments, so it’s billed as {preview.sms.segments} messages. Shorter keeps costs down.</Warning>}
        </div>
      </div>
    </Card>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
