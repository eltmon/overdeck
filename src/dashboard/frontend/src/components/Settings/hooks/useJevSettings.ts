import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JevSettingsInput, JevSettingsView, JevUsageView } from '../types';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
import { AUTOSAVE_DEBOUNCE_MS } from './useAutosavePipeline';

async function fetchJevSettings(): Promise<JevSettingsView> {
  await ensureDashboardSession();
  const res = await fetch('/api/jev/settings', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch Jev settings (HTTP ${res.status})`);
  return res.json();
}

async function fetchJevUsage(): Promise<JevUsageView | null> {
  await ensureDashboardSession();
  const res = await fetch('/api/jev/usage', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Settings → Background AI's Jev controls (PAN-4508): the route/model/timeout
 * read, and a latest-wins debounced save against the dedicated settings door
 * (never the whole-document settings save). `usage` polls every 60s for the
 * per-feature 24h call summary.
 */
export function useJevSettings() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['jev-settings'], queryFn: fetchJevSettings });
  const { data: usage } = useQuery({
    queryKey: ['jev-usage'],
    queryFn: fetchJevUsage,
    refetchInterval: 60_000,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const pendingRef = useRef<JevSettingsInput | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const drain = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        try {
          await ensureDashboardSession();
          const res = await fetch('/api/jev/settings', {
            method: 'PUT',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify(next),
          });
          const body = await res.json().catch(() => null);
          if (res.ok) {
            setServerError(null);
            queryClient.setQueryData(['jev-settings'], body);
          } else if (res.status === 400) {
            setServerError((body as { error?: string } | null)?.error ?? 'Invalid Jev settings');
          } else {
            setServerError(`Failed to save Jev settings (HTTP ${res.status})`);
          }
        } catch (err) {
          setServerError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    inFlightRef.current = run.finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, [queryClient]);

  const save = useCallback((next: JevSettingsInput, opts: { debounce?: boolean } = {}) => {
    pendingRef.current = next;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (opts.debounce) {
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void drain();
      }, AUTOSAVE_DEBOUNCE_MS);
    } else {
      void drain();
    }
  }, [drain]);

  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      void drain();
    }
  }, [drain]);

  return { settings, usage: usage ?? null, save, serverError };
}
