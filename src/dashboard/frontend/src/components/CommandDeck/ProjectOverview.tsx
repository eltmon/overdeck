import { useMemo, useState, type ReactNode } from 'react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { useDashboardStore } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import MetricStrip, { type MetricStripTile } from '../primitives/MetricStrip';
import PhaseHeader from '../primitives/PhaseHeader';
import VerbBadge, { type VerbBadgeVariant } from '../primitives/VerbBadge';
import { LiveCounter } from './LiveCounter';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { Agent, Issue } from '../../types';

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

interface BucketedFeature {
  feature: ProjectFeature;
  reviewStatus: ReviewStatusSnapshot | undefined;
  phase: PipelineIssuePhase;
}

const PIPELINE_PHASES: PipelineIssuePhase[] = ['ship', 'review', 'work', 'plan', 'todo'];
const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'starting']);
const REVIEW_BLOCKED_STATUSES = new Set(['failed', 'blocked']);
const TEST_BLOCKED_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_BLOCKED_STATUSES = new Set(['failed']);
const VERIFICATION_BLOCKED_STATUSES = new Set(['failed']);

type PipelineClassifierIssue = Pick<Issue, 'state' | 'status' | 'stateType' | 'hasPlan' | 'planningComplete' | 'mergeStatus'>;
type PipelineClassifierAgent = Pick<Agent, 'role' | 'status' | 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'>;

function MetricIcon({ label }: { label: string }) {
  return <span aria-hidden="true">{label}</span>;
}

function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work' && session.presence === 'active') ?? false;
}

function hasWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work') ?? false;
}

function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

function reviewStatusForClassifier(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): ReviewStatusSnapshot | undefined {
  if (!feature.readyForMerge) return reviewStatus;
  return {
    ...(reviewStatus ?? { issueId: feature.issueId }),
    readyForMerge: reviewStatus?.readyForMerge ?? true,
  } as ReviewStatusSnapshot;
}

function featureState(feature: ProjectFeature): string | undefined {
  const raw = `${feature.status} ${feature.stateLabel}`.toLowerCase();
  if (raw.includes('review')) return 'in_review';
  if (raw.includes('progress') || hasActiveAgentSignal(feature)) return 'in_progress';
  if (raw.includes('done') || raw.includes('complete')) return 'done';
  if (raw.includes('cancel')) return 'canceled';
  return feature.status;
}

function classifierIssue(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): PipelineClassifierIssue {
  const state = featureState(feature);
  return {
    status: feature.status,
    state,
    stateType: state === 'done' ? 'completed' : state === 'canceled' ? 'canceled' : undefined,
    hasPlan: feature.hasPlanning,
    planningComplete: feature.hasPlanning && !hasWorkSession(feature),
    mergeStatus: reviewStatus?.mergeStatus,
  };
}

function classifierAgent(feature: ProjectFeature): PipelineClassifierAgent | null {
  if (!hasActiveAgentSignal(feature)) return null;
  return {
    role: 'work',
    status: 'running',
  };
}

export function bucketFeaturePhase(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): PipelineIssuePhase {
  const status = reviewStatusForClassifier(feature, reviewStatus);
  return getPipelineIssuePhase(classifierIssue(feature, status), status, classifierAgent(feature));
}

function reviewStatusForFeature(
  feature: ProjectFeature,
  reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>,
) {
  return reviewStatusByIssueId[feature.issueId] ??
    reviewStatusByIssueId[feature.issueId.toUpperCase()] ??
    reviewStatusByIssueId[feature.issueId.toLowerCase()];
}

function isBlockedFeature(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): boolean {
  return Boolean(
    feature.agentStatus === 'failed' ||
      reviewStatus?.stuck ||
      (reviewStatus?.blockerReasons?.length ?? 0) > 0 ||
      REVIEW_BLOCKED_STATUSES.has(reviewStatus?.reviewStatus ?? '') ||
      TEST_BLOCKED_STATUSES.has(reviewStatus?.testStatus ?? '') ||
      MERGE_BLOCKED_STATUSES.has(reviewStatus?.mergeStatus ?? '') ||
      VERIFICATION_BLOCKED_STATUSES.has(reviewStatus?.verificationStatus ?? ''),
  );
}

