/**
 * UAT batches (PAN-4199 WI-12; v1 `MergeQueueCard`). The left rail's window
 * onto the merge train: which features are queued for UAT and which batches
 * are assembled, for every project the train knows.
 *
 * The card owns no data of its own — it wraps `MergeTrainView`, the same
 * surface the Awaiting Merge page renders, with the project filter off
 * because the rail is already scoped to the flywheel's project.
 */
import { MergeTrainView, mergeTrainTotals, useMergeTrainData } from '../merge-train/MergeTrainView';
import { RailCard } from './primitives';

/** `2 features · 1 batch`, or null when the train is empty. */
export function uatBatchesCountLabel(features: number, batches: number): string | null {
  if (features === 0 && batches === 0) return null;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;
  return `${features} feature${features === 1 ? '' : 's'} · ${plural(batches, 'batch')}`;
}

export function FlywheelUatBatchesCard({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const { sections } = useMergeTrainData(true);
  const { features, batches } = mergeTrainTotals(sections);
  const count = uatBatchesCountLabel(features, batches);

  return (
    <RailCard
      label="UAT batches"
      ariaLabel="UAT batches"
      actions={count && (
        <span className="text-[11px] text-muted-foreground" data-testid="flywheel-uat-batches-count">{count}</span>
      )}
    >
      <MergeTrainView active showProjectFilter={false} onNavigateIssue={onNavigateIssue} />
    </RailCard>
  );
}
