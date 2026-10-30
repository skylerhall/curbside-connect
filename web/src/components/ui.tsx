import { Loader2, Mail, MessageSquare, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MessageStatus } from '../../../shared/types.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ── Buttons ────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: 'bg-brand text-white shadow-sm shadow-brand/20 hover:brightness-110 disabled:opacity-50',
    accent: 'bg-accent text-brand-dark shadow-sm shadow-accent/30 hover:brightness-105 disabled:opacity-50',
    secondary: 'border border-line bg-white text-ink hover:bg-soft disabled:opacity-50',
    ghost: 'text-brand hover:bg-brand/8 disabled:opacity-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50',
  }[variant];
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-sm gap-2' }[size];
  return (
    <button {...rest} disabled={disabled || loading} className={cx('inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition', styles, sizes, className)}>
      {loading ? <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="text-2xl font-bold tracking-tight md:text-[28px]">{title}</h2>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className, bodyClassName, icon: Icon }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string; icon?: LucideIcon }) {
  return (
    <section className={cx('min-w-0 rounded-2xl border border-line bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
          <div className="flex items-start gap-3">
            {Icon && (
              <div className="mt-0.5 rounded-lg bg-brand/10 p-2 text-brand">
                <Icon size={16} />
              </div>
            )}
            <div>
              {title && <h3 className="font-semibold">{title}</h3>}
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={cx(bodyClassName ?? 'p-5')}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, note, icon: Icon, tone = 'brand' }: { label: string; value: ReactNode; note?: ReactNode; icon?: LucideIcon; tone?: 'brand' | 'amber' | 'blue' | 'red' }) {
  const tones = { brand: 'bg-brand/10 text-brand', amber: 'bg-amber-100 text-amber-700', blue: 'bg-sky-100 text-sky-700', red: 'bg-red-100 text-red-700' }[tone];
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        {Icon && (
          <div className={cx('rounded-lg p-2', tones)}>
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="font-display text-[28px] font-bold leading-none tracking-tight">{value}</div>
      {note && <div className="mt-2 text-xs text-faint">{note}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 rounded-2xl bg-soft p-4 text-muted">
        <Icon size={22} />
      </div>
      <div className="font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 size={16} className="animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
}

// ── Badges & status ────────────────────────────────────────────────────────

export type Tone = 'green' | 'amber' | 'blue' | 'red' | 'gray' | 'brand' | 'purple';

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    blue: 'bg-sky-50 text-sky-700 ring-sky-600/15',
    red: 'bg-red-50 text-red-700 ring-red-600/15',
    gray: 'bg-slate-100 text-slate-600 ring-slate-500/10',
    brand: 'bg-brand/10 text-brand ring-brand/15',
    purple: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  };
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

const STATUS: Record<MessageStatus, { tone: Tone; label: string }> = {
  queued: { tone: 'gray', label: 'Queued' },
  sent: { tone: 'blue', label: 'Sent' },
  delivered: { tone: 'green', label: 'Delivered' },
  failed: { tone: 'red', label: 'Failed' },
  skipped: { tone: 'amber', label: 'Not sent' },
  cancelled: { tone: 'gray', label: 'Cancelled' },
};

export function StatusPill({ status }: { status: MessageStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone}>
      <span className={cx('h-1.5 w-1.5 rounded-full bg-current', (status === 'queued' || status === 'sent') && 'animate-pulse')} />
      {s.label}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: 'sms' | 'email' | null }) {
  if (!channel) return <span className="text-xs text-faint">-</span>;
  return channel === 'sms' ? (
    <Badge tone="purple">
      <MessageSquare size={11} /> SMS
    </Badge>
  ) : (
    <Badge tone="blue">
      <Mail size={11} /> Email
    </Badge>
  );
}

export function ConsentDots({ sms, email }: { sms: boolean; email: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span title={sms ? 'SMS opted in' : 'No SMS consent'} className={cx('grid h-6 w-6 place-items-center rounded-md', sms ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-300')}>
        <MessageSquare size={12} />
      </span>
      <span title={email ? 'Email opted in' : 'No email consent'} className={cx('grid h-6 w-6 place-items-center rounded-md', email ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-300')}>
        <Mail size={12} />
      </span>
    </div>
  );
}

// ── Form controls ──────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, disabled, label, small }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; small?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex shrink-0 items-center rounded-full transition disabled:opacity-40', small ? 'h-5 w-9' : 'h-6 w-11', checked ? 'bg-brand' : 'bg-slate-300')}
    >
      <span className={cx('inline-block rounded-full bg-white shadow transition', small ? 'h-4 w-4' : 'h-5 w-5', checked ? (small ? 'translate-x-4.5' : 'translate-x-5.5') : 'translate-x-0.5')} />
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass = 'h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none transition placeholder:text-faint focus:border-brand/50 focus:ring-3 focus:ring-brand/15';

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-line bg-soft p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', value === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition', value === t.value ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-soft px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Overlays ───────────────────────────────────────────────────────────────

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

export function Drawer({ open, onClose, title, subtitle, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  // Portalled to <body> so a drawer or modal opened from inside another always covers the whole page.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-brand-dark/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={cx('animate-slide-in relative flex h-full w-full flex-col bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-soft" aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pb-72 md:items-center lg:pb-4">
      <div className="fixed inset-0 bg-brand-dark/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('animate-rise relative my-8 w-full rounded-2xl bg-white shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-soft" aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'error' | 'info';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'animate-rise pointer-events-auto rounded-xl border px-4 py-3 text-sm font-medium shadow-lg',
              t.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              t.tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
              t.tone === 'info' && 'border-line bg-white text-ink',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
