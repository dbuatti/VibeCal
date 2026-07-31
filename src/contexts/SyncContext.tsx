import { createContext, useContext, ReactNode } from 'react';
import { useSyncCalendars, UseSyncCalendarsReturn } from '@/hooks/useSyncCalendars';

const SyncContext = createContext<UseSyncCalendarsReturn | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const sync = useSyncCalendars();
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useSync(): UseSyncCalendarsReturn {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