export function ProjectOverview({
  projectName,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: ProjectOverviewProps) {
  const reviewStatusByIssueId = useDashboardStore(state => state.reviewStatusByIssueId);

  const totalCost = useMemo(
    () => features.reduce((sum, feature) => sum + (issueCosts[feature.issueId] ?? 0), 0),
    [features, issueCosts],
  );

  const activeAgentCount = useMemo(
    () => features.filter(hasActiveAgentSignal).length,
    [features],
  );

  const bucketedFeatures = useMemo<BucketedFeature[]>(
    () => features.map(feature => {
      const reviewStatus = reviewStatusForFeature(feature, reviewStatusByIssueId);
      return {
        feature,
        reviewStatus,
        phase: bucketFeaturePhase(feature, reviewStatus),
      };
    }),
    [features, reviewStatusByIssueId],
  );

  const bucketedByPhase = useMemo(() => {
    const byPhase = new Map<PipelineIssuePhase, BucketedFeature[]>();
    for (const phase of PIPELINE_PHASES) byPhase.set(phase, []);
    for (const entry of bucketedFeatures) byPhase.get(entry.phase)?.push(entry);
    return byPhase;
  }, [bucketedFeatures]);

  const activePhaseCount = PIPELINE_PHASES.filter(phase => (bucketedByPhase.get(phase)?.length ?? 0) > 0).length;

  const metricTiles = useMemo<MetricStripTile[]>(() => {
    const reviewRunning = bucketedFeatures.filter(({ phase }) => phase === 'review').length;
    const readyToShip = bucketedFeatures.filter(({ phase }) => phase === 'ship').length;

    return [
      { id: 'active', eyebrow: 'Active issues', value: features.length, sub: projectName, icon: <MetricIcon label="●" />, signal: 'info' },
      { id: 'work', eyebrow: 'Work running', value: activeAgentCount, sub: 'work agents', icon: <MetricIcon label="▶" />, signal: 'warning' },
      { id: 'review', eyebrow: 'Review running', value: reviewRunning, sub: 'review phase', icon: <MetricIcon label="◆" />, signal: 'review' },
      { id: 'ship', eyebrow: 'Ship', value: readyToShip, sub: 'ship phase', icon: <MetricIcon label="↑" />, signal: 'success' },
      { id: 'spend', eyebrow: 'Spend', value: formatCost(totalCost), sub: '24h spend', icon: <MetricIcon label="$" />, signal: 'cost' },
    ];
  }, [activeAgentCount, bucketedFeatures, features.length, projectName, totalCost]);

  return (
    <section
      aria-label={`${projectName} project overview`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 20,
        minHeight: '100%',
        overflow: 'auto',
      }}
    >
      <HeroBillboard
        projectName={projectName}
        issueCount={features.length}
        totalCost={totalCost}
        activeAgentCount={activeAgentCount}
        activePhaseCount={activePhaseCount}
        metricTiles={metricTiles}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PIPELINE_PHASES.map(phase => {
          const entries = bucketedByPhase.get(phase) ?? [];
          if (entries.length === 0) return null;
          return (
            <PipelineSection
              key={phase}
              phase={phase}
              entries={entries}
              issueCosts={issueCosts}
              issueCostDetails={issueCostDetails}
              onSelectFeature={onSelectFeature}
            />
          );
        })}
      </div>
    </section>
  );
}

function HeroBillboard({
  projectName,
  issueCount,
  totalCost,
  activeAgentCount,
  activePhaseCount,
  metricTiles,
}: {
  projectName: string;
  issueCount: number;
  totalCost: number;
  activeAgentCount: number;
  activePhaseCount: number;
  metricTiles: MetricStripTile[];
}) {
  return (
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

      <MetricStrip
        tiles={metricTiles}
        columns={5}
        className="border-b-0 px-0 py-0"
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Issues" value={issueCount.toString()} />
        <StatCard
          label="Total cost"
          value={<LiveCounter value={totalCost} unit="$" precision={2} pulseOnIncrement />}
        />
        <StatCard label="Active agents" value={activeAgentCount.toString()} />
        <StatCard label="Pipeline phases" value={activePhaseCount.toString()} />
      </div>
    </div>
  );
}

