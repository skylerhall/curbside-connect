import { smsSegments } from '../../../shared/catalog.ts';
import { useApp } from '../lib/app-context.ts';
import { cx } from './ui.tsx';

/** Phone-style text bubble. */
export function SmsBubble({ body, to, compact }: { body: string; to?: string | null; compact?: boolean }) {
  const { tenant, smsCostPerSegment } = useApp();
  const seg = smsSegments(body);
  return (
    <div className={cx('rounded-[28px] border border-line bg-gradient-to-b from-slate-50 to-white p-4', !compact && 'shadow-inner')}>
      <div className="mb-3 flex items-center justify-center gap-2 text-[11px] text-faint">
        <div className="grid h-6 w-6 place-items-center rounded-full bg-brand-dark text-[9px] font-bold text-accent">{tenant.logoInitials}</div>
        <span className="font-semibold text-muted">{tenant.name}</span>
        {to && <span>→ {to}</span>}
      </div>
      <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-slate-200/70 px-3.5 py-2.5 text-[13.5px] leading-snug text-slate-900">{body}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>{seg.length} chars</span>
        <span className={cx(seg.segments > 1 && 'font-semibold text-amber-700')}>
          {seg.segments} segment{seg.segments === 1 ? '' : 's'} · ~${(seg.segments * smsCostPerSegment).toFixed(3)}/text
        </span>
        {seg.encoding === 'UCS-2' && <span className="font-semibold text-amber-700">Unicode ({seg.nonGsmChars.join(' ')})</span>}
      </div>
    </div>
  );
}

/** Inbox-style email preview. */
export function EmailPreview({ subject, body, to }: { subject: string | null; body: string; to?: string | null }) {
  const { tenant } = useApp();
  const [main, footer] = body.split('\n\n--\n');
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-center gap-2.5 bg-brand-dark px-4 py-3 text-sm font-semibold text-white">
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-bold text-brand-dark">{tenant.logoInitials}</span>
        {tenant.name}
      </div>
      <div className="border-b border-line px-4 py-2.5 text-xs text-muted">
        {to && (
          <div>
            <span className="text-faint">To:</span> {to}
          </div>
        )}
        <div className="font-semibold text-ink">{subject}</div>
      </div>
      <div className="whitespace-pre-wrap px-4 py-3.5 text-[13.5px] leading-relaxed">{main}</div>
      {footer && <div className="whitespace-pre-wrap border-t border-line bg-slate-50 px-4 py-2.5 text-[11px] leading-relaxed text-faint">{footer}</div>}
    </div>
  );
}
