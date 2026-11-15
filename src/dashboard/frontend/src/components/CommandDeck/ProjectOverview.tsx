import { useMemo, type Ref } from 'react';
import { useDashboardStore } from '../../lib/store';
import { PHASE_BY_DERIVED_STATE, type PipelineIssuePhase } from '../../lib/pipeline-state';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { CanonicalState, DerivedIssueState } from '../../types';
import {
  type BucketedFeature,
  type IssueCostBreakdown,
  groupPipelineEntries,
  hasActiveAgentSignal,
  hasWorkSession,
} from './pipeline-helpers';
import { PipelineSection } from './PipelineSection';
import { MergeTrain } from '../merge-train/train/MergeTrain';

export type { IssueCostBreakdown };

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

/**
 * PAN-3917: the lane comes from the derived issue state. When the server has
 * not derived one yet, the tracker's own state (an owner, never a record)
 * places the row so the tree does not collapse every feature into Todo.
 */
function featureState(feature: ProjectFeature): CanonicalState | undefined {
  const raw = `${feature.status} ${feature.stateLabel}`.toLowerCase();
  if (raw.includes('close-out')) return 'done';
  if (raw.includes('review')) return 'in_review';
  if (raw.includes('progress') || hasActiveAgentSignal(feature)) return 'in_progress';
  if (raw.includes('done') || raw.includes('complete')) return 'done';
  if (raw.includes('cancel')) return 'canceled';
  return feature.status as CanonicalState | undefined;
}

function trackerPhase(feature: ProjectFeature): PipelineIssuePhase {
  switch (featureState(feature)) {
    case 'done':
    case 'canceled':
      return 'ship';
    case 'in_review':
      return 'review';
    case 'in_progress':
      return 'work';
    default:
      return feature.hasPlanning && !hasWorkSession(feature) ? 'plan' : 'todo';
  }
}

export function bucketFeaturePhase(
  feature: ProjectFeature,
  derived: DerivedIssueState | undefined,
): PipelineIssuePhase {
  return derived ? PHASE_BY_DERIVED_STATE[derived.state] : trackerPhase(feature);
}

function derivedForFeature(
  feature: ProjectFeature,
  derivedByIssueId: Record<string, DerivedIssueState>,
) {
  return derivedByIssueId[feature.issueId] ??
    derivedByIssueId[feature.issueId.toUpperCase()] ??
    derivedByIssueId[feature.issueId.toLowerCase()];
}

/**
 * Project lifetime spend (PAN-1589). `issueCosts` is a GLOBAL map (every issue
 * across all projects, keyed by both `PAN-1` and a lowercased alias). We scope
 * it to this project by the issue prefix(es) of its features, and sum ALL
 * matching issues — including closed/historical ones, not just active features.
 * Counting only the canonical (non-lowercased) keys avoids double-counting the
 * alias entries. Shared by the cockpit Spend metric and the Home cost chip so
 * the two always agree.
 */
export function projectTotalCost(
  issueCosts: Record<string, number>,
  features: { issueId: string }[],
): number {
  const prefixes = new Set(
    features.map(f => f.issueId.split('-')[0]?.toUpperCase()).filter(Boolean),
  );
  if (prefixes.size === 0) return 0;
  let sum = 0;
  for (const [key, value] of Object.entries(issueCosts)) {
    if (key !== key.toUpperCase()) continue; // skip lowercased aliases
    const prefix = key.split('-')[0]?.toUpperCase();
    if (prefix && prefixes.has(prefix)) sum += value;
  }
  return sum;
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
