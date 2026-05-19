import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { useDashboardStore } from '../../lib/store';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import MetricStrip, { type MetricStripTile } from '../primitives/MetricStrip';
import VerbBadge, { type VerbBadgeVariant } from '../primitives/VerbBadge';
import type { PhaseGlyphPhase } from '../primitives/PhaseGlyph';
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

interface BucketedFeature {
  feature: ProjectFeature;
  reviewStatus: ReviewStatusSnapshot | undefined;
  stage: PipelineStage;
}

const PIPELINE_STAGES: Exclude<PipelineStage, 'stuck'>[] = [
  'merging',
  'awaitingMerge',
  'tests',
  'review',
  'buildGate',
  'working',
  'planning',
  'idle',
];

const BUCKET_STAGES: PipelineStage[] = ['stuck', ...PIPELINE_STAGES];

const STAGE_CONFIG: Record<PipelineStage, { label: string; color: string }> = {
  stuck: { label: 'Stuck / blocked', color: 'var(--destructive)' },
  merging: { label: 'Merging', color: 'var(--info)' },
  awaitingMerge: { label: 'Awaiting merge', color: 'var(--success)' },
  tests: { label: 'Tests', color: 'var(--signal-review)' },
  review: { label: 'Review', color: 'var(--signal-review)' },
  buildGate: { label: 'Build gate', color: 'var(--warning)' },
  working: { label: 'Working', color: 'var(--primary)' },
  planning: { label: 'Planning', color: 'var(--muted-foreground)' },
  idle: { label: 'Idle', color: 'var(--muted-foreground)' },
};

const MERGING_STATUSES = new Set(['queued', 'merging', 'verifying']);
const REVIEW_STUCK_STATUSES = new Set(['failed', 'blocked']);
const TEST_STUCK_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_STUCK_STATUSES = new Set(['failed']);
const VERIFICATION_STUCK_STATUSES = new Set(['failed']);
const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'starting']);

function MetricIcon({ label }: { label: string }) {
  return <span aria-hidden="true">{label}</span>;
}

function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work' && session.presence === 'active') ?? false;
}

function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

