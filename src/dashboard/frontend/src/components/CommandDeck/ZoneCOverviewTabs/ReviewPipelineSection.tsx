import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronUp, RotateCcw, Info, GitMerge, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewStatus } from '../../../lib/workspace-types';
import { formatRelativeTime, isStale } from '../../../lib/dashboard-utils';
import { StatusHistory } from './StatusHistory';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../../lib/commandDeckSurfaceRegistry';
import { usePrQuery } from './queries';
import { statusColor } from './PrDiffTab';

const DEFAULT_VERIFICATION_MAX_CYCLES = 10;
const DEFAULT_AUTO_REQUEUE_MAX = 7;
const DEFAULT_MERGE_RETRY_MAX = 3;

interface ReviewPipelineSectionProps {
  reviewStatus: ReviewStatus;
  issueId?: string;
  onViewLog?: () => void;
}

void COMMAND_DECK_SURFACE_REGISTRY;

interface PipelineStep {
  key: string;
  label: string;
  status: string;
  notes?: string;
  isRunning: boolean;
  isFailed: boolean;
  isPassed: boolean;
  isSkipped: boolean;
}

export function ReviewPipelineSection({ reviewStatus, issueId, onViewLog }: ReviewPipelineSectionProps) {
  const [showDetails, setShowDetails] = useState(false);
  const mergeStatus = reviewStatus.mergeStatus ?? 'pending';
  const isMergeActive =
    mergeStatus === 'queued' ||
    mergeStatus === 'merging' ||
    mergeStatus === 'verifying' ||
    mergeStatus === 'failed';
  const prQuery = usePrQuery(issueId ?? '', {
    enabled: isMergeActive && !!issueId,
  });
  const verificationMaxCycles = reviewStatus.verificationMaxCycles ?? DEFAULT_VERIFICATION_MAX_CYCLES;
  const autoRequeueCount = reviewStatus.autoRequeueCount ?? 0;

  const steps: PipelineStep[] = [
    {
      key: 'verify',
      label: 'Build Gate',
      status: reviewStatus.verificationStatus ?? 'pending',
      notes: reviewStatus.verificationNotes,
      isRunning: reviewStatus.verificationStatus === 'running',
      isFailed: reviewStatus.verificationStatus === 'failed',
      isPassed: reviewStatus.verificationStatus === 'passed',
      isSkipped: reviewStatus.verificationStatus === 'skipped',
    },
    {
      key: 'review',
      label: 'Review',
      status: reviewStatus.reviewStatus,
      notes: reviewStatus.reviewNotes,
      isRunning: reviewStatus.reviewStatus === 'reviewing',
      isFailed: reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked',
      isPassed: reviewStatus.reviewStatus === 'passed',
      isSkipped: false,
    },
    {
      key: 'test',
      label: 'Tests',
      status: reviewStatus.testStatus,
      notes: reviewStatus.testNotes,
      isRunning: reviewStatus.testStatus === 'testing',
      isFailed: reviewStatus.testStatus === 'failed' || reviewStatus.testStatus === 'dispatch_failed',
      isPassed: reviewStatus.testStatus === 'passed',
      isSkipped: reviewStatus.testStatus === 'skipped',
    },
    {
      key: 'merge',
      label: 'Merge',
      status: reviewStatus.mergeStatus ?? 'pending',
      notes: reviewStatus.mergeNotes,
      isRunning: reviewStatus.mergeStatus === 'queued' || reviewStatus.mergeStatus === 'merging' || reviewStatus.mergeStatus === 'verifying',
      isFailed: reviewStatus.mergeStatus === 'failed',
      isPassed: reviewStatus.mergeStatus === 'merged',
      isSkipped: false,
    },
  ];

  const hasAnyNotes = steps.some(s => s.notes);
  const hasFailure = steps.some(s => s.isFailed);
  const allPassed = steps.every(s => s.isPassed || s.isSkipped);

  return (
    <div className={`mb-2 rounded-lg border text-xs overflow-hidden ${
      hasFailure
        ? 'border-destructive/30 bg-destructive/5'
        : allPassed
        ? 'border-success/30 bg-success/5'
        : 'border-border bg-card/30'
    }`}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
          {reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400" title={`Last updated ${formatRelativeTime(reviewStatus.updatedAt)}`}>
              <AlertTriangle className="w-3 h-3" />
              <span>Stale</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {autoRequeueCount > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              autoRequeueCount >= DEFAULT_AUTO_REQUEUE_MAX
                ? 'bg-destructive/20 text-destructive'
                : 'bg-card text-muted-foreground'
            }`}>
              <RotateCcw className="w-2.5 h-2.5 inline mr-1" />
              {autoRequeueCount}/{DEFAULT_AUTO_REQUEUE_MAX}
            </span>
          )}
          {autoRequeueCount >= DEFAULT_AUTO_REQUEUE_MAX && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-2.5 h-2.5" />Human review
            </span>
          )}
          {(reviewStatus.mergeRetryCount ?? 0) > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              (reviewStatus.mergeRetryCount ?? 0) >= DEFAULT_MERGE_RETRY_MAX
                ? 'bg-destructive/20 text-destructive'
                : 'bg-card text-muted-foreground'
            }`}>
              <GitMerge className="w-2.5 h-2.5 inline mr-1" />
              Attempt {(reviewStatus.mergeRetryCount ?? 0)}/{DEFAULT_MERGE_RETRY_MAX}
            </span>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1">
          {steps.map((step, idx) => (
            <div key={step.key} className="flex items-center gap-1 flex-1">
              {/* Step indicator */}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md flex-1 ${
                step.isFailed
                  ? 'bg-destructive/10'
                  : step.isPassed
                  ? 'bg-success/10'
                  : step.isRunning
                  ? 'bg-warning/10'
                  : 'bg-card/50'
              }`}>
                <StepIcon step={step} />
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-muted-foreground leading-tight">{step.label}</span>
                  <StatusLabel step={step} />
                </div>
              </div>
              {/* Connector */}
              {idx < steps.length - 1 && (
                <div className={`w-4 h-px shrink-0 ${
                  step.isPassed ? 'bg-success/40' : 'bg-divider'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Verification cycle counter */}
        {reviewStatus.verificationCycleCount !== undefined && reviewStatus.verificationMaxCycles !== undefined && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            <Info className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Cycle</span>
            <span className={`font-medium ${
              (reviewStatus.verificationCycleCount ?? 0) >= verificationMaxCycles
                ? 'text-destructive'
                : 'text-foreground'
            }`}>
              {reviewStatus.verificationCycleCount}/{verificationMaxCycles}
            </span>
          </div>
        )}

        {/* CI check sub-statuses during active merge phase */}
        {issueId && prQuery.data?.pr?.statusCheckRollup && prQuery.data.pr.statusCheckRollup.length > 0 &&
          (reviewStatus.mergeStatus === 'queued' || reviewStatus.mergeStatus === 'merging' || reviewStatus.mergeStatus === 'verifying' || reviewStatus.mergeStatus === 'failed') && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {prQuery.data.pr.statusCheckRollup.map((check, idx) => {
              const c = statusColor(check);
              const name = check.name || check.workflowName || check.__typename || `check-${idx}`;
              const StatusIcon = c.label === 'pass' ? CheckCircle : c.label === 'fail' ? XCircle : c.label === 'run' ? Loader2 : null;
              return (
                <span
                  key={`${name}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                  style={{ background: c.bg, color: c.fg }}
                  title={`${name}: ${c.label}`}
                >
                  {StatusIcon && <StatusIcon className={`w-3 h-3 ${c.label === 'run' ? 'animate-spin' : ''}`} />}
                  <span className="uppercase tracking-wider" style={{ fontSize: 9 }}>{c.label}</span>
                  <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{name}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Merge queue position */}
        {(reviewStatus.queuePosition ?? null) !== null && (reviewStatus.queuePosition ?? 0) > 0 && reviewStatus.activeSpecialist === 'merge' && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            <GitMerge className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Queue position</span>
            <span className="font-medium text-foreground">{reviewStatus.queuePosition}</span>
          </div>
        )}

        {/* Live specialist log link during active merge phase */}
        {onViewLog && (reviewStatus.mergeStatus === 'queued' || reviewStatus.mergeStatus === 'merging' || reviewStatus.mergeStatus === 'verifying') && (
          <button
            onClick={onViewLog}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
            data-testid="merge-live-log-link"
          >
            <Terminal className="w-3 h-3" />
            <span>View live specialist log</span>
          </button>
        )}
      </div>

      {/* Collapsible details */}
      {hasAnyNotes && (
        <>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-3 py-1.5 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
          >
            <span className="flex items-center gap-1">
              {hasFailure && <AlertTriangle className="w-3 h-3 text-destructive" />}
              <span>{hasFailure ? 'Failure details' : 'Details'}</span>
            </span>
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showDetails && (
            <div className="px-3 py-2 border-t border-border bg-card/30 space-y-2 max-h-48 overflow-y-auto">
              {steps.map(step =>
                step.notes ? (
                  <div key={step.key}>
                    <div className="text-[10px] font-medium text-muted-foreground mb-0.5">{step.label}</div>
                    <div className="text-[11px] text-foreground prose-notes">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.notes}</ReactMarkdown>
                    </div>
                  </div>
                ) : null
              )}
            </div>
          )}
        </>
      )}

      {/* History — skip the latest entry since it's current state */}
      {reviewStatus.history && reviewStatus.history.length > 1 && (
        <div className="border-t border-border">
          <StatusHistory history={reviewStatus.history.slice(0, -1)} />
        </div>
      )}
    </div>
  );
}

function StepIcon({ step }: { step: PipelineStep }) {
  if (step.isPassed) {
    return <CheckCircle className="w-4 h-4 text-success shrink-0" />;
  }
  if (step.isFailed) {
    return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
  }
  if (step.isRunning) {
    return <Loader2 className="w-4 h-4 text-warning shrink-0 animate-spin" />;
  }
  if (step.isSkipped) {
    return <span className="w-4 h-4 rounded-full border border-muted-foreground flex items-center justify-center shrink-0">
      <span className="text-[8px] text-muted-foreground">—</span>
    </span>;
  }
  return <span className="w-4 h-4 rounded-full border border-muted-foreground/40 shrink-0" />;
}

function StatusLabel({ step }: { step: PipelineStep }) {
  const label = (() => {
    switch (step.status) {
      case 'passed': return 'Passed';
      case 'failed': return 'Failed';
      case 'blocked': return 'Blocked';
      case 'reviewing': return 'Reviewing...';
      case 'testing': return 'Testing...';
      case 'running': return 'Running...';
      case 'skipped': return 'Skipped';
      case 'dispatch_failed': return 'Dispatch Failed';
      case 'queued': return 'Queued';
      case 'merging': return 'Merging...';
      case 'verifying': return 'Verifying...';
      case 'merged': return 'Merged';
      default: return 'Pending';
    }
  })();

  return (
    <span className={`text-[11px] font-medium leading-tight ${
      step.isPassed ? 'text-success' :
      step.isFailed ? 'text-destructive' :
      step.isRunning ? 'text-warning' :
      step.isSkipped ? 'text-muted-foreground' :
      'text-muted-foreground'
    }`}>
      {label}
    </span>
  );
}
