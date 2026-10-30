import { createContext, useContext } from 'react';
import type { TemplateInfo } from '../../../shared/catalog.ts';
import type { ProviderStatus, Route, Tenant } from '../../../shared/types.ts';

export interface Bootstrap {
  tenant: Tenant;
  tenants: { slug: string; name: string }[];
  providers: ProviderStatus;
  today: string;
  routes: Route[];
  catalog: TemplateInfo[];
  smsCostPerSegment: number;
  authRequired: boolean;
}

export const AppContext = createContext<(Bootstrap & { reload: () => Promise<void> }) | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}
