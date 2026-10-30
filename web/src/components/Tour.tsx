import { ArrowRight, Check, ChevronDown, ChevronUp, Compass, ExternalLink, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Customer } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { navigate, useLocation } from '../lib/router.ts';
import type { TourSignal } from '../lib/tour.ts';
import { Button, Modal, cx } from './ui.tsx';

const SEEN_KEY = 'hc_tour_seen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // private mode etc. — the welcome may simply show again next visit
  }
}

interface Step {
  title: string;
  body: ReactNode;
  /** data-tour attribute of the element to pulse. */
  target?: string;
  action?: { label: string; to: string };
  manualNext?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'A snow day hits one route',
    body: (
      <>
        Start where the office would: click <b>Change a pickup</b>.
      </>
    ),
    target: 'change-pickup',
    action: { label: 'Open it for me', to: '/schedule?new=1' },
  },
  {
    title: 'Say what changed',
    body: (
      <>
        Tomorrow’s route is already selected. Keep <b>Snow and icy roads</b> (or pick another reason), then click <b>Update schedule &amp; find affected customers</b>.
      </>
    ),
    target: 'update-schedule',
  },
  {
    title: 'See exactly who hears about it',
    body: (
      <>
        Every customer on that route was found and checked for consent. Review the text and email they’ll get, and who can’t be reached and why. Then click <b>Notify</b>.
      </>
    ),
    target: 'notify-send',
  },
  {
    title: 'A safety net, then delivery',
    body: (
      <>
        Every send waits 60 seconds so a mistake can be <b>cancelled</b> before anyone gets it. Click <b>Send now</b> to skip the wait, then watch messages go from Sent to Delivered. Two fail on purpose, like real life. Sent something wrong? <b>Send a correction</b> reaches just those people.
      </>
    ),
    manualNext: true,
  },
  {
    title: 'Everything is on the record',
    body: <>The delivery log keeps every message, its status history, and every customer who wasn’t contacted and why.</>,
    target: 'nav-activity',
    action: { label: 'Open the delivery log', to: '/activity' },
  },
  {
    title: 'That’s the core idea',
    body: <>One schedule change, only the right customers, every delivery documented. A few more things to try:</>,
  },
];

