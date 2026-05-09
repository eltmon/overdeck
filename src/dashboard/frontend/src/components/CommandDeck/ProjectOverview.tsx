import { useMemo, type ReactNode } from 'react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { useDashboardStore } from '../../lib/store';
import { LiveCounter } from './LiveCounter';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export type PipelineStage =
  | 'stuck'
  | 'merging'
  | 'awaitingMerge'
  | 'tests'
  | 'review'
  | 'buildGate'
  | 'working'
  | 'planning'
  | 'idle';

export interface IssueCostBreakdown {
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage: Record<string, { cost: number; tokens: number }>;
}

interface ProjectOverviewProps {
  projectName: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
}

const MERGING_STATUSES = new Set(['queued', 'merging', 'verifying']);

export function bucketFeature(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): PipelineStage {
  if (reviewStatus?.stuck) return 'stuck';

  if (
    reviewStatus?.reviewStatus === 'failed' ||
    reviewStatus?.testStatus === 'failed' ||
    reviewStatus?.mergeStatus === 'failed' ||
    reviewStatus?.verificationStatus === 'failed'
  ) {
    return 'stuck';
  }

  if (reviewStatus?.blockerReasons && reviewStatus.blockerReasons.length > 0) {
    return 'stuck';
  }

  if (reviewStatus?.mergeStatus && MERGING_STATUSES.has(reviewStatus.mergeStatus)) {
    return 'merging';
  }

  if (
    reviewStatus?.readyForMerge &&
    (!reviewStatus.blockerReasons || reviewStatus.blockerReasons.length === 0)
  ) {
    return 'awaitingMerge';
  }

  if (reviewStatus?.testStatus === 'testing') return 'tests';
  if (reviewStatus?.reviewStatus === 'reviewing') return 'review';
  if (reviewStatus?.verificationStatus === 'running') return 'buildGate';
  if (feature.agentStatus !== null && !reviewStatus) return 'working';

  if (feature.hasPlanning && !feature.sessions?.some(session => session.type === 'work')) {
    return 'planning';
  }

  return 'idle';
}

export function ProjectOverview({
  projectName,
  features,
  issueCosts,
}: ProjectOverviewProps) {
  const reviewStatusByIssueId = useDashboardStore(state => state.reviewStatusByIssueId);

  const totalCost = useMemo(
    () => features.reduce((sum, feature) => sum + (issueCosts[feature.issueId] ?? 0), 0),
    [features, issueCosts],
  );

  const activeAgentCount = useMemo(
    () => features.filter(feature => feature.agentStatus !== null).length,
    [features],
  );

  const activeStageCount = useMemo(() => {
    const stages = new Set<PipelineStage>();
    for (const feature of features) {
      stages.add(bucketFeature(feature, reviewStatusByIssueId[feature.issueId]));
    }
    return stages.size;
  }, [features, reviewStatusByIssueId]);

  return (
    <section
      aria-label={`${projectName} project overview`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 20,
        minHeight: '100%',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 8%, transparent), transparent)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--foreground)',
            }}
          >
            {projectName}
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 12,
              color: 'var(--muted-foreground)',
            }}
          >
            Project pipeline overview
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
          }}
        >
          <StatCard label="Issues" value={features.length.toString()} />
          <StatCard
            label="Total cost"
            value={<LiveCounter value={totalCost} unit="$" precision={2} pulseOnIncrement />}
          />
          <StatCard label="Active agents" value={activeAgentCount.toString()} />
          <StatCard label="Pipeline stages" value={activeStageCount.toString()} />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 12,
        background: 'color-mix(in srgb, var(--card) 88%, transparent)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--foreground)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
