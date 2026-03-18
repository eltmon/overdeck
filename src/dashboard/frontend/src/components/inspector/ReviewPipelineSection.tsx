import { AlertTriangle } from 'lucide-react';
import { StatusHistory } from './StatusHistory';

interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge';
  status: string;
  timestamp: string;
  notes?: string;
}

interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped';
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  history?: StatusHistoryEntry[];
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(isoString: string, thresholdMinutes = 30): boolean {
  return Date.now() - new Date(isoString).getTime() > thresholdMinutes * 60 * 1000;
}

interface ReviewPipelineSectionProps {
  reviewStatus: ReviewStatus;
}

export function ReviewPipelineSection({ reviewStatus }: ReviewPipelineSectionProps) {
  return (
    <div className={`mb-2 p-2 rounded text-xs ${
      reviewStatus.updatedAt && isStale(reviewStatus.updatedAt)
        ? 'bg-amber-900/20 border border-amber-700/30'
        : 'bg-pan-border/50'
    }`}>
      {reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) && (
        <div className="flex items-center gap-1 mb-1.5 text-amber-400 text-[10px]">
          <AlertTriangle className="w-3 h-3" />
          <span>Status may be stale ({formatRelativeTime(reviewStatus.updatedAt)})</span>
        </div>
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-pan-text-secondary">Review:</span>
        <span className={
          reviewStatus.reviewStatus === 'passed' ? 'text-green-400' :
          reviewStatus.reviewStatus === 'blocked' || reviewStatus.reviewStatus === 'failed' ? 'text-red-400' :
          reviewStatus.reviewStatus === 'reviewing' ? 'text-yellow-400' : 'text-gray-500'
        }>
          {reviewStatus.reviewStatus === 'passed' ? '✓ Passed' :
           reviewStatus.reviewStatus === 'blocked' ? '✗ Blocked' :
           reviewStatus.reviewStatus === 'failed' ? '✗ Failed' :
           reviewStatus.reviewStatus === 'reviewing' ? '⟳ Reviewing...' : 'Pending'}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-pan-text-secondary">Tests:</span>
        <span className={
          reviewStatus.testStatus === 'passed' ? 'text-green-400' :
          reviewStatus.testStatus === 'failed' ? 'text-red-400' :
          reviewStatus.testStatus === 'testing' ? 'text-yellow-400' : 'text-gray-500'
        }>
          {reviewStatus.testStatus === 'passed' ? '✓ Passed' :
           reviewStatus.testStatus === 'failed' ? '✗ Failed' :
           reviewStatus.testStatus === 'testing' ? '⟳ Testing...' :
           reviewStatus.testStatus === 'skipped' ? '⊘ Skipped' : 'Pending'}
        </span>
      </div>
      {reviewStatus.verificationStatus && reviewStatus.verificationStatus !== 'pending' && (
        <div className={`flex items-center gap-2 mb-1 ${
          reviewStatus.verificationStatus === 'failed'
            ? 'bg-red-900/20 rounded px-1 -mx-1'
            : reviewStatus.verificationStatus === 'running'
            ? 'bg-yellow-900/10 rounded px-1 -mx-1'
            : ''
        }`}>
          <span className="text-pan-text-secondary">Verify:</span>
          <span className={
            reviewStatus.verificationStatus === 'passed' ? 'text-green-400' :
            reviewStatus.verificationStatus === 'failed' ? 'text-red-400' :
            reviewStatus.verificationStatus === 'skipped' ? 'text-gray-500' :
            'text-yellow-400'
          }>
            {reviewStatus.verificationStatus === 'passed' ? '✓ Passed' :
             reviewStatus.verificationStatus === 'failed' ? '✗ Failed' :
             reviewStatus.verificationStatus === 'skipped' ? '⊘ Skipped' :
             '⟳ Running...'}
          </span>
          {(reviewStatus.verificationCycleCount ?? 0) > 0 && (
            <span className={`text-[10px] ${(reviewStatus.verificationCycleCount ?? 0) >= (reviewStatus.verificationMaxCycles ?? 3) ? 'text-red-400' : 'text-gray-500'}`}>
              Attempt {reviewStatus.verificationCycleCount}/{reviewStatus.verificationMaxCycles ?? 3}
            </span>
          )}
        </div>
      )}
      {reviewStatus.verificationStatus === 'failed' && reviewStatus.verificationNotes && (
        <div className="text-[10px] text-red-300 mt-0.5 ml-2">{reviewStatus.verificationNotes}</div>
      )}
      {(reviewStatus.autoRequeueCount ?? 0) > 0 && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-pan-text-secondary">Cycles:</span>
          <span className={(reviewStatus.autoRequeueCount ?? 0) >= 3 ? 'text-red-400 font-medium' : 'text-white'}>
            {reviewStatus.autoRequeueCount}/3
          </span>
          {(reviewStatus.autoRequeueCount ?? 0) >= 3 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-2.5 h-2.5" />Human review needed
            </span>
          )}
        </div>
      )}
      {reviewStatus.reviewNotes && <div className="mt-1 text-xs text-pan-text-secondary">{reviewStatus.reviewNotes}</div>}
      {reviewStatus.testNotes && <div className="mt-1 text-xs text-pan-text-secondary">{reviewStatus.testNotes}</div>}
      {reviewStatus.history && reviewStatus.history.length > 0 && <StatusHistory history={reviewStatus.history} />}
    </div>
  );
}