export function bucketFeature(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): PipelineStage {
  if (reviewStatus?.stuck) return 'stuck';

  if (
    REVIEW_STUCK_STATUSES.has(reviewStatus?.reviewStatus ?? '') ||
    TEST_STUCK_STATUSES.has(reviewStatus?.testStatus ?? '') ||
    MERGE_STUCK_STATUSES.has(reviewStatus?.mergeStatus ?? '') ||
    VERIFICATION_STUCK_STATUSES.has(reviewStatus?.verificationStatus ?? '')
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
  if (hasActiveAgentSignal(feature) && !reviewStatus) return 'working';

  if (feature.hasPlanning && !feature.sessions?.some(session => session.type === 'work')) {
    return 'planning';
  }

  return 'idle';
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
      const reviewStatus = reviewStatusByIssueId[feature.issueId];
      return {
        feature,
        reviewStatus,
        stage: bucketFeature(feature, reviewStatus),
      };
    }),
    [features, reviewStatusByIssueId],
  );

  const bucketedByStage = useMemo(() => {
    const byStage = new Map<PipelineStage, BucketedFeature[]>();
    for (const stage of BUCKET_STAGES) byStage.set(stage, []);
    for (const entry of bucketedFeatures) byStage.get(entry.stage)?.push(entry);
    return byStage;
  }, [bucketedFeatures]);

  const stuckFeatures = bucketedByStage.get('stuck') ?? [];
  const activeStageCount = BUCKET_STAGES.filter(stage => (bucketedByStage.get(stage)?.length ?? 0) > 0).length;

  const metricTiles = useMemo<MetricStripTile[]>(() => {
    const reviewRunning = bucketedFeatures.filter(({ stage }) => stage === 'review' || stage === 'tests' || stage === 'buildGate').length;
    const readyToShip = bucketedFeatures.filter(({ stage }) => stage === 'awaitingMerge' || stage === 'merging').length;

    return [
      { id: 'active', eyebrow: 'Active issues', value: features.length, sub: projectName, icon: <MetricIcon label="●" />, signal: 'info' },
      { id: 'work', eyebrow: 'Work running', value: activeAgentCount, sub: 'work agents', icon: <MetricIcon label="▶" />, signal: 'warning' },
      { id: 'review', eyebrow: 'Review running', value: reviewRunning, sub: 'review gates', icon: <MetricIcon label="◆" />, signal: 'review' },
      { id: 'ship', eyebrow: 'Ship', value: readyToShip, sub: 'ready or merging', icon: <MetricIcon label="↑" />, signal: 'success' },
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
        activeStageCount={activeStageCount}
        metricTiles={metricTiles}
      />

      {stuckFeatures.length > 0 && (
        <StuckCallout
          entries={stuckFeatures}
          issueCosts={issueCosts}
          issueCostDetails={issueCostDetails}
          onSelectFeature={onSelectFeature}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PIPELINE_STAGES.map(stage => {
          const entries = bucketedByStage.get(stage) ?? [];
          if (entries.length === 0) return null;
          return (
            <PipelineSection
              key={stage}
              stage={stage}
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
  activeStageCount,
  metricTiles,
}: {
  projectName: string;
  issueCount: number;
  totalCost: number;
  activeAgentCount: number;
  activeStageCount: number;
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
        <StatCard label="Pipeline stages" value={activeStageCount.toString()} />
      </div>
    </div>
  );
}

function StuckCallout({
  entries,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: {
  entries: BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
}) {
  return (
    <section
      aria-label="Stuck and blocked issues"
      style={{
        border: '1px solid color-mix(in srgb, var(--destructive) 45%, var(--border))',
        borderRadius: 14,
        padding: 14,
        background: 'color-mix(in srgb, var(--destructive) 7%, transparent)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--destructive)',
          fontWeight: 700,
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        <AlertTriangle size={16} />
        Stuck / blocked issues
        <CountBadge count={entries.length} color="var(--destructive)" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {entries.map(entry => (
          <ProjectIssueRow
            key={entry.feature.issueId}
            entry={entry}
            issueCosts={issueCosts}
            issueCostDetails={issueCostDetails}
            onSelectFeature={onSelectFeature}
            reason={stuckReason(entry.reviewStatus)}
          />
        ))}
      </div>
    </section>
  );
}

function PipelineSection({
  stage,
  entries,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: {
  stage: PipelineStage;
  entries: BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
}) {
  const config = STAGE_CONFIG[stage];

  return (
    <section
      aria-label={`${config.label} pipeline stage`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 14,
        background: 'var(--card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '999px',
            background: config.color,
          }}
        />
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--foreground)',
          }}
        >
          {config.label}
        </h3>
        <CountBadge count={entries.length} color={config.color} />
      </div>

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

function phaseForStage(stage: PipelineStage): PhaseGlyphPhase {
  if (stage === 'merging' || stage === 'awaitingMerge' || stage === 'stuck') return 'ship';
  if (stage === 'tests' || stage === 'review' || stage === 'buildGate') return 'review';
  if (stage === 'working') return 'work';
  if (stage === 'planning') return 'plan';
  return 'todo';
}

function verbBadgePropsForStage(stage: PipelineStage): { variant: Exclude<VerbBadgeVariant, 'STUCK · Nh'> } | { variant: 'STUCK · Nh'; hours: number } {
  if (stage === 'stuck') return { variant: 'STUCK · Nh', hours: 1 };
  if (stage === 'merging') return { variant: 'SHIP RUNNING' };
  if (stage === 'awaitingMerge') return { variant: 'READY TO MERGE' };
  if (stage === 'tests' || stage === 'review' || stage === 'buildGate') return { variant: 'REVIEW RUNNING' };
  if (stage === 'working') return { variant: 'WORK RUNNING' };
  if (stage === 'planning') return { variant: 'PLANNING' };
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
      phase={phaseForStage(entry.stage)}
      priority={priorityForFeature(entry.feature)}
      title={entry.feature.title}
      project={{ name: entry.feature.projectName }}
      labels={reason ? [<StatusPill key="reason">{reason}</StatusPill>] : []}
      verbBadge={<VerbBadge {...verbBadgePropsForStage(entry.stage)} />}
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

function CountBadge({ count, color }: { count: number; color: string }) {
  return (
    <span
      style={{
        borderRadius: '999px',
        padding: '1px 7px',
        fontSize: 11,
        fontWeight: 700,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {count}
    </span>
  );
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
  const { reviewStatus, stage } = entry;

  if (stage === 'review' && reviewStatus?.reviewSubStatuses) {
    return Object.entries(reviewStatus.reviewSubStatuses)
      .map(([role, status]) => `${role}: ${status}`)
      .join(', ');
  }

  if ((stage === 'merging' || stage === 'awaitingMerge') && reviewStatus?.mergeStep) {
    return reviewStatus.mergeStep;
  }

  if (stage === 'buildGate' && reviewStatus?.verificationCycleCount && reviewStatus.verificationCycleCount > 1) {
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
