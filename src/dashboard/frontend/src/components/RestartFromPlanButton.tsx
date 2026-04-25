import { Loader2, RotateCcw } from 'lucide-react';
import { useRestartFromPlan } from '../hooks/useRestartFromPlan';

interface RestartFromPlanButtonProps {
  issueId: string;
}

export function RestartFromPlanButton({ issueId }: RestartFromPlanButtonProps) {
  const { confirmAndRestart, isPending } = useRestartFromPlan(issueId);

  return (
    <button
      onClick={() => confirmAndRestart()}
      disabled={isPending}
      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-warning/40 text-warning hover:bg-warning hover:text-white transition-colors disabled:opacity-50"
      title="Restart from plan: stops agent, resets branch to post-planning commit, clears session. Keeps vBRIEF, beads, STATE.md, PRD."
    >
      {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
      {isPending ? 'Restarting...' : 'Restart from Plan'}
    </button>
  );
}
