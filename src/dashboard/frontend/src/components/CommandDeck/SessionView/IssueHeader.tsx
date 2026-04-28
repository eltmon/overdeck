import { useState, useMemo } from 'react';
import { ListTodo, FileText, RefreshCw, ExternalLink, AlertTriangle, ShieldCheck, Package } from 'lucide-react';
import type { ReviewStatus } from '../../inspector/types';
import { isReviewPipelineStuck } from '../../../lib/pipeline-state';
import { ActivitySparkline, type SparklineEvent } from '../ActivitySparkline';
import {
  useActivityQuery,
  usePlanningQuery,
  usePlanningSummaryWithOverridesQuery,
  useReviewStatusQuery,
  type PlanningResponse,
} from '../ZoneCOverviewTabs/queries';
import styles from '../styles/command-deck.module.css';

type PlanningData = PlanningResponse;

type PlanningStageData = Pick<PlanningData, 'prd' | 'state'>;

interface IssueHeaderProps {
  issueId: string;
  title: string;
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
}

type StageStatus = 'done' | 'current' | 'pending' | 'failed' | 'running';

interface StageDotProps {
  label: string;
  stage: StageStatus;
}

function StageDot({ label, stage }: StageDotProps) {
  const color =
    stage === 'done'
      ? 'var(--mc-success, #22c55e)'
      : stage === 'current' || stage === 'running'
        ? 'var(--mc-warning, #f97316)'
        : stage === 'failed'
          ? 'var(--mc-error, #ef4444)'
          : 'var(--mc-border, var(--border))';

  return (
    <span className={styles.pipelineDotGroup} title={`${label}: ${stage}`}>
      <span
        className={styles.pipelineDot}
        style={{
          background: color,
          boxShadow: stage === 'current' ? `0 0 0 2px ${color}40` : undefined,
        }}
      />
      <span className={styles.pipelineDotLabel}>{label}</span>
    </span>
  );
}

