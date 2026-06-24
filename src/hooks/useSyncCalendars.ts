import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { showError } from '@/utils/toast';

const STORAGE_KEY = 'vibecal_last_synced_at';

export interface SyncResult {
  success: boolean;
  tokenMissing: boolean;
}

export interface UseSyncCalendarsReturn {
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  syncCalendars: (opts?: { timeMin?: string; timeMax?: string }) => Promise<SyncResult>;
}

function loadLastSynced(): Date | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Date(raw) : null;
  } catch {
    return null;
  }
}

function saveLastSynced() {
  try {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
    // localStorage unavailable
  }
}

export function useSyncCalendars(): UseSyncCalendarsReturn {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(loadLastSynced);

  const syncCalendars = useCallback(async (opts?: { timeMin?: string; timeMax?: string }): Promise<SyncResult> => {
    setIsSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let token = session?.provider_token;
      if (!token) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('google_access_token')
          .eq('id', user.id)
          .single();
        token = profile?.google_access_token;
      }

      const googleBody: Record<string, unknown> = {};
      if (token) googleBody.googleAccessToken = token;
      if (opts?.timeMin) googleBody.timeMin = opts.timeMin;
      if (opts?.timeMax) googleBody.timeMax = opts.timeMax;

      const appleBody: Record<string, unknown> = {};
      if (opts?.timeMin) appleBody.timeMin = opts.timeMin;
      if (opts?.timeMax) appleBody.timeMax = opts.timeMax;

      const results = await Promise.allSettled([
        supabase.functions.invoke('sync-calendar', {
          body: Object.keys(googleBody).length > 0 ? googleBody : {},
        }),
        supabase.functions.invoke('sync-apple-calendar', {
          body: Object.keys(appleBody).length > 0 ? appleBody : {},
        }),
      ]);

      const googleResult = results[0];
      const appleResult = results[1];
      let googleError: string | null = null;
      let appleError: string | null = null;

      if (googleResult.status === 'fulfilled') {
        const data = googleResult.value.data as Record<string, unknown> | undefined;
        const err = googleResult.value.error;
        if (err) {
          googleError = typeof err === 'string' ? err : (err as { message?: string }).message || 'Google sync failed';
          const msg = googleError.toLowerCase();
          if (msg.includes('401') || msg.includes('unauthorized') || googleError === 'auth_expired') {
            setIsSyncing(false);
            return { success: false, tokenMissing: true };
          }
        } else if (data?.error) {
          googleError = String(data.error);
        }
      } else {
        googleError = 'Google sync rejected';
      }

      if (appleResult.status === 'fulfilled') {
        const data = appleResult.value.data as Record<string, unknown> | undefined;
        const err = appleResult.value.error;
        if (err) {
          appleError = typeof err === 'string' ? err : (err as { message?: string }).message || 'Apple sync failed';
        } else if (data?.error) {
          appleError = String(data.error);
        }
      } else {
        appleError = 'Apple sync rejected';
      }

      if (googleError && appleError) {
        showError(`Sync failed: ${googleError} / ${appleError}`);
        setIsSyncing(false);
        return { success: false, tokenMissing: false };
      }

      const now = new Date();
      setLastSyncedAt(now);
      saveLastSynced();
      setIsSyncing(false);
      return { success: true, tokenMissing: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      showError('Sync failed: ' + msg);
      setIsSyncing(false);
      return { success: false, tokenMissing: false };
    }
  }, []);

  return { isSyncing, lastSyncedAt, syncCalendars };
}
