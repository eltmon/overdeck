/**
 * The Flywheel rail's merge-train section (PAN-4753 WI-11): the all-projects
 * `MergeTrain` under a "Merge train" heading with a one-line summary. It
 * replaces the pending-auto-merges and UAT-batches cards.
 */
import { MergeTrain } from '../merge-train/train/MergeTrain';
import { trainTotals, useMergeTrainBoard } from '../merge-train/train/useMergeTrainBoard';
import { RailCard } from './primitives';

export function FlywheelMergeTrainRail({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const { data: board } = useMergeTrainBoard({ active: true });
  const totals = board ? trainTotals(board) : null;
  return (
    <RailCard
      label="Merge train"
      actions={totals && (
        <span className="text-xs text-muted-foreground" data-testid="flywheel-merge-train-summary">
          {totals.waiting} waiting · {totals.batchesReady} {totals.batchesReady === 1 ? 'batch' : 'batches'} ready to test
        </span>
      )}
    >
      <MergeTrain placement="all-projects" active onNavigateIssue={onNavigateIssue} />
    </RailCard>
  );
}
