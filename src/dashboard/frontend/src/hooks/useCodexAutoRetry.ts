import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCodexAuthStatus } from './useCodexAuthStatus';
import {
  getPendingCodexSpawn,
  clearPendingCodexSpawn,
  clearPendingCodexReauthSession,
} from '../lib/pending-codex-spawn';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import type { StartAgentResponse } from '../types';

export function useCodexAutoRetry() {
  const { data: authStatus } = useCodexAuthStatus();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryInFlightRef = useRef(false);

  // Poll the re-auth completion endpoint when a pending spawn has a session name.
  useEffect(() => {
    if (retryInFlightRef.current) return;
    const pending = getPendingCodexSpawn();
    if (!pending?.reauthSessionName || !pending.reauthStatusToken) return;
    const reauthSessionName = pending.reauthSessionName;
    const reauthStatusToken = pending.reauthStatusToken;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(async () => {
      if (retryInFlightRef.current) return;
      try {
        const res = await fetch('/api/settings/codex-reauth/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: reauthSessionName, token: reauthStatusToken }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          completed?: boolean;
          success?: boolean;
          authStatus?: { status?: string; message?: string };
          error?: string;
        };
        if (data.completed) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          if (data.success !== true || data.authStatus?.status !== 'valid') {
            clearPendingCodexReauthSession();
            toast.error(
              data.error || data.authStatus?.message || 'Codex re-authentication did not produce valid auth',
              { duration: 8000 },
            );
            await refreshDashboardState(queryClient);
            return;
          }
          // Guard before updating the auth cache so a later poll cycle cannot
          // observe valid auth + pending spawn and launch a duplicate retry.
          retryInFlightRef.current = true;
          queryClient.setQueryData(['codex-auth-status'], data.authStatus);
          const currentPending = getPendingCodexSpawn();
          if (currentPending?.requestBody) {
            void retryPendingSpawn(currentPending.requestBody, queryClient)
              .finally(() => {
                retryInFlightRef.current = false;
              });
          } else {
            clearPendingCodexSpawn();
            toast.success('Codex re-authentication completed');
            await refreshDashboardState(queryClient);
            retryInFlightRef.current = false;
          }
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
    if (retryInFlightRef.current) return;
    const pending = getPendingCodexSpawn();
    if (!pending?.requestBody || pending.reauthSessionName) return;
    if (authStatus?.status !== 'valid') return;

    retryInFlightRef.current = true;
    void retryPendingSpawn(pending.requestBody, queryClient)
      .finally(() => {
        retryInFlightRef.current = false;
      });
  }, [authStatus?.status, queryClient]);
}

async function retryPendingSpawn(
  requestBody: Record<string, unknown>,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = (await res.json().catch(() => ({}))) as StartAgentResponse;
    if (!res.ok) {
      throw new Error(
        data.error || data.hint || `Failed to start agent (${res.status})`,
      );
    }
    clearPendingCodexSpawn();
    toast.success(
      'Agent started automatically after Codex re-authentication',
    );
    await refreshDashboardState(queryClient);
  } catch (err) {
    clearPendingCodexReauthSession();
    toast.error(
      `Auto-retry failed: ${err instanceof Error ? err.message : String(err)}`,
      { duration: 8000 },
    );
  }
}
