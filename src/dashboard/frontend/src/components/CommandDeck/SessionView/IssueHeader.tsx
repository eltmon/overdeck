import { useMemo } from 'react';
import {
  ExternalLink, AlertTriangle, Package,
  CheckCircle2, Loader2, AlertCircle, CircleDot,
} from 'lucide-react';
import { isIssueStuck } from '../../../lib/pipeline-state';
import { ActivitySparkline, type SparklineEvent } from '../ActivitySparkline';
import {
  useActivityQuery,
  usePlanningSummaryWithOverridesQuery,
  type PlanningSummaryResponse,
} from '../ZoneCOverviewTabs/queries';
import styles from '../styles/command-deck.module.css';
import { useDerivedIssueState } from '../../../lib/store';
import type { DerivedIssueState } from '../../../types';
import { AutoMergeToggle } from '../../AutoMergeToggle';
import { IssuePolicyStrip } from '../../IssuePolicyStrip';

type PlanningStageData = Pick<PlanningSummaryResponse, 'hasPrd' | 'hasState'>;

interface IssueHeaderProps {
  issueId: string;
  title: string;
  source?: string;
  url?: string;
}

type StageStatus = 'done' | 'current' | 'pending' | 'failed' | 'running';

interface StagePillProps {
  label: string;
  stage: StageStatus;
  isLast?: boolean;
}

const STAGE_CONFIG: Record<StageStatus, { bg: string; border: string; text: string; icon: React.ElementType; glow?: string }> = {
  done:    { bg: 'color-mix(in srgb, var(--success) 12%, transparent)', border: 'var(--success)', text: 'var(--success)', icon: CheckCircle2 },
  current: { bg: 'color-mix(in srgb, var(--warning) 15%, transparent)', border: 'var(--warning)', text: 'var(--warning)', icon: Loader2, glow: '0 0 12px color-mix(in srgb, var(--warning) 40%, transparent)' },
  running: { bg: 'color-mix(in srgb, var(--primary) 15%, transparent)', border: 'var(--primary)', text: 'var(--primary)', icon: Loader2, glow: '0 0 12px color-mix(in srgb, var(--primary) 40%, transparent)' },
  failed:  { bg: 'color-mix(in srgb, var(--destructive) 12%, transparent)', border: 'var(--destructive)', text: 'var(--destructive)', icon: AlertCircle },
  pending: { bg: 'transparent', border: 'var(--border)', text: 'var(--muted-foreground)', icon: CircleDot },
};

