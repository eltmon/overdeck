import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { isReviewPipelineStuck } from '../lib/pipeline-state';
import type { ReviewStatusSnapshot } from '@panopticon/contracts';

interface RecoverButtonProps {
  issueId: string;
  reviewStatus?: Pick<ReviewStatusSnapshot, 'reviewStatus' | 'testStatus' | 'mergeStatus' | 'verificationStatus'>;
  variant: 'card' | 'inspector';
  onClick?: (e: React.MouseEvent) => void;
}

export function RecoverButton({ issueId, reviewStatus, variant, onClick }: RecoverButtonProps) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const isRecoverable = isReviewPipelineStuck(reviewStatus);

  if (!isRecoverable) {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    if (variant === 'card') {
      e.stopPropagation();
    }
    onClick?.(e);
    if (await confirm({
      title: 'Recover Pipeline',
      message: `Recover ${issueId}?\n\nThis will:\n• Clear failed review, test, and merge state\n• Reset circuit breaker counters\n• Remove queued specialist tasks\n• Re-dispatch review and test as needed`,
      confirmLabel: 'Recover',
    })) {
      setIsPending(true);
      try {
        const res = await fetch(`/api/review/${issueId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rerun: true }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error('Pipeline reset failed:', err);
        }
        await refreshDashboardState(queryClient);
      } catch (err) {
        console.error('Pipeline reset error:', err);
      } finally {
        setIsPending(false);
      }
    }
  };

  const tooltip = "Recover the review/test/merge pipeline when it's stuck or failed: clears review/test/merge status to pending, resets circuit-breaker counters, removes any queued specialist tasks, and re-dispatches review and test from the latest commit. Does not touch the workspace, branch, beads, vBRIEF, or PR.";

  if (variant === 'inspector') {
    return (
      <button
        onClick={handleClick}
        disabled={isPending}
        className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
        title={tooltip}
      >
        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
        {isPending ? 'Recovering...' : 'Recover'}
      </button>
    );
  }

  // card variant
  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      title={tooltip}
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
      {isPending ? 'Recovering...' : 'Recover'}
    </button>
  );
}
