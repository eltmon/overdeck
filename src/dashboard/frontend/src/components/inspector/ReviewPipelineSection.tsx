import { AlertTriangle } from 'lucide-react';
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

export function ReviewPipelineSection({ reviewStatus }: ReviewPipelineSectionProps) {
  const verificationMaxCycles = reviewStatus.verificationMaxCycles ?? DEFAULT_VERIFICATION_MAX_CYCLES;
  const autoRequeueCount = reviewStatus.autoRequeueCount ?? 0;

  return (
    <div className={`mb-2 p-2 rounded text-xs ${
      reviewStatus.updatedAt && isStale(reviewStatus.updatedAt)
        ? 'bg-surface-raised border border-warning/40'
        : 'bg-surface-emphasis/50'
    }`}>
      {reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) && (
        <div className="flex items-center gap-1 mb-1.5 text-amber-400 text-[10px]">
          <AlertTriangle className="w-3 h-3" />
          <span>Status may be stale ({formatRelativeTime(reviewStatus.updatedAt)})</span>
        </div>
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-content-subtle">Review:</span>
        <span className={
          reviewStatus.reviewStatus === 'passed' ? 'text-success' :
          reviewStatus.reviewStatus === 'blocked' || reviewStatus.reviewStatus === 'failed' ? 'text-destructive' :
          reviewStatus.reviewStatus === 'reviewing' ? 'text-warning' : 'text-content-muted'
        }>
          {reviewStatus.reviewStatus === 'passed' ? '✓ Passed' :
           reviewStatus.reviewStatus === 'blocked' ? '✗ Blocked' :
           reviewStatus.reviewStatus === 'failed' ? '✗ Failed' :
           reviewStatus.reviewStatus === 'reviewing' ? '⟳ Reviewing...' : 'Pending'}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-content-subtle">Tests:</span>
        <span className={
          reviewStatus.testStatus === 'passed' ? 'text-success' :
          reviewStatus.testStatus === 'failed' ? 'text-destructive' :
          reviewStatus.testStatus === 'dispatch_failed' ? 'text-destructive' :
          reviewStatus.testStatus === 'testing' ? 'text-warning' : 'text-content-muted'
        }>
          {reviewStatus.testStatus === 'passed' ? '✓ Passed' :
           reviewStatus.testStatus === 'failed' ? '✗ Failed' :
           reviewStatus.testStatus === 'dispatch_failed' ? '✗ Dispatch Failed' :
           reviewStatus.testStatus === 'testing' ? '⟳ Testing...' :
           reviewStatus.testStatus === 'skipped' ? '⊘ Skipped' : 'Pending'}
        </span>
      </div>
      {reviewStatus.verificationStatus && reviewStatus.verificationStatus !== 'pending' && (
        <div className={`flex items-center gap-2 mb-1 ${
          reviewStatus.verificationStatus === 'failed'
            ? 'badge-bg-destructive rounded px-1 -mx-1'
            : reviewStatus.verificationStatus === 'running'
            ? 'badge-bg-warning rounded px-1 -mx-1'
            : ''
        }`}>
          <span className="text-content-subtle">Verify:</span>
          <span className={
            reviewStatus.verificationStatus === 'passed' ? 'text-success' :
            reviewStatus.verificationStatus === 'failed' ? 'text-destructive' :
            reviewStatus.verificationStatus === 'skipped' ? 'text-content-muted' :
            'text-warning'
          }>
            {reviewStatus.verificationStatus === 'passed' ? '✓ Passed' :
             reviewStatus.verificationStatus === 'failed' ? '✗ Failed' :
             reviewStatus.verificationStatus === 'skipped' ? '⊘ Skipped' :
             '⟳ Running...'}
          </span>
          {(reviewStatus.verificationCycleCount ?? 0) > 0 && (
            <span className={`text-[10px] ${(reviewStatus.verificationCycleCount ?? 0) >= verificationMaxCycles ? 'text-destructive' : 'text-content-muted'}`}>
              Attempt {reviewStatus.verificationCycleCount}/{verificationMaxCycles}
            </span>
          )}
        </div>
      )}
      {reviewStatus.verificationStatus === 'failed' && reviewStatus.verificationNotes && (
        <div className="text-[10px] text-destructive/80 mt-0.5 ml-2">{reviewStatus.verificationNotes}</div>
      )}
      {autoRequeueCount > 0 && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-content-subtle">Cycles:</span>
          <span className={autoRequeueCount >= DEFAULT_AUTO_REQUEUE_MAX ? 'text-destructive font-medium' : 'text-content'}>
            {autoRequeueCount}/{DEFAULT_AUTO_REQUEUE_MAX}
          </span>
          {autoRequeueCount >= DEFAULT_AUTO_REQUEUE_MAX && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-2.5 h-2.5" />Human review needed
            </span>
          )}
        </div>
      )}
      {reviewStatus.reviewNotes && (
        <div className="mt-2 text-xs text-content prose-notes">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewStatus.reviewNotes}</ReactMarkdown>
        </div>
      )}
      {reviewStatus.testNotes && (
        <div className="mt-2 text-xs text-content prose-notes">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewStatus.testNotes}</ReactMarkdown>
        </div>
      )}
      {reviewStatus.history && reviewStatus.history.length > 0 && <StatusHistory history={reviewStatus.history} />}
    </div>
  );
}
