import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface RestartResult {
  success?: boolean;
  accepted?: boolean;
  agentId: string;
  model?: string;
}

export function useRestartAgent(agentId: string | undefined) {
  const queryClient = useQueryClient();

  const restartMutation = useMutation<RestartResult, Error, { model?: string; harness?: 'claude-code' | 'pi'; graceful?: boolean; message?: string }>({
    mutationFn: async ({ model, harness, graceful = true, message }) => {
      if (!agentId) throw new Error('No agent to restart');

      const res = await fetch(`/api/agents/${agentId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness, graceful, message }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to restart agent');
      }

      return await res.json() as RestartResult;
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  return {
    restartMutation,
    isPending: restartMutation.isPending,
  };
}