function PipelineSection({
  phase,
  entries,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: {
  phase: PipelineIssuePhase;
  entries: BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
}) {
  return (
    <section
      aria-label={`${phase} pipeline phase`}
      data-component="command-deck-pipeline-phase"
      data-phase={phase}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 14,
        background: 'var(--card)',
      }}
    >
      <PhaseHeader phase={phase} count={entries.length} variant="command-deck" className="static" />

      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {entries.map(entry => (
          <ProjectIssueRow
            key={entry.feature.issueId}
            entry={entry}
            issueCosts={issueCosts}
            issueCostDetails={issueCostDetails}
            onSelectFeature={onSelectFeature}
            reason={subStatus(entry)}
          />
        ))}
      </div>
    </section>
  );
}

function verbBadgePropsForPhase(entry: BucketedFeature): { variant: Exclude<VerbBadgeVariant, 'STUCK · Nh'> } | { variant: 'STUCK · Nh'; hours: number } {
  if (isBlockedFeature(entry.feature, entry.reviewStatus)) return { variant: 'CHANGES REQUESTED' };
  if (entry.phase === 'ship' && (entry.reviewStatus?.readyForMerge || entry.feature.readyForMerge)) return { variant: 'READY TO MERGE' };
  if (entry.phase === 'ship') return { variant: 'SHIP RUNNING' };
  if (entry.phase === 'review') return { variant: 'REVIEW RUNNING' };
  if (entry.phase === 'work') return { variant: 'WORK RUNNING' };
  if (entry.phase === 'plan') return { variant: 'PLANNING' };
  return { variant: 'QUEUED FOR PLAN' };
}

function priorityForFeature(feature: ProjectFeature): IssueRowPriority {
  if (feature.readyForMerge) return 'high';
  if (feature.agentStatus === 'failed') return 'urgent';
  if (hasActiveAgentSignal(feature)) return 'high';
  return 'medium';
}

function agentForFeature(feature: ProjectFeature): { name: string; sub: string } | null {
  const active = feature.sessions?.find(session => session.presence === 'active') ?? feature.sessions?.[0];
  if (active?.sessionId) {
    return { name: active.sessionId, sub: [active.type, active.status].filter(Boolean).join(' · ') };
  }
  if (feature.agentStatus) return { name: feature.agentStatus, sub: feature.stateLabel };
  return null;
}

function ProjectIssueRow({
  entry,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  reason,
}: {
  entry: BucketedFeature;
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
  reason?: string;
}) {
  const cost = issueCosts[entry.feature.issueId];
  const costDetails = issueCostDetails?.[entry.feature.issueId];
  const agent = agentForFeature(entry.feature);

  return (
    <IssueRow
      issueId={entry.feature.issueId}
      phase={entry.phase}
      priority={priorityForFeature(entry.feature)}
      title={entry.feature.title}
      project={{ name: entry.feature.projectName }}
      labels={reason ? [<StatusPill key="reason">{reason}</StatusPill>] : []}
      verbBadge={<VerbBadge {...verbBadgePropsForPhase(entry)} />}
      agent={agent ? { name: agent.name, sub: agent.sub } : undefined}
      ledger={cost !== undefined ? { cost: <CostBadge cost={cost} details={costDetails} /> } : undefined}
      variant="command-deck"
      onOpen={() => onSelectFeature(entry.feature)}
    />
  );
}

