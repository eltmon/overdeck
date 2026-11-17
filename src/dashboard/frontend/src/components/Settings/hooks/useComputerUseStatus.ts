import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

/** Copy of src/lib/computer-use/status.ts's ComputerUseStatusView (PAN-5461 WI-3b). */
export interface ComputerUseStatusView {
  platform: 'linux' | 'wsl' | 'darwin' | 'unsupported';
  supported: boolean;
  enabled: boolean;
  hostname: string;
  session: { ok: true; label: string } | { ok: false; message: string };
  checks: Array<{
    id: string;
    label: string;
    status: 'ok' | 'action' | 'missing' | 'unavailable';
    detail: string;
    fixCommand?: string;
  }>;
  setupSteps: Array<{
    id: 'install-packages' | 'enable-accessibility' | 'grant-permissions' | 'enable-flag' | 'test-helper';
    label: string;
    needsPassword?: boolean;
  }>;
  lease: { holder: string; expiresAt: string } | null;
  skill: { installed: boolean; locations: string[] };
}

export interface ComputerUseSetupStepReport {
  id: ComputerUseStatusView['setupSteps'][number]['id'];
  label: string;
  status: 'done' | 'skipped' | 'failed' | 'waiting';
  message?: string;
  command?: string;
}

/** Copy of src/lib/computer-use/setup.ts's SetupResult (PAN-5461 WI-4b). */
export interface ComputerUseSetupResult {
  ok: boolean;
  steps: ComputerUseSetupStepReport[];
  status: ComputerUseStatusView;
  message?: string;
}

export const COMPUTER_USE_STATUS_KEY = ['computer-use', 'status'] as const;

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `${fallback} (HTTP ${res.status})`);
}

async function fetchComputerUseStatus(): Promise<ComputerUseStatusView> {
  await ensureDashboardSession();
  const res = await fetch('/api/computer-use/status', { credentials: 'include' });
  if (!res.ok) throw await errorFrom(res, 'Failed to read Computer Use status');
  return res.json();
}

async function mutate<T>(method: 'POST' | 'PUT', path: string, body: unknown, fallback: string): Promise<T> {
  await ensureDashboardSession();
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res, fallback);
  return res.json();
}

/**
 * Settings → Computer Use data (PAN-5461 WI-6a): the host's status view plus the
 * Setup, on/off and release actions. Each action writes the status it gets back
 * into the query cache. Polls every 5 s only while an agent holds the desktop.
 */
export function useComputerUseStatus() {
  const queryClient = useQueryClient();
  const { data: status, error: loadErrorObj, isFetching, refetch } = useQuery({
    queryKey: COMPUTER_USE_STATUS_KEY,
    queryFn: fetchComputerUseStatus,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.lease ? 5000 : false),
  });

  const [setupResult, setSetupResult] = useState<ComputerUseSetupResult | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const writeStatus = async (next: ComputerUseStatusView) => {
    await queryClient.cancelQueries({ queryKey: COMPUTER_USE_STATUS_KEY });
    queryClient.setQueryData(COMPUTER_USE_STATUS_KEY, next);
  };

  const runSetup = async (): Promise<ComputerUseSetupResult | null> => {
    setSettingUp(true);
    setActionError(null);
    setSetupResult(null);
    // No try/finally: the React Compiler can't lower a finally clause.
    let result: ComputerUseSetupResult | null = null;
    try {
      result = await mutate<ComputerUseSetupResult>('POST', '/api/computer-use/setup', {}, 'Setup failed');
      setSetupResult(result);
      await writeStatus(result.status);
      if (result.message) setActionError(result.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      result = null;
    }
    setSettingUp(false);
    return result;
  };

  const runAction = async (method: 'POST' | 'PUT', path: string, body: unknown, fallback: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    let ok = false;
    try {
      await writeStatus(await mutate<ComputerUseStatusView>(method, path, body, fallback));
      ok = true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
    return ok;
  };

  const setEnabled = (enabled: boolean) => {
    // A flipped switch supersedes the last setup run's stalled step list.
    setSetupResult(null);
    return runAction('PUT', '/api/computer-use/settings', { enabled }, 'Failed to save Computer Use setting');
  };

  const release = () => runAction('POST', '/api/computer-use/release', {}, 'Failed to release the desktop');

  /** macOS (PAN-5463): opens one System Settings permission pane on the host. */
  const openPermission = (id: 'accessibility' | 'screen-recording') =>
    runAction('POST', '/api/computer-use/open-permission', { id }, 'Failed to open System Settings');

  return {
    status,
    loadError: loadErrorObj ? (loadErrorObj instanceof Error ? loadErrorObj.message : String(loadErrorObj)) : null,
    refreshing: isFetching,
    refresh: () => void refetch(),
    runSetup,
    settingUp,
    setupResult,
    setEnabled,
    release,
    openPermission,
    busy,
    actionError,
  };
}
