import { Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useResetIssue } from '../hooks/useResetIssue';
import { Issue, STATUS_LABELS } from '../types';

interface ResetIssueButtonProps {
  issueId: string;
  variant: 'card' | 'danger-zone';
  issue?: Issue;
  onClick?: (e: React.MouseEvent) => void;
}

const TOOLTIP =
  'Reset Issue: stops any running agent, deletes the workspace and feature branch (including STATE.md), clears all beads and vBRIEF, and moves the issue back to Todo. Use when the current approach is completely wrong and you want to start over from planning.';

export function ResetIssueButton({ issueId, variant, issue, onClick }: ResetIssueButtonProps) {
  const { confirmAndReset, isPending } = useResetIssue(issueId);

  // Hide on card for terminal states
  if (variant === 'card' && issue) {
    const canonical = STATUS_LABELS[issue.status];
    if (canonical === 'done' || canonical === 'canceled' || canonical === 'backlog' || canonical === 'todo') {
      return null;
    }
  }

  const handleClick = async (e: React.MouseEvent) => {
    if (variant === 'card') {
      e.stopPropagation();
    }
    onClick?.(e);
    await confirmAndReset();
  };

  if (variant === 'danger-zone') {
    return (
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">Reset Issue</div>
        <div className="text-[11px] text-muted-foreground mt-0.5" title={TOOLTIP}>
          Deletes the workspace, branch, STATE.md, beads, and vBRIEF. Moves the issue back to Todo. Start over from planning.
        </div>
        <button
          onClick={handleClick}
          disabled={isPending}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
          title={TOOLTIP}
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          {isPending ? 'Resetting...' : 'Reset Issue'}
        </button>
      </div>
    );
  }

  // card variant
  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive/70 transition-colors disabled:opacity-50"
      title={TOOLTIP}
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
      <span>{isPending ? 'Resetting...' : 'Reset Issue'}</span>
    </button>
  );
}