function CostBadge({ cost, details }: { cost: number; details?: IssueCostBreakdown }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hasDetails = Boolean(details);

  return (
    <span
      tabIndex={hasDetails ? 0 : undefined}
      onMouseEnter={() => hasDetails && setPopoverOpen(true)}
      onMouseLeave={() => hasDetails && setPopoverOpen(false)}
      onFocus={() => hasDetails && setPopoverOpen(true)}
      onBlur={() => hasDetails && setPopoverOpen(false)}
      style={{
        position: 'relative',
        borderRadius: '999px',
        padding: '2px 6px',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--success)',
        background: 'color-mix(in srgb, var(--success) 12%, transparent)',
        whiteSpace: 'nowrap',
      }}
    >
      {formatCost(cost)}
      {details && popoverOpen && <CostBreakdownPopover details={details} />}
    </span>
  );
}

function CostBreakdownPopover({ details }: { details: IssueCostBreakdown }) {
  const modelRows = sortedCostRows(details.byModel).map(([model, row]) => ({
    key: model,
    label: friendlyModelName(model),
    cost: row.cost,
  }));
  const stageRows = sortedCostRows(details.byStage).map(([stage, row]) => ({
    key: stage,
    label: friendlyStageName(stage),
    cost: row.cost,
  }));

  return (
    <span
      role="tooltip"
      style={{
        position: 'absolute',
        right: 0,
        top: 'calc(100% + 6px)',
        zIndex: 30,
        width: 240,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 10,
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <CostBreakdownSection title="Models" rows={modelRows} />
      <CostBreakdownSection title="Stages" rows={stageRows} />
    </span>
  );
}

function CostBreakdownSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; cost: number }>;
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </span>
      {rows.length > 0 ? rows.map(row => (
        <span
          key={row.key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 11,
            color: 'var(--popover-foreground)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
          <span style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
            {formatCost(row.cost)}
          </span>
        </span>
      )) : (
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>No cost data</span>
      )}
    </span>
  );
}

function sortedCostRows(rows: Record<string, { cost: number; tokens: number }> | undefined) {
  return Object.entries(rows ?? {}).sort(([, a], [, b]) => b.cost - a.cost);
}

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}

function friendlyModelName(model: string): string {
  return model
    .replace('claude-', '')
    .replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function friendlyStageName(stage: string): string {
  const labels: Record<string, string> = {
    planning: 'Planning',
    implementation: 'Implementation',
    review: 'Review',
    test: 'Testing',
    testing: 'Testing',
    merge: 'Merge',
    interactive: 'Interactive',
    other: 'Other',
    unknown: 'Other',
  };
  return labels[stage] ?? stage.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        borderRadius: '999px',
        padding: '2px 7px',
        fontSize: 11,
        color: 'var(--muted-foreground)',
        background: 'var(--muted)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </span>
  );
}

function stuckReason(reviewStatus: ReviewStatusSnapshot | undefined): string {
  if (reviewStatus?.stuckReason) return reviewStatus.stuckReason;
  if (reviewStatus?.blockerReasons?.[0]) return reviewStatus.blockerReasons[0].summary;
  if (reviewStatus?.reviewStatus === 'blocked') return 'Review blocked';
  if (reviewStatus?.reviewStatus === 'failed') return 'Review failed';
  if (reviewStatus?.testStatus === 'dispatch_failed') return 'Test dispatch failed';
  if (reviewStatus?.testStatus === 'failed') return 'Tests failed';
  if (reviewStatus?.mergeStatus === 'failed') return 'Merge failed';
  if (reviewStatus?.verificationStatus === 'failed') return 'Verification failed';
  return 'Needs attention';
}

function subStatus(entry: BucketedFeature): string | undefined {
  const { reviewStatus, phase } = entry;

  if (isBlockedFeature(entry.feature, reviewStatus)) {
    return stuckReason(reviewStatus);
  }

  if (phase === 'review' && reviewStatus?.reviewSubStatuses) {
    return Object.entries(reviewStatus.reviewSubStatuses)
      .map(([role, status]) => `${role}: ${status}`)
      .join(', ');
  }

  if (phase === 'ship' && reviewStatus?.mergeStep) {
    return reviewStatus.mergeStep;
  }

  if (phase === 'review' && reviewStatus?.verificationCycleCount && reviewStatus.verificationCycleCount > 1) {
    return `Cycle ${reviewStatus.verificationCycleCount}`;
  }

  return undefined;
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