/** Derive the six stage statuses from review status + planning state (PAN-830 high-2). */
function deriveStageStatuses(
  reviewStatus: ReviewStatus | undefined,
  planning: PlanningStageData | undefined,
): Array<{ label: string; stage: StageStatus }> {
  const merged = reviewStatus?.mergeStatus === 'merged';
  const hasPlan = !!planning?.prd || !!planning?.state;

  // Planning: done if plan exists, pending otherwise
  const planningStage: StageStatus = merged ? 'done' : hasPlan ? 'done' : 'pending';

  // Work: done if merged or review passed, current if no plan yet (still planning), pending otherwise
  let workStage: StageStatus = merged ? 'done' : hasPlan ? 'current' : 'pending';
  if (reviewStatus?.reviewStatus === 'passed' || reviewStatus?.reviewStatus === 'failed') {
    workStage = 'done';
  }

  // Verify: from verificationStatus
  const verifyStage: StageStatus = merged
    ? 'done'
    : reviewStatus?.verificationStatus === 'passed'
      ? 'done'
      : reviewStatus?.verificationStatus === 'failed'
        ? 'failed'
        : reviewStatus?.verificationStatus === 'running'
          ? 'running'
          : 'pending';

  // Review: from reviewStatus
  const reviewStage: StageStatus = merged
    ? 'done'
    : reviewStatus?.reviewStatus === 'passed'
      ? 'done'
      : reviewStatus?.reviewStatus === 'failed' || reviewStatus?.reviewStatus === 'blocked'
        ? 'failed'
        : reviewStatus?.reviewStatus === 'reviewing'
          ? 'running'
          : 'pending';

  // Test: from testStatus
  const testStage: StageStatus = merged
    ? 'done'
    : reviewStatus?.testStatus === 'passed'
      ? 'done'
      : reviewStatus?.testStatus === 'failed' || reviewStatus?.testStatus === 'dispatch_failed'
        ? 'failed'
        : reviewStatus?.testStatus === 'testing'
          ? 'running'
          : 'pending';

  // Merge: from mergeStatus
  const mergeStage: StageStatus = merged
    ? 'done'
    : reviewStatus?.mergeStatus === 'failed'
      ? 'failed'
      : reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying'
        ? 'running'
        : reviewStatus?.mergeStatus === 'queued'
          ? 'current'
          : 'pending';

  return [
    { label: 'Plan', stage: planningStage },
    { label: 'Work', stage: workStage },
    { label: 'Verify', stage: verifyStage },
    { label: 'Review', stage: reviewStage },
    { label: 'Test', stage: testStage },
    { label: 'Merge', stage: mergeStage },
  ];
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

export function IssueHeader({ issueId, title, url, onOpenBeads }: IssueHeaderProps) {
  const [syncing, setSyncing] = useState(false);

  const planningSummary = usePlanningSummaryWithOverridesQuery(issueId, {
    staleTime: 30_000,
  });
  const reviewStatusQuery = useReviewStatusQuery(issueId);
  const activityQuery = useActivityQuery(issueId);

  const shouldLoadPlanningDetail =
    (planningSummary.data?.transcriptCount ?? 0) > 0
    || (planningSummary.data?.discussionCount ?? 0) > 0
    || (planningSummary.data?.noteCount ?? 0) > 0;

  const planningDetail = usePlanningQuery(issueId, {
    enabled: shouldLoadPlanningDetail,
  });

  const planning = planningDetail.data;
  const reviewStatus = reviewStatusQuery.data as ReviewStatus | undefined;
  const activity = activityQuery.data;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(`/api/command-deck/planning/${issueId}/sync-discussions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracker: 'github' }),
      });
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  const planningForStageStatus = planning ?? (
    planningSummary.data?.hasPrd || planningSummary.data?.hasState
      ? { prd: planningSummary.data.hasPrd ? 'present' : undefined, state: planningSummary.data.hasState ? 'present' : undefined }
      : undefined
  );

  const stageStatuses = useMemo(
    () => deriveStageStatuses(reviewStatus, planningForStageStatus),
    [reviewStatus, planningForStageStatus],
  );
  const stuck = isReviewPipelineStuck(reviewStatus ?? undefined);

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

  // Quality-gate indicator from verification status (PAN-847)
  const qgStatus = reviewStatus?.verificationStatus;
  const qgColor =
    qgStatus === 'passed'
      ? 'var(--mc-success, #22c55e)'
      : qgStatus === 'failed'
        ? 'var(--mc-error, #ef4444)'
        : qgStatus === 'running'
          ? 'var(--mc-warning, #f97316)'
          : undefined;

  return (
    <div className={styles.issueHeader} data-testid="issue-header" data-issue={issueId}>
      {/* Row 1: ID + title + pipeline + cost + sparkline */}
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
          {/* Six stage dots (PAN-830 high-2) */}
          <div className={styles.pipelineDots}>
            {stageStatuses.map((s) => (
              <StageDot key={s.label} label={s.label} stage={s.stage} />
            ))}
          </div>
          {/* Quality-gate mini-badge (PAN-847) */}
          {qgColor && (
            <span
              data-testid="zone-a-qg-badge"
              title={`Quality gates: ${qgStatus}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                fontWeight: 600,
                color: qgColor,
                padding: '1px 5px',
                borderRadius: 4,
                border: `1px solid ${qgColor}40`,
                background: `${qgColor}12`,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              <ShieldCheck size={10} />
              QG
            </span>
          )}
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
                color: ac.percent === 100 ? 'var(--mc-success, #22c55e)' : 'var(--mc-text-muted, var(--muted-foreground))',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--mc-border, var(--border))',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: `${ac.percent}%`,
                    height: '100%',
                    background: ac.percent === 100 ? 'var(--mc-success, #22c55e)' : 'var(--mc-primary, var(--primary))',
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
        </div>
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
            color: 'var(--mc-error, #ef4444)',
            background: 'color-mix(in srgb, var(--mc-error) 8%, transparent)',
            borderBottom: '1px dashed var(--mc-border, var(--border))',
          }}
        >
          <AlertTriangle size={12} />
          Pipeline stuck — review, test, or merge failed. Use Recover to retry.
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
            color: 'var(--mc-warning, #f97316)',
            background: 'color-mix(in srgb, var(--mc-warning) 8%, transparent)',
            borderBottom: '1px dashed var(--mc-border, var(--border))',
          }}
        >
          <Package size={12} />
          {stashCount} stash{stashCount === 1 ? '' : 'es'} in workspace — review and drop to keep the list short
        </div>
      )}

      {/* Row 2: Compact action buttons */}
      <div className={styles.issueHeaderActions}>
        <button className={styles.issueHeaderBtn} onClick={onOpenBeads} title="View beads tasks">
          <ListTodo size={11} />
          Tasks
        </button>

        {/* Density rule: suppress default-value badges (PAN-847 pan-35kn) */}
        {planning?.state && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => alert('STATE.md\n\n' + planning.state)}
            title="View STATE.md"
          >
            <FileText size={11} />
            STATE
          </button>
        )}

        {planning?.prd && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => alert('PRD\n\n' + planning.prd)}
            title="View PRD"
          >
            <FileText size={11} />
            PRD
          </button>
        )}

        {(planning?.discussions?.length ?? 0) > 0 && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => {
              const discussions = planning?.discussions ?? [];
              const content = discussions
                .map((d) => `## ${d.filename ?? 'Discussion'}\n\n${d.content ?? ''}`)
                .join('\n\n---\n\n');
              alert(`Discussions (${discussions.length})\n\n${content}`);
            }}
            title="View discussions"
          >
            Discussions
            <span className={styles.issueHeaderBadge}>{planning?.discussions?.length ?? 0}</span>
          </button>
        )}

        {(planning?.transcripts?.length ?? 0) > 0 && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => {
              const transcripts = planning?.transcripts ?? [];
              const content = transcripts
                .map((t) => `## ${t.filename ?? 'Transcript'}\n\n${t.content ?? ''}`)
                .join('\n\n---\n\n');
              alert(`Transcripts (${transcripts.length})\n\n${content}`);
            }}
            title="View transcripts"
          >
            Transcripts
            <span className={styles.issueHeaderBadge}>{planning?.transcripts?.length ?? 0}</span>
          </button>
        )}

        <button
          className={styles.issueHeaderBtn}
          onClick={handleSync}
          disabled={syncing}
          title="Sync discussions"
        >
          <RefreshCw size={11} className={syncing ? styles.spinning : ''} />
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>
    </div>
  );
}
