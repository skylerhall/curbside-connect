import { useEffect, useState } from 'react';

// Minimal pushState router — the dashboard has a handful of flat pages.

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event('hc:navigate'));
  window.scrollTo({ top: 0 });
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const read = () => ({ path: window.location.pathname, query: new URLSearchParams(window.location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener('popstate', update);
    window.addEventListener('hc:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hc:navigate', update);
    };
  }, []);
  return loc;
}
