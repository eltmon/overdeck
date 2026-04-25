import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirm, useAlert } from '../components/DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface RestartFromPlanResult {
  success: boolean;
  message: string;
}

export function useRestartFromPlan(issueId: string) {
  const confirm = useConfirm();
  const showAlert = useAlert();
  const queryClient = useQueryClient();

  const restartMutation = useMutation<RestartFromPlanResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/restart-from-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to restart from plan');
      }
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      showAlert({ message: `Failed to restart from plan: ${err.message}`, variant: 'error' });
    },
  });

  const confirmAndRestart = async (): Promise<boolean> => {
    const confirmed = await confirm({
      title: 'Restart from Plan',
      message: `Restart ${issueId} from its planning state?\n\nThis will:\n- Stop any running agent\n- Reset the feature branch to the post-planning commit\n- Clear agent session state\n- Reset specialist pipeline states\n- Move the issue to In Progress\n\nKeeps: vBRIEF plan, beads, STATE.md, and PRD.`,
      variant: 'destructive',
      confirmLabel: 'Restart from Plan',
    });
    if (confirmed) {
      restartMutation.mutate();
    }
    return confirmed;
  };

  return {
    restartMutation,
    confirmAndRestart,
    isPending: restartMutation.isPending,
  };
}
