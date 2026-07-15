import type { MouseEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Loader2 } from 'lucide-react';
import { useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

interface CloseOutIssueButtonProps {
  issueId: string;
  variant?: 'card' | 'inspector';
  stopPropagation?: boolean;
}

interface CloseOutErrorPayload {
  error?: string;
  dodGate?: {
    rows?: Array<{ num: number; title: string; observed: string; status: string; acceptedBy?: unknown }>;
  };
}

export function closeOutErrorMessage(data: CloseOutErrorPayload): string {
  const misses = data.dodGate?.rows?.filter(row => row.status === 'miss' && !row.acceptedBy) ?? [];
  const details = misses.map(row => `${row.num} ${row.title}: ${row.observed}`);
  return [data.error || 'Close-out failed', ...details].join('\n');
}

export function CloseOutIssueButton({ issueId, variant = 'card', stopPropagation = true }: CloseOutIssueButtonProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const closeOutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/close-out`, {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(closeOutErrorMessage(data));
      }
      return data;
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  const handleCloseOut = async (e: MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (await confirm({
      title: 'Close Out Issue',
      message: `Close out ${issueId}?\n\nThis final cleanup is destructive and will:\n• Verify the branch is merged on main\n• Archive workspace artifacts\n• Clean up agent state and workspace resources\n• Close the tracker issue\n• Apply the closed-out label`,
      variant: 'destructive',
      confirmLabel: 'Close Out',
    })) {
      closeOutMutation.mutate();
    }
  };

  const className = variant === 'inspector'
    ? 'flex items-center gap-1 px-2 py-1 text-xs rounded bg-fuchsia-950/70 text-fuchsia-200 border border-fuchsia-400/50 hover:bg-fuchsia-900/80 transition-colors disabled:opacity-50'
    : 'flex items-center gap-1 text-xs text-fuchsia-200 hover:text-fuchsia-100 transition-colors disabled:opacity-50';

  return (
    <>
      <button
        onClick={handleCloseOut}
        disabled={closeOutMutation.isPending}
        className={className}
        title="Finalize post-merge verification and close out this issue"
        data-testid={`close-out-${issueId}`}
      >
        {closeOutMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <CheckCheck className="w-3.5 h-3.5" />
        )}
        {closeOutMutation.isPending ? 'Closing out...' : 'Close Out'}
      </button>
      {closeOutMutation.isError && (
        <span className="text-xs whitespace-pre-line text-destructive-foreground">{(closeOutMutation.error as Error).message}</span>
      )}
    </>
  );
}
