import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitMerge, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAlert, useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface MergeButtonProps {
  issueId: string;
  reviewStatus?: { readyForMerge?: boolean; mergeStatus?: string };
  variant: 'card' | 'inspector';
  issueState?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function MergeButton({ issueId, reviewStatus, variant, issueState, onClick }: MergeButtonProps) {
  const showAlert = useAlert();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        let message = `Failed to merge (${res.status})`;
        try {
          const data = JSON.parse(text);
          message = data.error || message;
        } catch {
          message = text.length < 200 ? text : message;
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      showAlert({ message: `Failed to merge: ${err.message}`, variant: 'error' });
    },
  });

  const isBusy =
    reviewStatus?.mergeStatus === 'queued' ||
    reviewStatus?.mergeStatus === 'merging' ||
    reviewStatus?.mergeStatus === 'verifying';

  // Stuck merge detection: if mergeStatus has been 'merging' for > 2 min, enable retry (PAN-490)
  const STUCK_MERGE_MS = 2 * 60 * 1000;
  const mergingElapsed = reviewStatus?.mergeStatus === 'merging' && (reviewStatus as Record<string, unknown>)?.updatedAt
    ? Date.now() - new Date((reviewStatus as Record<string, unknown>).updatedAt as string).getTime()
    : 0;
  const isMergeStuck = mergingElapsed > STUCK_MERGE_MS;

  if (issueState === 'verifying_on_main' || !reviewStatus?.readyForMerge || reviewStatus?.mergeStatus === 'merged') {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    if (variant === 'card') {
      e.stopPropagation();
    }
    onClick?.(e);
    if (await confirm({
      title: 'Merge to Main',
      message: `Merge ${issueId} to main?\n\nReview and tests have passed. This will:\n- Merge the feature branch to main\n- Run final verification tests\n- Clean up workspace`,
      confirmLabel: 'Merge',
    })) {
      mergeMutation.mutate();
    }
  };

  if (variant === 'inspector') {
    return (
      <button
        data-testid="merge-btn"
        onClick={handleClick}
        disabled={mergeMutation.isPending || ((reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying' || reviewStatus?.mergeStatus === 'queued') && !isMergeStuck)}
        className={`flex items-center gap-1 px-2 py-1 text-xs rounded font-medium ${
          isMergeStuck
            ? 'bg-warning text-warning-foreground hover:bg-warning/90'
            : 'bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50'
        }`}
        title={isMergeStuck ? 'Merge appears stuck — click to retry' : undefined}
      >
        {mergeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> :
         isMergeStuck ? <AlertTriangle className="w-3 h-3" /> :
         reviewStatus?.mergeStatus === 'verifying' ? <Loader2 className="w-3 h-3 animate-spin" /> :
         reviewStatus?.mergeStatus === 'merging' ? <Loader2 className="w-3 h-3 animate-spin" /> :
         <CheckCircle className="w-3 h-3" />}
        {isMergeStuck ? 'Retry Merge' :
         reviewStatus?.mergeStatus === 'queued' ? 'Queued' :
         reviewStatus?.mergeStatus === 'verifying' ? 'Verifying...' :
         reviewStatus?.mergeStatus === 'merging' ? 'Rebasing...' : 'Merge'}
      </button>
    );
  }

  // card variant
  return (
    <button
      onClick={handleClick}
      disabled={mergeMutation.isPending || isBusy}
      className="flex items-center gap-1 text-xs text-success hover:text-success/80 transition-colors disabled:opacity-50"
      title="Merge"
    >
      {(mergeMutation.isPending || isBusy) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
      {reviewStatus?.mergeStatus === 'queued'
        ? 'Queued'
        : reviewStatus?.mergeStatus === 'verifying'
          ? 'Verifying'
          : reviewStatus?.mergeStatus === 'merging'
            ? 'Merging'
            : 'Merge'}
    </button>
  );
}
