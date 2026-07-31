/**
 * UAT batches rail card — the Flywheel rail's centerpiece.
 *
 * PAN-1696: this is now a thin RailCard shell around the shared
 * <MergeTrainView>, so the Flywheel page is ONE VIEWER of the merge train
 * rather than its owner. The body previously read
 * `/api/flywheel/uat-generations` and `/api/flywheel/merge-queue`, which
 * answered for the dashboard's own repo only and only while a run was active;
 * the shared view reads the aggregate `/api/merge-train/*` namespace and so
 * renders every tracked project's batches with or without a run.
 *
 * Data fetching is no longer gated on a run being active — the card polls while
 * it is mounted (the rail only mounts on the visible Flywheel page). The
 * "UAT batches" label, the feature/batch count, and every action, confirmation
 * dialog, and zone the card used to render live in the shared view, including
 * promote-time version input and deferred version ship.
 */
import { GitMerge } from 'lucide-react';
import { RailCard } from './RailCard';
import { MergeTrainView, mergeTrainTotals, useMergeTrainData } from '../merge-train/MergeTrainView';

export function MergeQueueCard({ active = true, onNavigateIssue }: { active?: boolean; onNavigateIssue?: (issueId: string) => void }) {
  const { sections } = useMergeTrainData(active);
  const { features, batches } = mergeTrainTotals(sections);

  return (
    <RailCard
      icon={<GitMerge className="h-3.5 w-3.5 text-emerald-400" />}
      label="UAT batches"
      ariaLabel="UAT batches"
      count={features > 0 ? `${features} feature${features === 1 ? '' : 's'}${batches > 0 ? ` · ${batches} batch${batches === 1 ? '' : 'es'}` : ''}` : undefined}
    >
      <MergeTrainView active={active} {...(onNavigateIssue ? { onNavigateIssue } : {})} />
    </RailCard>
  );
}
