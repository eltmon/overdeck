import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitMerge, CheckCircle } from 'lucide-react';
import { useAlert, useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { useDerivedIssueState } from '../lib/store';

interface MergeButtonProps {
  issueId: string;
  variant: 'card' | 'inspector';
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * The human merge click. PAN-3917: it appears exactly when the forge says the
 * PR is mergeable — approved, checks green, `mergeable` true, which is what the
 * derived `ready` state means. There is no stored merge progress to render, so
 * the button is either offered or it is not.
 */
export function MergeButton({ issueId, variant, onClick }: MergeButtonProps) {
  const showAlert = useAlert();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const derived = useDerivedIssueState(issueId);

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

  if (derived?.state !== 'ready') return null;

  const handleClick = async (e: React.MouseEvent) => {
    if (variant === 'card') {
      e.stopPropagation();
    }
    onClick?.(e);
    if (await confirm({
      title: 'Merge to Main',
      message: `Merge ${issueId} to main?\n\nThe PR is approved with green checks. This will:\n- Merge the feature branch to main\n- Run final verification tests\n- Clean up workspace`,
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
        disabled={mergeMutation.isPending}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {mergeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
        Merge
      </button>
    );
  }

  // card variant
  return (
    <button
      onClick={handleClick}
      disabled={mergeMutation.isPending}
      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
      title="Merge"
    >
      {mergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
      Merge
    </button>
  );
}