export function Tour() {
  const { tenant, routes } = useApp();
  const { path } = useLocation();
  const [welcome, setWelcome] = useState(() => !readSeen());
  const [step, setStep] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const start = useCallback(() => {
    markSeen();
    setWelcome(false);
    setCollapsed(false);
    setStep(0);
    if (window.location.pathname !== '/') navigate('/');
  }, []);

  const finish = useCallback(() => {
    markSeen();
    setStep(null);
  }, []);

  // Advance automatically as the visitor does each thing.
  useEffect(() => {
    const onSignal = (e: Event) => {
      const signal = (e as CustomEvent<TourSignal>).detail;
      setStep((s) => {
        if (s === null) return s;
        if (signal === 'wizard_opened' && s === 0) return 1;
        if (signal === 'schedule_updated' && s <= 1) return 2;
        if (signal === 'notified' && s <= 2) return 3;
        if (signal === 'wizard_closed' && (s === 1 || s === 2)) return 0;
        return s;
      });
    };
    const onStart = () => start();
    window.addEventListener('hc:tour', onSignal);
    window.addEventListener('hc:tour-start', onStart);
    return () => {
      window.removeEventListener('hc:tour', onSignal);
      window.removeEventListener('hc:tour-start', onStart);
    };
  }, [start]);

  useEffect(() => {
    if (path === '/activity') setStep((s) => (s !== null && s >= 3 && s < 5 ? 5 : s));
  }, [path]);

  // Pulse the element the current step is about.
  useEffect(() => {
    const target = step !== null ? STEPS[step].target : undefined;
    if (target) document.body.dataset.tourTarget = target;
    else delete document.body.dataset.tourTarget;
    return () => {
      delete document.body.dataset.tourTarget;
    };
  }, [step]);

  const openCustomerView = async () => {
    const customers = await api<Customer[]>('/customers?consent=email');
    const c = customers[0];
    if (c) window.open(`/p/${c.preferenceToken}`, '_blank');
  };

  const current = step !== null ? STEPS[step] : null;
  const routeCount = routes.length;

  return (
    <>
      <Modal
        open={welcome}
        onClose={() => {
          markSeen();
          setWelcome(false);
        }}
        title={`Welcome to the ${tenant.shortName} notification demo`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                markSeen();
                setWelcome(false);
              }}
            >
              Explore on my own
            </Button>
            <Button variant="accent" icon={Compass} onClick={start}>
              Start the 2-minute tour
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm leading-relaxed">
          <p>
            This is a working concept of <b>automatic texts and emails</b> for {tenant.name} customers. When a holiday, snowstorm or route change moves a pickup, or a bill is coming due, the right customers hear about it on their own, and the office has a record of every message.
          </p>
          <ul className="space-y-2.5">
            <WelcomePoint>The office controls everything from this dashboard. Customers don’t need an app or a login; they just get a text or email.</WelcomePoint>
            <WelcomePoint>
              Everything here is <b>fictional</b>: {routeCount} routes of made-up customers. <b>Nothing is actually sent.</b> Click anything you like.
            </WelcomePoint>
            <WelcomePoint>The tour walks through a snow-day delay from start to finish.</WelcomePoint>
          </ul>
        </div>
      </Modal>

      {current && step !== null && (
        <div className="fixed inset-x-3 bottom-3 z-[55] lg:inset-x-auto lg:left-3 lg:w-[248px]">
          <div className="animate-rise overflow-hidden rounded-2xl border border-accent/60 bg-white shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-2 bg-brand-dark px-3.5 py-2.5 text-white">
              <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setCollapsed((v) => !v)}>
                <Compass size={15} className="shrink-0 text-accent" />
                <span className="truncate text-xs font-semibold">
                  Tour · {step + 1} of {STEPS.length}
                </span>
                {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button onClick={finish} className="rounded p-0.5 text-white/60 hover:text-white" aria-label="End tour">
                <X size={15} />
              </button>
            </div>
            {!collapsed && (
              <div className="p-3.5">
                <div className="mb-2 flex gap-1">
                  {STEPS.map((_, i) => (
                    <span key={i} className={cx('h-1 flex-1 rounded-full', i <= step ? 'bg-brand' : 'bg-slate-200')} />
                  ))}
                </div>
                <div className="font-semibold leading-snug">{current.title}</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{current.body}</div>
                {step === STEPS.length - 1 && (
                  <ul className="mt-2.5 space-y-1 text-[13px]">
                    <ExploreLink onClick={() => navigate('/schedule')}>Plan the Thanksgiving holiday schedule</ExploreLink>
                    <ExploreLink onClick={() => navigate('/billing')}>Send bill and autopay reminders</ExploreLink>
                    <ExploreLink onClick={() => navigate('/alerts')}>Send a weather alert</ExploreLink>
                    <ExploreLink onClick={() => navigate('/templates')}>Edit the message wording</ExploreLink>
                    <ExploreLink onClick={openCustomerView} external>
                      See a customer’s preference page
                    </ExploreLink>
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {current.action && path + window.location.search !== current.action.to && (
                    <Button size="sm" variant="primary" onClick={() => navigate(current.action!.to)}>
                      {current.action.label}
                    </Button>
                  )}
                  {current.manualNext && (
                    <Button size="sm" variant="primary" icon={ArrowRight} onClick={() => setStep(step + 1)}>
                      Next
                    </Button>
                  )}
                  {step === STEPS.length - 1 && (
                    <Button size="sm" variant="primary" icon={Check} onClick={finish}>
                      Finish
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function WelcomePoint({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="text-muted">{children}</span>
    </li>
  );
}

function ExploreLink({ children, onClick, external }: { children: ReactNode; onClick: () => void; external?: boolean }) {
  return (
    <li>
      <button onClick={onClick} className="flex items-center gap-1.5 text-left font-medium text-brand hover:underline">
        {external ? <ExternalLink size={12} /> : <ArrowRight size={12} />}
        {children}
      </button>
    </li>
  );
}
