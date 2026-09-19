/**
 * UAT batches rail card — a collapsible RailCard shell around the shared
 * <MergeTrainView>, for a rail that wants the merge train as one section
 * with a feature/batch count in its header.
 *
 * Every action, confirmation dialog, and zone lives in the shared view,
 * including promote-time version input and deferred version ship.
 */
import { GitMerge } from 'lucide-react';
import { RailCard } from './RailCard';
import { MergeTrainView, mergeTrainTotals, useMergeTrainData } from './MergeTrainView';

export function MergeQueueCard({ active = true, onNavigateIssue }: { active?: boolean; onNavigateIssue?: (issueId: string) => void }) {
  const { sections } = useMergeTrainData(active);
  const { features, batches } = mergeTrainTotals(sections);

  return (
    <RailCard
      icon={<GitMerge className="h-3.5 w-3.5 text-muted-foreground" />}
      label="UAT batches"
      ariaLabel="UAT batches"
      count={features > 0 ? `${features} feature${features === 1 ? '' : 's'}${batches > 0 ? ` · ${batches} batch${batches === 1 ? '' : 'es'}` : ''}` : undefined}
    >
      <MergeTrainView active={active} {...(onNavigateIssue ? { onNavigateIssue } : {})} />
    </RailCard>
  );
}
