import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface SwitchModelResult {
  success: boolean;
  previousModel: string;
  newModel: string;
}

export function useSwitchModel(agentId: string | undefined, issueId: string) {
  const queryClient = useQueryClient();

  const switchMutation = useMutation<SwitchModelResult, Error, { model: string; message?: string; harness?: 'claude-code' | 'pi' }>({
    mutationFn: async ({ model, message, harness }) => {
      if (!agentId) throw new Error('No agent to switch');

      // Step 1: Prepare — stop agent, clear session, update model in state.json
      const prepRes = await fetch(`/api/agents/${agentId}/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, harness }),
      });
      if (!prepRes.ok) {
        const data = await prepRes.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to switch model');
      }
      const prepData = await prepRes.json() as SwitchModelResult;

      // Step 2: Start fresh agent with new model via existing start endpoint
      const startRes = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, model, harness, message: message || undefined }),
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Switched model but failed to start agent');
      }

      return prepData;
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  return {
    switchMutation,
    isPending: switchMutation.isPending,
  };
}
