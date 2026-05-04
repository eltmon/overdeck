import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../components/DialogProvider';
import { useAlert } from '../components/DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface ResetIssueResult {
  success: boolean;
  raw?: string;
}

export function useResetIssue(issueId: string) {
  const confirm = useConfirm();
  const showAlert = useAlert();
  const queryClient = useQueryClient();

  const resetMutation = useMutation<ResetIssueResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to reset issue');
      }
      const reader = res.body?.getReader();
      if (!reader) return { success: true };
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      return { success: true, raw: buffer };
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      showAlert({ message: `Failed to reset: ${err.message}`, variant: 'error' });
    },
  });

  const confirmAndReset = async (): Promise<boolean> => {
    const confirmed = await confirm({
      title: 'Reset Issue',
      message: `Reset ${issueId}?\n\nThis will:\n- Stop any running agent\n- Delete the workspace and feature branch (including the continue file)\n- Clear all beads and vBRIEF\n- Move the issue back to Todo\n\nThe issue can be re-planned and re-worked from scratch.`,
      variant: 'destructive',
      confirmLabel: 'Reset Issue',
    });
    if (confirmed) {
      resetMutation.mutate();
    }
    return confirmed;
  };

  return {
    resetMutation,
    confirmAndReset,
    isPending: resetMutation.isPending,
  };
}