function StagePill({ label, stage, isLast }: StagePillProps) {
  const cfg = STAGE_CONFIG[stage];
  const Icon = cfg.icon;
  const isActive = stage === 'current' || stage === 'running';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <span
        title={`${label}: ${stage}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 10px',
          borderRadius: 999,
          border: `1.5px solid ${cfg.border}`,
          background: cfg.bg,
          color: cfg.text,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          boxShadow: isActive ? cfg.glow : undefined,
          whiteSpace: 'nowrap',
          transition: 'all 0.2s ease',
        }}
      >
        <Icon size={13} className={isActive ? 'animate-spin' : undefined} style={{ flexShrink: 0 }} />
        {label}
      </span>
      {!isLast && (
        <span
          style={{
            display: 'inline-block',
            width: 16,
            height: 2,
            background: stage === 'done' ? 'var(--success)' : 'var(--border)',
            margin: '0 4px',
            flexShrink: 0,
          }}
        />
      )}
    </div>
  );
}

/**
 * The five stages the derived issue state can actually answer (PAN-3917 FR-6).
 * There is no Verify or Test stage: verification is a workspace artifact plus a
 * check run (FR-8), and the forge's check rollup is the Checks stage.
 */
function deriveStageStatuses(
  derived: DerivedIssueState | undefined,
  planning: PlanningStageData | undefined,
): Array<{ label: string; stage: StageStatus }> {
  const state = derived?.state;
  const merged = state === 'merged';
  const hasPlan = planning?.hasPrd === true || planning?.hasState === true;
  const reviewing = state === 'in-review' || state === 'changes-requested';
  const pastReview = merged || state === 'ready';

  const planStage: StageStatus = merged || hasPlan || state === 'planned' || state === 'working' || reviewing || pastReview
    ? 'done'
    : 'pending';

  const workStage: StageStatus = reviewing || pastReview
    ? 'done'
    : state === 'working'
      ? 'running'
      : hasPlan ? 'current' : 'pending';

  const reviewStage: StageStatus = pastReview
    ? 'done'
    : state === 'changes-requested'
      ? 'failed'
      : state === 'in-review'
        ? 'running'
        : 'pending';

  const checks = derived?.pr?.checks;
  const checksStage: StageStatus = checks === 'green'
    ? 'done'
    : checks === 'red'
      ? 'failed'
      : checks === 'pending'
        ? 'running'
        : 'pending';

  const mergeStage: StageStatus = merged
    ? 'done'
    : state === 'ready'
      ? 'current'
      : derived?.pr?.mergeable === false
        ? 'failed'
        : 'pending';

  return [
    { label: 'Plan', stage: planStage },
    { label: 'Work', stage: workStage },
    { label: 'Review', stage: reviewStage },
    { label: 'Checks', stage: checksStage },
    { label: 'Merge', stage: mergeStage },
  ];
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

export function IssueHeader({ issueId, title, url }: IssueHeaderProps) {

  const planningSummary = usePlanningSummaryWithOverridesQuery(issueId, {
    staleTime: 30_000,
  });
  const activityQuery = useActivityQuery(issueId);

  const derived = useDerivedIssueState(issueId);
  const activity = activityQuery.data;

  const planningForStageStatus = planningSummary.data;

  const stageStatuses = useMemo(
    () => deriveStageStatuses(derived, planningForStageStatus),
    [derived, planningForStageStatus],
  );
  const stuck = isIssueStuck(derived);

  // Activity sparkline events from session sections (PAN-847)
  const sparklineEvents = useMemo<SparklineEvent[]>(() => {
    const sections = activity?.sections ?? [];
    return sections
      .map((s) => ({
        timestamp: Date.parse(s.startedAt),
        category: (
          {
            planning: 'info' as const,
            work: 'info' as const,
            review: 'review' as const,
            reviewer: 'review' as const,
            test: 'success' as const,
            merge: 'success' as const,
            legacy: 'warning' as const,
          } as const
        )[s.type as string] ?? 'info',
      }))
      .filter((e) => !Number.isNaN(e.timestamp));
  }, [activity]);

  const ac = planningSummary.data?.acceptanceProgress;
  const stashCount = planningSummary.data?.stashCount ?? 0;
  const resolvedTotalCost = activity?.resolvedTotalCost ?? null;

  return (
    <div className={styles.issueHeader} data-testid="issue-header" data-issue={issueId}>
      {/* Row 1: ID + title + metadata */}
      <div className={styles.issueHeaderRow}>
        <div className={styles.issueHeaderLeft}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.issueHeaderId}
            >
              {issueId}
              <ExternalLink size={10} style={{ marginLeft: 4, opacity: 0.6 }} />
            </a>
          ) : (
            <span className={styles.issueHeaderId}>{issueId}</span>
          )}
          <span className={styles.issueHeaderTitle}>{title}</span>
        </div>
        <div className={styles.issueHeaderRight}>
          {/* Acceptance progress (PAN-847) */}
          {ac && ac.total > 0 && (
            <span
              data-testid="zone-a-ac-progress"
              title={`Acceptance criteria: ${ac.completed}/${ac.total}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                fontWeight: 600,
                color: ac.percent === 100 ? 'var(--success)' : 'var(--muted-foreground)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--border)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: `${ac.percent}%`,
                    height: '100%',
                    background: ac.percent === 100 ? 'var(--success)' : 'var(--primary)',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }}
                />
              </span>
              {ac.percent}%
            </span>
          )}
          {/* Activity sparkline (PAN-847) */}
          {sparklineEvents.length > 0 && (
            <ActivitySparkline
              events={sparklineEvents}
              width={80}
              height={14}
              windowMinutes={120}
              buckets={8}
            />
          )}
          {resolvedTotalCost !== null && (
            <span className={styles.issueHeaderCost} data-testid="zone-a-cost">{formatCost(resolvedTotalCost)}</span>
          )}
          <IssuePolicyStrip issueId={issueId} />
          <AutoMergeToggle issueId={issueId} compact />
        </div>
      </div>

      {/* Row 2: Prominent pipeline progress tracker */}
      <div
        data-testid="issue-pipeline"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '8px 0',
          overflowX: 'auto',
        }}
      >
        {stageStatuses.map((s, i) => (
          <StagePill key={s.label} label={s.label} stage={s.stage} isLast={i === stageStatuses.length - 1} />
        ))}
      </div>

      {/* Stuck warning ribbon (PAN-830 high-2) */}
      {stuck && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 12px',
            fontSize: 11,
            color: 'var(--destructive)',
            background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
            borderBottom: '1px dashed var(--border)',
          }}
        >
          <AlertTriangle size={12} />
          {derived?.attention === 'api-error'
            ? 'Provider errors — the agent cannot make a call.'
            : 'Stuck — nothing is moving this issue forward.'}
        </div>
      )}

      {/* Stash warning ribbon (PAN-847) */}
      {stashCount > 0 && (
        <div
          data-testid="zone-a-stash-warning"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 12px',
            fontSize: 11,
            color: 'var(--warning)',
            background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            borderBottom: '1px dashed var(--border)',
          }}
        >
          <Package size={12} />
          {stashCount} stash{stashCount === 1 ? '' : 'es'} in workspace — review and drop to keep the list short
        </div>
      )}

    </div>
  );
}
