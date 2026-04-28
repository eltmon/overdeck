import { useEffect } from 'react';
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

  useEffect(() => {
    const pending = getPendingCodexSpawn();
    if (!pending) return;
    if (authStatus?.status !== 'valid') return;

    clearPendingCodexSpawn();

    fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending.requestBody),
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
  }, [authStatus?.status, queryClient]);
}
