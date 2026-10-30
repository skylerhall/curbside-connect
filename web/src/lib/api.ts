import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function tenantHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem('hc_tenant');
    return t ? { 'x-tenant': t } : {};
  } catch {
    return {};
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...tenantHeader() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('hc:unauthorized'));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Fetches `path` and refetches when it changes. Pass null to skip. */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (current.current === path) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(Boolean(path));
    void reload();
  }, [reload, path]);

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const id = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, path, reload]);

  return { data, error, loading, reload };
}
