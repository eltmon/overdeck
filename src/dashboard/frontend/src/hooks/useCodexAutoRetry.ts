import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCodexAuthStatus } from './useCodexAuthStatus';
import {
  getPendingCodexSpawn,
  clearPendingCodexSpawn,
} from '../lib/pending-codex-spawn';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import type { StartAgentResponse } from '../types';

export function useCodexAutoRetry() {
  const { data: authStatus } = useCodexAuthStatus();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the re-auth completion endpoint when a pending spawn has a session name.
  useEffect(() => {
    const pending = getPendingCodexSpawn();
    if (!pending?.reauthSessionName) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/settings/codex-reauth/status?session=${encodeURIComponent(pending.reauthSessionName!)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { completed?: boolean };
        if (data.completed) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          retryPendingSpawn(pending.requestBody, queryClient);
        }
      } catch {
        // Ignore polling errors; next tick will retry.
      }
    }, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [authStatus?.status, queryClient]);

  // Fallback: retry when auth status becomes valid without a re-auth session.
  useEffect(() => {
    const pending = getPendingCodexSpawn();
    if (!pending || pending.reauthSessionName) return;
    if (authStatus?.status !== 'valid') return;

    retryPendingSpawn(pending.requestBody, queryClient);
  }, [authStatus?.status, queryClient]);
}

function retryPendingSpawn(
  requestBody: Record<string, unknown>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  clearPendingCodexSpawn();

  fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as StartAgentResponse;
      if (!res.ok) {
        throw new Error(
          data.error || data.hint || `Failed to start agent (${res.status})`,
        );
      }
      toast.success(
        'Agent started automatically after Codex re-authentication',
      );
      await refreshDashboardState(queryClient);
    })
    .catch((err) => {
      toast.error(
        `Auto-retry failed: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 8000 },
      );
    });
}
