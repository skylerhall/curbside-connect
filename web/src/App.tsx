import {
  Activity as ActivityIcon,
  BellRing,
  Compass,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  MessageSquareText,
  Settings as SettingsIcon,
  ShieldCheck,
  Siren,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Tour } from './components/Tour.tsx';
import { Button, ToastProvider, cx } from './components/ui.tsx';
import { api, useApi } from './lib/api.ts';
import { AppContext, type Bootstrap } from './lib/app-context.ts';
import { navigate, useLocation } from './lib/router.ts';
import { startTour } from './lib/tour.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { AlertsPage } from './pages/Alerts.tsx';
import { BillingPage } from './pages/Billing.tsx';
import { CustomersPage } from './pages/Customers.tsx';
import { LoginPage } from './pages/Login.tsx';
import { OverviewPage } from './pages/Overview.tsx';
import { PreferencePage } from './pages/PreferencePage.tsx';
import { PreferencesPage } from './pages/Preferences.tsx';
import { RemindersPage } from './pages/Reminders.tsx';
import { RoutesPage } from './pages/Routes.tsx';
import { SchedulePage } from './pages/Schedule.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { TemplatesPage } from './pages/Templates.tsx';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  page: () => React.JSX.Element;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Operations',
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard, page: OverviewPage },
      { path: '/schedule', label: 'Service schedule', icon: CalendarDays, page: SchedulePage },
      { path: '/reminders', label: 'Pickup reminders', icon: BellRing, page: RemindersPage },
      { path: '/billing', label: 'Billing reminders', icon: WalletCards, page: BillingPage },
      { path: '/alerts', label: 'Weather & emergency', icon: Siren, page: AlertsPage },
    ],
  },
  {
    section: 'Customers',
    items: [
      { path: '/customers', label: 'Customers', icon: Users, page: CustomersPage },
      { path: '/routes', label: 'Routes', icon: MapIcon, page: RoutesPage },
      { path: '/preferences', label: 'Consent & preferences', icon: ShieldCheck, page: PreferencesPage },
    ],
  },
  {
    section: 'Messaging',
    items: [
      { path: '/templates', label: 'Message templates', icon: MessageSquareText, page: TemplatesPage },
      { path: '/activity', label: 'Delivery log', icon: ActivityIcon, page: ActivityPage },
      { path: '/settings', label: 'Settings', icon: SettingsIcon, page: SettingsPage },
    ],
  },
];

const ALL = NAV.flatMap((s) => s.items);

export function App() {
  const { path } = useLocation();
  if (path.startsWith('/p/')) return <PreferencePage token={path.slice(3)} />;
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

function Dashboard() {
  const session = useApi<{ authenticated: boolean; required: boolean }>('/session');
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (session.data) setAuthed(session.data.authenticated);
  }, [session.data]);

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener('hc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hc:unauthorized', onUnauthorized);
  }, []);

  if (authed === null) return <Splash />;
  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />;
  return <Shell />;
}

function Splash() {
  return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>;
}

function Shell() {
  const boot = useApi<Bootstrap>('/bootstrap');
  const { path } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const t = boot.data?.tenant;
    if (!t) return;
    const root = document.documentElement.style;
    root.setProperty('--brand', t.brandPrimary);
    root.setProperty('--brand-dark', t.brandDark);
    root.setProperty('--brand-accent', t.brandAccent);
    document.title = `${t.shortName} Connect · Demo`;
  }, [boot.data?.tenant]);

  useEffect(() => setMenuOpen(false), [path]);

  if (boot.error) return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-red-700">{boot.error}</div>;
  if (!boot.data) return <Splash />;

  const { tenant, providers } = boot.data;
  const current = ALL.find((i) => i.path === path) ?? ALL[0];
  const Page = current.page;
  const live = providers.sms.live || providers.email.live;

  const sidebar = (
    <div className="flex h-full flex-col px-4 py-6 text-white">
      <button onClick={() => navigate('/')} className="mb-8 flex items-center gap-3 px-2 text-left">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-sm font-black text-brand-dark">{tenant.logoInitials}</div>
        <div>
          <div className="font-display font-bold leading-tight tracking-tight">{tenant.shortName}</div>
          <div className="text-xs text-white/55">Connect · Customer notifications</div>
        </div>
      </button>
      <nav className="scrollbar-thin -mx-1 flex-1 space-y-6 overflow-y-auto px-1">
        {NAV.map((section) => (
          <div key={section.section}>
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[.16em] text-white/40">{section.section}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <button
                  key={item.path}
                  data-tour={item.path === '/activity' ? 'nav-activity' : undefined}
                  onClick={() => navigate(item.path)}
                  className={cx(
                    'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                    item.path === current.path
                      ? 'bg-white/12 font-medium text-white shadow-sm before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent'
                      : 'text-white/70 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <item.icon size={17} className={item.path === current.path ? 'text-accent' : undefined} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={() => navigate('/settings')} className="mt-4 rounded-2xl border border-white/10 bg-white/6 p-4 text-left hover:bg-white/10">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={cx('h-2 w-2 rounded-full', live ? 'animate-pulse bg-amber-300' : 'bg-emerald-300')} />
          {live ? 'Live delivery on' : 'Simulation mode'}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-white/55">
          {live ? 'Allowlisted recipients get real messages. Everyone else is simulated.' : 'No messages leave this demo. All customers are fictional.'}
        </p>
      </button>
    </div>
  );

  return (
    <AppContext.Provider value={{ ...boot.data, reload: boot.reload }}>
      <div className="min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-68 bg-brand-dark lg:block">{sidebar}</aside>
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
            <aside className="animate-slide-in absolute inset-y-0 left-0 w-72 bg-brand-dark">{sidebar}</aside>
          </div>
        )}
        <div className="lg:pl-68">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line border-t-[3px] border-t-accent bg-white/90 px-4 backdrop-blur md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button className="rounded-lg p-2 hover:bg-soft lg:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[.15em] text-faint">{tenant.name}</p>
                <h1 className="truncate text-base font-bold tracking-tight">{current.label}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button size="sm" variant="ghost" icon={Compass} onClick={startTour}>
                Guided tour
              </Button>
              <span className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/20 sm:inline">Demo · fictional customer data</span>
              {boot.data.authRequired && (
                <button
                  title="Sign out"
                  onClick={async () => {
                    await api('/auth/logout', { method: 'POST', body: {} });
                    window.location.reload();
                  }}
                  className="rounded-lg p-2 text-muted hover:bg-soft"
                >
                  <LogOut size={18} />
                </button>
              )}
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
            <Page key={tenant.id + current.path} />
          </main>
        </div>
        <Tour />
      </div>
    </AppContext.Provider>
  );
}
