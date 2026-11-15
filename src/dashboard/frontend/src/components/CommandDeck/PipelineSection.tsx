import { useMemo, type Ref } from 'react';
import { groupPipelineEntries, type BucketedFeature, type IssueCostBreakdown } from './pipeline-helpers';
import { PipelineRow } from './PipelineRow';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

const NO_NEEDS_YOU: ReadonlySet<string> = new Set();

export interface PipelineSectionProps {
  entries: readonly BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
  /** Upper-cased issue ids the Needs-you list names (PAN-5294 G-D6). */
  needsYouIssueIds?: ReadonlySet<string>;
  /** Attached to the In review lane so the In review fact can scroll to it. */
  inReviewRef?: Ref<HTMLDivElement>;
}

/**
 * PAN-5294 G-D5 — the Home pipeline: one bordered card with a lane bar per
 * lane (Building, In review, Ready to merge, then Stalled when non-empty).
 */
export function PipelineSection({
  entries,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  needsYouIssueIds = NO_NEEDS_YOU,
  inReviewRef,
}: PipelineSectionProps) {
  const groups = useMemo(() => groupPipelineEntries(entries), [entries]);

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card" data-testid="pipeline-section">
      {groups.map((group) => (
        <div
          key={group.key}
          role="region"
          aria-label={`${group.title} lane`}
          data-phase-group={group.key}
          ref={group.key === 'review' ? inReviewRef : undefined}
        >
          <div className="border-b border-border bg-muted px-3.5 py-1.5 text-[12px] text-muted-foreground">
            {group.title} · {group.entries.length}
          </div>
          {group.entries.map((entry) => (
            <PipelineRow
              key={entry.feature.issueId}
              entry={entry}
              lane={group.key}
              needsYou={needsYouIssueIds.has(entry.feature.issueId.toUpperCase())}
              issueCosts={issueCosts}
              issueCostDetails={issueCostDetails}
              onSelectFeature={onSelectFeature}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
