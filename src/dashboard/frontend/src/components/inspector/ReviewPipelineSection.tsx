import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronUp, RotateCcw, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewStatus } from './types';
import { formatRelativeTime, isStale } from './utils';
import { StatusHistory } from './StatusHistory';

const DEFAULT_VERIFICATION_MAX_CYCLES = 10;
const DEFAULT_AUTO_REQUEUE_MAX = 7;

interface ReviewPipelineSectionProps {
  reviewStatus: ReviewStatus;
}

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

export function ReviewPipelineSection({ reviewStatus }: ReviewPipelineSectionProps) {
  const [showDetails, setShowDetails] = useState(false);
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

        {/* Verification attempt counter */}
        {(reviewStatus.verificationCycleCount ?? 0) > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            <Info className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Verification attempt</span>
            <span className={`font-medium ${
              (reviewStatus.verificationCycleCount ?? 0) >= verificationMaxCycles
                ? 'text-destructive'
                : 'text-foreground'
            }`}>
              {reviewStatus.verificationCycleCount}/{verificationMaxCycles}
            </span>
          </div>
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
