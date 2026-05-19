/**
 * WorkspaceStatusOverview — shared workspace status + actions used by both
 * the kanban IssueCard and the Issue Drawer. This ensures both views show
 * the same pipeline status, action buttons, and state badges.
 */

import { useState, useEffect } from 'react';
import {
  Loader2,
  CheckCircle,
  RefreshCw,
  Play,
  Square,
  RotateCcw,
  Send,
  AlertTriangle,
  FolderPlus,
  Check,
  X,
} from 'lucide-react';
import { Issue, Agent, WorkAgentLifecycle, STATUS_LABELS } from '../types';
import type { ReviewStatus, WorkspaceInfo } from '../lib/workspace-types';
import { ReviewPipelineSection } from './CommandDeck/ZoneCOverviewTabs/ReviewPipelineSection';
import { isReviewPipelineStuck } from '../lib/pipeline-state';
import { getFriendlyModelName } from '../lib/dashboard-utils';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../lib/commandDeckSurfaceRegistry';

export interface WorkspaceStatusOverviewProps {
  issue: Issue;
  agent?: Agent;
  planningAgent?: Agent;
  reviewStatus?: ReviewStatus;
  workspace?: WorkspaceInfo;
  lifecycle?: WorkAgentLifecycle;
  agentLaunchState?: 'starting' | 'resuming' | null;
  layout: 'compact' | 'full';
  mergePending?: boolean;
  reviewPending?: boolean;
  killPending?: boolean;
  startPending?: boolean;
  resumePending?: boolean;
  recoverPending?: boolean;
  reopenPending?: boolean;
  cancelPending?: boolean;
  createWorkspacePending?: boolean;
  resetSessionPending?: boolean;
  resetSessionSuccess?: boolean;
  dismissPending?: boolean;
  showResumeInput?: boolean;
  resumeMessage?: string;
  onMerge?: () => void;
  onReview?: () => void;
  onKill?: () => void;
  onStartAgent?: (message?: string) => void;
  onResumeAgent?: () => void;
  onRecoverPipeline?: () => void;
  onReopen?: () => void;
  onCancel?: () => void;
  onCreateWorkspace?: () => void;
  onResetSession?: () => void;
  onDismissPending?: () => void;
  onToggleResumeInput?: (show: boolean) => void;
  onResumeMessageChange?: (msg: string) => void;
  isSelected?: boolean;
}

void COMMAND_DECK_SURFACE_REGISTRY;

const STUCK_MERGE_MS = 2 * 60 * 1000;

