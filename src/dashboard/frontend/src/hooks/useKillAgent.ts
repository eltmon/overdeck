import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../components/DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface KillAgentResult {
  success: boolean;
}

export function useKillAgent(agentId: string | undefined, options?: { onSuccess?: () => void }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const killMutation = useMutation<KillAgentResult, Error, void>({
    mutationFn: async () => {
      if (!agentId) throw new Error('No agent to kill');
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to kill agent');
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
      options?.onSuccess?.();
    },
  });

  const confirmAndKill = async (): Promise<boolean> => {
    if (!agentId) return false;
    const confirmed = await confirm({
      title: 'Kill Agent',
      message: `Kill agent ${agentId}?`,
      variant: 'destructive',
      confirmLabel: 'Kill',
    });
    if (confirmed) {
      killMutation.mutate();
    }
    return confirmed;
  };

  return {
    killMutation,
    confirmAndKill,
    isPending: killMutation.isPending,
  };
}
