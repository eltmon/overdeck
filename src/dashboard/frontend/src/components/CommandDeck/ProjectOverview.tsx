import { useMemo, type Ref } from 'react';
import { useDashboardStore } from '../../lib/store';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { DerivedIssueState } from '../../types';
import {
  type BucketedFeature,
  type IssueCostBreakdown,
  bucketFeaturePhase,
  groupPipelineEntries,
} from './pipeline-helpers';
import { PipelineSection } from './PipelineSection';
import { MergeTrain } from '../merge-train/train/MergeTrain';

export type { IssueCostBreakdown };
// PAN-5294: the phase rule lives in pipeline-helpers so ProjectHome can read it
// without importing this component; this re-export keeps existing callers.
export { bucketFeaturePhase };

interface ProjectOverviewProps {
  projectName: string;
  /** projects.yaml key for this project — enables the merge train card (PAN-4753). */
  projectKey?: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
  /** Upper-cased issue ids the project's Needs-you list names (PAN-5294 G-D6). */
  needsYouIssueIds?: ReadonlySet<string>;
  /** Attached to the In review lane so Home's In review fact can scroll to it. */
  inReviewRef?: Ref<HTMLDivElement>;
}

function derivedForFeature(
  feature: ProjectFeature,
  derivedByIssueId: Record<string, DerivedIssueState>,
) {
  return derivedByIssueId[feature.issueId] ??
    derivedByIssueId[feature.issueId.toUpperCase()] ??
    derivedByIssueId[feature.issueId.toLowerCase()];
}

function openBoard() {
  window.history.pushState({ tab: 'kanban' }, '', '/board');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * PAN-5294 §5a — the project Home's Pipeline panel: a header with the listed
 * issue count and an Open the board link, the lanes, then the merge train.
 */
export function ProjectOverview({
  projectKey,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  needsYouIssueIds,
  inReviewRef,
}: ProjectOverviewProps) {
  const derivedByIssueId = useDashboardStore(state => state.derivedIssueStateByIssueId);

  const bucketedFeatures = useMemo<BucketedFeature[]>(
    () => features.map(feature => {
      const derived = derivedForFeature(feature, derivedByIssueId);
      return {
        feature,
        derived,
        phase: bucketFeaturePhase(feature, derived),
      };
    }),
    [features, derivedByIssueId],
  );

  const listedCount = useMemo(
    () => groupPipelineEntries(bucketedFeatures).reduce((sum, group) => sum + group.entries.length, 0),
    [bucketedFeatures],
  );

  return (
    <section aria-label="Pipeline" className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <h3 className="text-[14px] font-semibold text-foreground">Pipeline</h3>
        <span className="text-[12px] text-muted-foreground">{listedCount} {listedCount === 1 ? 'issue' : 'issues'}</span>
        <button
          type="button"
          onClick={openBoard}
          className="ml-auto rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Open the board
        </button>
      </div>

      <PipelineSection
        entries={bucketedFeatures}
        issueCosts={issueCosts}
        issueCostDetails={issueCostDetails}
        onSelectFeature={onSelectFeature}
        needsYouIssueIds={needsYouIssueIds}
        inReviewRef={inReviewRef}
      />

      {projectKey && (
        <MergeTrain
          placement="project"
          projectKey={projectKey}
          active
          onNavigateIssue={(issueId) => {
            const feature = features.find((f) => f.issueId.toUpperCase() === issueId.toUpperCase());
            if (feature) onSelectFeature(feature);
          }}
        />
      )}
    </section>
  );
}
