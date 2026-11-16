import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

export interface SemgrepSettingsView {
  enabled: boolean;
  mcp: boolean;
  edit_hook: boolean;
  gate: 'off' | 'advisory' | 'blocking';
  severity: 'INFO' | 'WARNING' | 'ERROR';
  configs: string[];
  timeout_seconds: number;
  pinnedVersion: string;
}

export type SemgrepSettingsPatch = Partial<Omit<SemgrepSettingsView, 'pinnedVersion'>>;

interface PrereqToolStatus {
  tool: string;
  installed: boolean;
  installable: boolean;
}

interface PrereqFeatureStatus {
  tools: PrereqToolStatus[];
}

async function fetchSemgrepSettings(): Promise<SemgrepSettingsView> {
  await ensureDashboardSession();
  const res = await fetch('/api/semgrep/settings', { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to fetch Semgrep settings (HTTP ${res.status})`);
  }
  return res.json();
}

async function fetchSemgrepInstallStatus(): Promise<PrereqFeatureStatus> {
  await ensureDashboardSession();
  const res = await fetch('/api/prereqs/useSemgrep', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch Semgrep install status (HTTP ${res.status})`);
  return res.json();
}

/**
 * Settings → Security's Semgrep controls (PAN-4594): reads/writes `security.semgrep`
 * through the dedicated settings door, and drives the managed install button.
 */
export function useSemgrepSettings() {
  const queryClient = useQueryClient();
  const { data: settings, error: loadErrorObj } = useQuery({
    queryKey: ['semgrep-settings'],
    queryFn: fetchSemgrepSettings,
  });
  const {
    data: installStatus,
    error: installStatusErrorObj,
    isFetching: installStatusFetching,
    refetch: refetchInstallStatus,
  } = useQuery({
    queryKey: ['semgrep-install-status'],
    queryFn: fetchSemgrepInstallStatus,
    enabled: settings?.enabled === true,
    refetchOnWindowFocus: false,
    // NFR-2: no refetchInterval. Reads happen on mount, after an `enabled` change, and
    // once after an install request (including a dropped one, D12) — never on a timer.
  });
  const installed = settings?.enabled ? installStatus?.tools.find((t) => t.tool === 'semgrep')?.installed : undefined;
  const installStatusError = settings?.enabled && installStatusErrorObj
    ? (installStatusErrorObj instanceof Error ? installStatusErrorObj.message : String(installStatusErrorObj))
    : null;

  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef<SemgrepSettingsPatch | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const drain = (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        try {
          await ensureDashboardSession();
          const res = await fetch('/api/semgrep/settings', {
            method: 'PUT',
            credentials: 'include',
            headers: await dashboardMutationJsonHeaders(),
            body: JSON.stringify(next),
          });
          const body = await res.json().catch(() => null);
          if (res.ok) {
            setServerError(null);
            queryClient.setQueryData(['semgrep-settings'], body);
            if ('enabled' in next) void queryClient.invalidateQueries({ queryKey: ['semgrep-install-status'] });
          } else if (res.status === 400) {
            setServerError((body as { error?: string } | null)?.error ?? 'Invalid Semgrep settings');
          } else {
            setServerError(`Failed to save Semgrep settings (HTTP ${res.status})`);
          }
        } catch (err) {
          setServerError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    inFlightRef.current = run.finally(() => {
      inFlightRef.current = null;
      setSaving(pendingRef.current !== null);
    });
    return inFlightRef.current;
  };

  const save = (patch: SemgrepSettingsPatch) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    setSaving(true);
    void drain();
  };

  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const install = () => {
    setInstalling(true);
    void (async () => {
      try {
        await ensureDashboardSession();
        const res = await fetch('/api/prereqs/install', {
          method: 'POST',
          credentials: 'include',
          headers: await dashboardMutationJsonHeaders(),
          body: JSON.stringify({ tool: 'semgrep' }),
        });
        const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
        setInstallMessage(body?.message ?? `Install request ended (HTTP ${res.status})`);
      } catch {
        setInstallMessage('The install request ended without an answer; checking the install state…');
      }
      setInstalling(false);
      void queryClient.invalidateQueries({ queryKey: ['semgrep-install-status'] });
    })();
  };

  return {
    settings,
    loadError: loadErrorObj ? (loadErrorObj instanceof Error ? loadErrorObj.message : String(loadErrorObj)) : null,
    save,
    saving,
    serverError,
    installed,
    installStatusError,
    installStatusFetching,
    retryInstallStatus: () => void refetchInstallStatus(),
    install,
    installing,
    installMessage,
  };
}