export function WorkspaceStatusOverview({
  issue,
  agent,
  reviewStatus,
  workspace,
  lifecycle,
  agentLaunchState,
  layout,
  mergePending,
  reviewPending,
  killPending,
  startPending,
  resumePending,
  recoverPending,
  reopenPending,
  createWorkspacePending,
  resetSessionPending,
  resetSessionSuccess,
  showResumeInput,
  resumeMessage,
  onMerge,
  onReview,
  onKill,
  onStartAgent,
  onResumeAgent,
  onRecoverPipeline,
  onReopen,
  onCreateWorkspace,
  onResetSession,
  onToggleResumeInput,
  onResumeMessageChange,
}: WorkspaceStatusOverviewProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (reviewStatus?.mergeStatus !== 'merging') return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [reviewStatus?.mergeStatus]);

  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const isMerged = reviewStatus?.mergeStatus === 'merged' || issue.mergeStatus === 'merged' || issue.labels?.some(l => l.toLowerCase() === 'merged');
  const isTerminal = isMerged || canonical === 'done' || canonical === 'canceled';
  const isReadyToMerge = !isMerged && reviewStatus?.readyForMerge === true;
  const isPipelineStuck = !isTerminal && canonical === 'in_review' && isReviewPipelineStuck(reviewStatus);
  const hasVerificationState = !!reviewStatus?.verificationStatus && reviewStatus.verificationStatus !== 'pending';
  const showPipelineStatus = !!reviewStatus && (
    reviewStatus.reviewStatus !== 'pending'
    || reviewStatus.testStatus !== 'pending'
    || hasVerificationState
  );

  // PAN-1048: standby = stopped work agent with a live tmux session.
  const isStandby = agent?.status === 'stopped' && (agent?.role ?? 'work') === 'work' && !!lifecycle?.hasLiveTmuxSession;
  const isRunning = agent && agent.status !== 'dead' && (agent.status !== 'stopped' || isStandby);
  const isLaunching = agentLaunchState === 'starting' || agentLaunchState === 'resuming';
  const launchLabel = agentLaunchState === 'resuming' ? 'Resuming...' : 'Starting...';
  const isResume = !!agent && agent.status === 'stopped' && !isStandby && lifecycle?.canResumeSession === true && !resetSessionSuccess;
  const isLifecycleUnresolved = !!agent && agent.status === 'stopped' && !isStandby && !lifecycle;

  const mergingElapsed = reviewStatus?.mergeStatus === 'merging' && reviewStatus.updatedAt
    ? now - new Date(reviewStatus.updatedAt).getTime()
    : 0;
  const isMergeStuck = mergingElapsed > STUCK_MERGE_MS;
  const isReReview = reviewStatus?.readyForMerge
    || (reviewStatus?.reviewStatus === 'passed' && reviewStatus?.testStatus === 'passed' && reviewStatus?.mergeStatus === 'failed');

  const reviewActionHint = !reviewStatus ? null : (() => {
    if (reviewStatus.verificationStatus === 'failed') {
      return { label: 'Next: Review & Test', detail: reviewStatus.verificationNotes || 'Verification failed.' };
    }
    if (reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked') {
      return { label: 'Next: Review & Test', detail: reviewStatus.reviewNotes || 'Review did not pass.' };
    }
    if (reviewStatus.testStatus === 'failed' || reviewStatus.testStatus === 'dispatch_failed') {
      return { label: 'Next: Review & Test', detail: reviewStatus.testNotes || 'Tests failed.' };
    }
    if (reviewStatus.mergeStatus === 'failed') {
      return { label: 'Next: Re-Review', detail: 'Merge did not complete.' };
    }
    return null;
  })();
  const shouldPromoteReviewAction = !!reviewActionHint || !!reviewStatus?.readyForMerge;

  // ─── Compact layout (kanban card) ───
  if (layout === 'compact') {
    const actionBarClass = 'mt-3 flex items-center gap-2 flex-wrap rounded-xl border border-border/70 bg-card/80 px-2.5 py-2';

    return (
      <div className="space-y-2">
        {/* Pipeline status */}
        {showPipelineStatus && reviewStatus && (
          <div className="mt-2">
            <ReviewPipelineSection reviewStatus={reviewStatus} issueId={issue.id} />
          </div>
        )}
        {reviewActionHint && (
          <div className="mt-2 rounded-xl border border-warning/40 badge-bg-warning px-3 py-2 text-xs text-warning-foreground">
            <div className="font-medium">{reviewActionHint.label}</div>
            <div className="mt-1 text-warning-foreground/80">{reviewActionHint.detail}</div>
          </div>
        )}

        {/* Running agent actions */}
        {isRunning && (
          <div className={actionBarClass}>
            {canonical === 'in_review' && isReadyToMerge && onMerge && (
              <button
                onClick={(e) => { e.stopPropagation(); onMerge(); }}
                disabled={mergePending || ((reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying' || reviewStatus?.mergeStatus === 'queued') && !isMergeStuck)}
                className={`flex items-center gap-1 text-xs rounded font-medium px-2 py-1 ${
                  isMergeStuck
                    ? 'bg-warning text-warning-foreground hover:bg-warning/90'
                    : 'bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50'
                }`}
              >
                {mergePending ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 isMergeStuck ? <AlertTriangle className="w-3 h-3" /> :
                 reviewStatus?.mergeStatus === 'verifying' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 reviewStatus?.mergeStatus === 'merging' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 <CheckCircle className="w-3 h-3" />}
                {isMergeStuck ? 'RETRY MERGE' :
                 reviewStatus?.mergeStatus === 'queued' ? 'QUEUED' :
                 reviewStatus?.mergeStatus === 'verifying' ? 'VERIFYING...' :
                 reviewStatus?.mergeStatus === 'merging' ? 'REBASING...' : 'MERGE'}
              </button>
            )}
            {canonical === 'in_review' && onReview && (
              <button
                onClick={(e) => { e.stopPropagation(); onReview(); }}
                disabled={reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
                className={`flex items-center gap-1 text-xs rounded disabled:opacity-50 px-2 py-1 ${
                  shouldPromoteReviewAction
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {(reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ?
                  <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {isReReview ? 'Re-Review' : 'Review & Test'}
              </button>
            )}
            {canonical === 'in_review' && isPipelineStuck && onRecoverPipeline && (
              <button
                onClick={(e) => { e.stopPropagation(); onRecoverPipeline(); }}
                disabled={recoverPending}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {recoverPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {recoverPending ? 'Recovering...' : 'Recover'}
              </button>
            )}
            {onKill && (
              <button
                onClick={(e) => { e.stopPropagation(); onKill(); }}
                disabled={killPending}
                className="flex items-center text-xs text-destructive-foreground hover:text-destructive-foreground/80 transition-colors"
                title="Kill"
              >
                {killPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              </button>
            )}
            {agent?.model && (
              <span className="flex-1 text-center text-[10px] text-foreground font-medium">
                {getFriendlyModelName(agent.model)}
              </span>
            )}
          </div>
        )}

        {/* In Review actions */}
        {!isRunning && canonical === 'in_review' && (
          <>
            <div className={actionBarClass}>
              {isReadyToMerge && onMerge && (
                <button
                  onClick={(e) => { e.stopPropagation(); onMerge(); }}
                  disabled={mergePending || ((reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying' || reviewStatus?.mergeStatus === 'queued') && !isMergeStuck)}
                  className={`flex items-center gap-1 text-xs rounded font-medium px-2 py-1 ${
                    isMergeStuck
                      ? 'bg-warning text-warning-foreground hover:bg-warning/90'
                      : 'bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50'
                  }`}
                >
                  {mergePending ? <Loader2 className="w-3 h-3 animate-spin" /> :
                   isMergeStuck ? <AlertTriangle className="w-3 h-3" /> :
                   reviewStatus?.mergeStatus === 'verifying' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                   reviewStatus?.mergeStatus === 'merging' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                   <CheckCircle className="w-3 h-3" />}
                  {isMergeStuck ? 'RETRY MERGE' :
                   reviewStatus?.mergeStatus === 'queued' ? 'QUEUED' :
                   reviewStatus?.mergeStatus === 'verifying' ? 'VERIFYING...' :
                   reviewStatus?.mergeStatus === 'merging' ? 'REBASING...' : 'MERGE'}
                </button>
              )}
              {onReview && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReview(); }}
                  disabled={reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
                  className={`flex items-center gap-1 text-xs rounded disabled:opacity-50 px-2 py-1 ${
                    shouldPromoteReviewAction
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {(reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ?
                    <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {isReReview ? 'Re-Review' : 'Review & Test'}
                </button>
              )}
              {isPipelineStuck && onRecoverPipeline && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRecoverPipeline(); }}
                  disabled={recoverPending}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {recoverPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  {recoverPending ? 'Recovering...' : 'Recover'}
                </button>
              )}
              {isResume && onResumeAgent && (
                <button
                  onClick={(e) => { e.stopPropagation(); onResumeAgent(); }}
                  disabled={resumePending}
                  className="flex items-center gap-1 text-xs font-medium text-warning-foreground hover:opacity-80 transition-colors disabled:opacity-50"
                >
                  {resumePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {resumePending ? 'Resuming...' : 'Resume Session'}
                </button>
              )}
              {isMerged && (
                <span className="flex items-center gap-1 px-2 py-1 text-xs badge-bg-success text-success rounded font-medium">
                  <CheckCircle className="w-3 h-3" />MERGED
                </span>
              )}
            </div>
          </>
        )}

        {/* Start/Resume for non-running, non-review */}
        {!isRunning && canonical !== 'in_review' && !isTerminal && (
          <div className={actionBarClass}>
            {isLaunching ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded badge-bg-primary text-primary-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                {launchLabel}
              </span>
            ) : isResume && onResumeAgent ? (
              <button
                onClick={(e) => { e.stopPropagation(); onResumeAgent(); }}
                disabled={resumePending}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                {resumePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {resumePending ? 'Resuming...' : 'Resume Session'}
              </button>
            ) : onStartAgent ? (
              <button
                onClick={(e) => { e.stopPropagation(); onStartAgent(); }}
                disabled={startPending || isLaunching || isLifecycleUnresolved}
                className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-60 ${
                  isLifecycleUnresolved
                    ? 'text-destructive cursor-not-allowed'
                    : 'text-primary hover:text-primary/80'
                }`}
                title={isLifecycleUnresolved ? 'Checking for resumable session…' : undefined}
              >
                {(startPending || isLaunching || isLifecycleUnresolved) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {isLifecycleUnresolved ? 'Checking…' : ((startPending || isLaunching) ? 'Starting...' : 'Start Agent')}
              </button>
            ) : null}
            {!workspace?.exists && onCreateWorkspace && (
              <button
                onClick={(e) => { e.stopPropagation(); onCreateWorkspace(); }}
                disabled={createWorkspacePending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-card-foreground rounded disabled:opacity-50 border bg-card border-border"
              >
                {createWorkspacePending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                {createWorkspacePending ? 'Creating...' : 'Create Workspace'}
              </button>
            )}
          </div>
        )}

        {/* Resume message input */}
        {showResumeInput && onStartAgent && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <label className="text-xs text-muted-foreground">Message for agent (optional):</label>
            <textarea
              value={resumeMessage || ''}
              onChange={(e) => onResumeMessageChange?.(e.target.value)}
              placeholder="Tell the agent what to do..."
              className="w-full px-2 py-1.5 text-xs bg-card border border-border rounded resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  onStartAgent(resumeMessage || undefined);
                  onToggleResumeInput?.(false);
                }
                if (e.key === 'Escape') {
                  onToggleResumeInput?.(false);
                }
              }}
            />
            <div className="flex items-center gap-1.5 mt-1">
              <button
                onClick={() => {
                  onStartAgent(resumeMessage || undefined);
                  onToggleResumeInput?.(false);
                }}
                disabled={startPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-primary-foreground rounded bg-primary hover:bg-primary/90 disabled:opacity-50 font-medium"
              >
                {startPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {startPending ? 'Resuming...' : 'Resume'}
              </button>
              <button
                onClick={() => onToggleResumeInput?.(false)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:bg-card"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Full layout (inspector panel) ───
  return (
    <div className="space-y-2">
      {/* Pipeline status */}
      {showPipelineStatus && reviewStatus && (
        <ReviewPipelineSection reviewStatus={reviewStatus} />
      )}
      {reviewActionHint && (
        <div
          className="mt-2 rounded border border-warning/40 badge-bg-warning px-2 py-1.5 text-xs text-warning-foreground"
        >
          <div className="font-medium">{reviewActionHint.label}</div>
          <div className="mt-1 text-warning-foreground/80">{reviewActionHint.detail}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {/* MERGE button */}
        {isReadyToMerge && reviewStatus?.mergeStatus !== 'merged' && onMerge && (
          <button
            onClick={onMerge}
            disabled={mergePending || ((reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying' || reviewStatus?.mergeStatus === 'queued') && !isMergeStuck)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded font-medium ${
              isMergeStuck
                ? 'bg-warning text-warning-foreground hover:bg-warning/90'
                : 'bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50'
            }`}
          >
            {mergePending ? <Loader2 className="w-3 h-3 animate-spin" /> :
             isMergeStuck ? <AlertTriangle className="w-3 h-3" /> :
             reviewStatus?.mergeStatus === 'verifying' ? <Loader2 className="w-3 h-3 animate-spin" /> :
             reviewStatus?.mergeStatus === 'merging' ? <Loader2 className="w-3 h-3 animate-spin" /> :
             <CheckCircle className="w-3 h-3" />}
            {isMergeStuck ? 'RETRY MERGE' :
             reviewStatus?.mergeStatus === 'queued' ? 'QUEUED' :
             reviewStatus?.mergeStatus === 'verifying' ? 'VERIFYING...' :
             reviewStatus?.mergeStatus === 'merging' ? 'REBASING...' : 'MERGE'}
          </button>
        )}
        {reviewStatus?.mergeStatus === 'merged' && (
          <span className="flex items-center gap-1 px-2 py-1 text-xs badge-bg-success text-success rounded font-medium">
            <CheckCircle className="w-3 h-3" />MERGED
          </span>
        )}

        {/* Review & Test */}
        {onReview && (
          <button
            onClick={onReview}
            disabled={reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${
              shouldPromoteReviewAction
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {(reviewPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ?
              <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {isReReview ? 'Re-Review' : 'Review & Test'}
          </button>
        )}

        {/* Stop Agent */}
        {agent && agent.status !== 'stopped' && onKill && (
          <button
            onClick={onKill}
            disabled={killPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-destructive rounded badge-bg-destructive hover:bg-destructive/20"
          >
            <Square className="w-3 h-3" />Stop
          </button>
        )}

        {/* Reopen button */}
        {reviewStatus && (reviewStatus.reviewStatus === 'passed' || reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked' || reviewStatus.testStatus === 'passed' || reviewStatus.testStatus === 'failed' || reviewStatus.mergeStatus === 'merged') && onReopen && (
          <button
            onClick={onReopen}
            disabled={reopenPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
          >
            {reopenPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {reopenPending ? 'Reopening...' : 'Reopen'}
          </button>
        )}

        {/* Recover failed pipeline */}
        {reviewStatus && isPipelineStuck && onRecoverPipeline && (
          <button
            onClick={onRecoverPipeline}
            disabled={recoverPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
          >
            {recoverPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            {recoverPending ? 'Recovering...' : 'Recover'}
          </button>
        )}

        {/* Start/Resume Agent when no agent or stopped */}
        {(!agent || agent.status === 'stopped') && onStartAgent && (
          <>
            <button
              onClick={() => {
                if (isResume && onToggleResumeInput) {
                  onToggleResumeInput(true);
                } else {
                  onStartAgent();
                }
              }}
              disabled={isLaunching || showResumeInput || isLifecycleUnresolved}
              className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-60 ${
                isLifecycleUnresolved
                  ? 'text-destructive cursor-not-allowed'
                  : 'text-primary hover:text-primary/80'
              }`}
              title={isLifecycleUnresolved ? 'Checking for resumable session…' : undefined}
            >
              {(isLaunching || isLifecycleUnresolved) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              <span>{isLaunching ? launchLabel : isLifecycleUnresolved ? 'Checking…' : (isResume ? 'Resume Session' : 'Start Agent')}</span>
            </button>
            {isResume && onResetSession && (
              <button
                onClick={onResetSession}
                disabled={resetSessionPending || resetSessionSuccess}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
                title="Clear saved session so next start creates a fresh Claude session (preserves workspace)"
              >
                {resetSessionPending ? <Loader2 className="w-3 h-3 animate-spin" /> : resetSessionSuccess ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
                {resetSessionPending ? 'Resetting...' : resetSessionSuccess ? 'Session Reset' : 'Reset Session'}
              </button>
            )}
            {!workspace?.exists && onCreateWorkspace && (
              <button
                onClick={onCreateWorkspace}
                disabled={createWorkspacePending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-card-foreground rounded disabled:opacity-50 border bg-card border-border"
              >
                {createWorkspacePending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                {createWorkspacePending ? 'Creating...' : 'Create Workspace'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Resume message input */}
      {showResumeInput && onStartAgent && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Message for agent (optional):</label>
          <textarea
            value={resumeMessage || ''}
            onChange={(e) => onResumeMessageChange?.(e.target.value)}
            placeholder="Tell the agent what to do, e.g. 'Address the PR feedback about error handling' or leave empty to let it pick up from the continue file"
            className="w-full px-2 py-1.5 text-xs bg-card border border-border rounded resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onStartAgent(resumeMessage || undefined);
                onToggleResumeInput?.(false);
              }
              if (e.key === 'Escape') {
                onToggleResumeInput?.(false);
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onStartAgent(resumeMessage || undefined);
                onToggleResumeInput?.(false);
              }}
              disabled={startPending}
              className="flex items-center gap-1 px-2 py-1 text-xs text-primary-foreground rounded bg-primary hover:bg-primary/90 disabled:opacity-50 font-medium"
            >
              {startPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {startPending ? 'Resuming...' : 'Resume'}
            </button>
            <button
              onClick={() => onToggleResumeInput?.(false)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:bg-card"
            >
              Cancel
            </button>
            <span className="text-xs text-muted-foreground ml-auto">Ctrl+Enter to send</span>
          </div>
        </div>
      )}

      {/* Stopped agent reason */}
      {!!agent && agent.status === 'stopped' && lifecycle?.reason && (
        <div className="text-xs text-muted-foreground mt-2 px-2 py-1 rounded bg-card/40 border border-border">
          {lifecycle.reason}
        </div>
      )}
    </div>
  );
}
