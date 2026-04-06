import { useState } from 'react';
import {
  XCircle, RefreshCw, Square, CheckCircle, Play, FolderPlus, Check, Loader2, RotateCcw, X, Send,
} from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Agent } from '../../types';
import type { ReviewStatus, WorkspaceInfo } from './types';
import { ReviewPipelineSection } from './ReviewPipelineSection';

// Convenience alias — most mutations use void variables and unknown data
type AnyMutation = UseMutationResult<unknown, Error, void, unknown>;
type ReopenMutation = UseMutationResult<unknown, Error, string | undefined, unknown>;
type ResetReviewMutation = UseMutationResult<unknown, Error, { rerun?: boolean } | undefined, unknown>;
type SyncMutation = UseMutationResult<{ alreadyUpToDate?: boolean; commitCount?: number }, Error, void, unknown>;

interface ActionsSectionProps {
  agent?: Agent;
  reviewStatus?: ReviewStatus;
  reviewStatusLoading?: boolean;
  workspace?: WorkspaceInfo;
  mergeMutation: AnyMutation;
  reviewMutation: AnyMutation;
  killMutation: AnyMutation;
  closeMutation: AnyMutation;
  reopenMutation: ReopenMutation;
  resetReviewMutation: ResetReviewMutation;
  startAgentMutation: UseMutationResult<unknown, Error, string | undefined, unknown>;
  createWorkspaceMutation: AnyMutation;
  syncMainMutation: SyncMutation;
  onMerge: () => void;
  onReview: () => void;
  onKill: () => void;
  onClose: () => void;
  onReopen: () => void;
  onResetReview: () => void;
  onDismissPending: () => void;
  onStartAgent: (message?: string) => void;
  onCreateWorkspace: () => void;
}

export function ActionsSection({
  agent,
  reviewStatus,
  reviewStatusLoading,
  workspace,
  mergeMutation,
  reviewMutation,
  killMutation,
  closeMutation,
  reopenMutation,
  resetReviewMutation,
  startAgentMutation,
  createWorkspaceMutation,
  syncMainMutation,
  onMerge,
  onReview,
  onKill,
  onClose,
  onReopen,
  onResetReview,
  onDismissPending,
  onStartAgent,
  onCreateWorkspace,
}: ActionsSectionProps) {
  const [showResumeInput, setShowResumeInput] = useState(false);
  const [resumeMessage, setResumeMessage] = useState('');
  const isResume = !!agent && agent.status === 'stopped';

  if (reviewStatusLoading) {
    return (
      <div className="px-3 py-2 border-b border-pan-border" data-testid="workspace-actions">
        <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-pan-text-secondary">Actions</div>
        <div className="flex flex-wrap gap-1.5">
          <div className="h-6 w-24 rounded bg-pan-border/50 animate-pulse" />
          <div className="h-6 w-16 rounded bg-pan-border/50 animate-pulse" />
          <div className="h-6 w-20 rounded bg-pan-border/50 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-pan-border" data-testid="workspace-actions">
      <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-pan-text-secondary">Actions</div>

      {/* Pending operation status */}
      {workspace?.pendingOperation?.type === 'approve' && workspace.pendingOperation.status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-900/20 px-2 py-1.5 rounded mb-2">
          <Loader2 className="w-3 h-3 animate-spin" /><span>Merging in progress...</span>
        </div>
      )}
      {workspace?.pendingOperation?.status === 'failed' && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1.5 rounded mb-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Operation failed</span>
            <button onClick={onDismissPending} className="text-pan-text-secondary hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-pan-text-secondary">{workspace.pendingOperation.error}</div>
        </div>
      )}

      {/* Review status */}
      {reviewStatus && (reviewStatus.reviewStatus !== 'pending' || reviewStatus.testStatus !== 'pending') && (
        <ReviewPipelineSection reviewStatus={reviewStatus} />
      )}

      <div className="flex flex-wrap gap-1.5">
        {/* MERGE button */}
        {reviewStatus?.readyForMerge && reviewStatus?.mergeStatus !== 'merged' && (
          <button
            data-testid="merge-btn"
            onClick={onMerge}
            disabled={mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging'}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50 font-medium"
          >
            {(mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging') ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            {reviewStatus?.mergeStatus === 'merging' ? 'MERGING...' : 'MERGE'}
          </button>
        )}
        {reviewStatus?.mergeStatus === 'merged' && (
          <span className="flex items-center gap-1 px-2 py-1 text-xs bg-green-900/30 text-green-400 rounded font-medium">
            <CheckCircle className="w-3 h-3" />MERGED
          </span>
        )}

        {/* Review & Test */}
        <button
          data-testid="review-test-btn"
          onClick={onReview}
          disabled={reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 text-blue-400 bg-blue-900/20 hover:bg-blue-900/30"
        >
          {(reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ?
            <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {reviewStatus?.readyForMerge ? 'Re-Review' : 'Review & Test'}
        </button>

        {/* Stop Agent */}
        {agent && agent.status !== 'stopped' && (
          <button
            onClick={onKill}
            disabled={killMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 rounded bg-red-900/20 hover:bg-red-900/30"
          >
            <Square className="w-3 h-3" />Stop
          </button>
        )}

        {/* Close Issue */}
        <button
          onClick={onClose}
          disabled={closeMutation.isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs text-orange-400 rounded bg-orange-900/20 hover:bg-orange-900/30 disabled:opacity-50"
        >
          {closeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
          Close
        </button>

        {/* Reopen button */}
        {reviewStatus && (reviewStatus.reviewStatus === 'passed' || reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked' || reviewStatus.testStatus === 'passed' || reviewStatus.testStatus === 'failed' || reviewStatus.mergeStatus === 'merged') && (
          <button
            data-testid="reopen-btn"
            onClick={onReopen}
            disabled={reopenMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-900/30 text-purple-400 rounded hover:bg-purple-900/50 disabled:opacity-50"
          >
            {reopenMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
          </button>
        )}

        {/* Reset Review Cycles */}
        {reviewStatus && (reviewStatus.reviewStatus !== 'pending' || reviewStatus.testStatus !== 'pending') && (
          <button
            onClick={onResetReview}
            disabled={resetReviewMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-900/30 text-amber-400 rounded hover:bg-amber-900/50 disabled:opacity-50"
          >
            {resetReviewMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            {resetReviewMutation.isPending ? 'Resetting...' : 'Reset Pipeline'}
          </button>
        )}

        {/* Start/Resume Agent when no agent or stopped */}
        {(!agent || agent.status === 'stopped') && (
          <>
            <button
              onClick={() => {
                if (isResume) {
                  setShowResumeInput(true);
                } else {
                  onStartAgent();
                }
              }}
              disabled={startAgentMutation.isPending || startAgentMutation.isSuccess || showResumeInput}
              className="flex items-center gap-1 px-2 py-1 text-xs text-white rounded hover:bg-blue-600 disabled:opacity-50 font-medium bg-pan-primary"
            >
              {startAgentMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : startAgentMutation.isSuccess ? <Check className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {startAgentMutation.isPending ? (isResume ? 'Resuming...' : 'Starting...') : startAgentMutation.isSuccess ? (isResume ? 'Resumed!' : 'Started!') : (isResume ? 'Resume Agent' : 'Start Agent')}
            </button>
            {!workspace?.exists && (
              <button
                onClick={onCreateWorkspace}
                disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
                className="flex items-center gap-1 px-2 py-1 text-xs text-white rounded disabled:opacity-50 border bg-pan-border border-gray-700"
              >
                {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Resume message input */}
      {showResumeInput && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="text-xs text-pan-text-secondary">Message for agent (optional):</label>
          <textarea
            value={resumeMessage}
            onChange={(e) => setResumeMessage(e.target.value)}
            placeholder="Tell the agent what to do, e.g. 'Address the PR feedback about error handling' or leave empty to let it pick up from STATE.md"
            className="w-full px-2 py-1.5 text-xs bg-[#0d1117] border border-pan-border rounded resize-none text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onStartAgent(resumeMessage || undefined);
                setShowResumeInput(false);
                setResumeMessage('');
              }
              if (e.key === 'Escape') {
                setShowResumeInput(false);
                setResumeMessage('');
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onStartAgent(resumeMessage || undefined);
                setShowResumeInput(false);
                setResumeMessage('');
              }}
              disabled={startAgentMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs text-white rounded bg-pan-primary hover:bg-blue-600 disabled:opacity-50 font-medium"
            >
              {startAgentMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {startAgentMutation.isPending ? 'Resuming...' : 'Resume'}
            </button>
            <button
              onClick={() => { setShowResumeInput(false); setResumeMessage(''); }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-pan-text-secondary rounded hover:bg-pan-border"
            >
              Cancel
            </button>
            <span className="text-xs text-pan-text-secondary ml-auto">Ctrl+Enter to send</span>
          </div>
        </div>
      )}

      {/* Error states */}
      {reviewMutation.isError && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
          {reviewMutation.error instanceof Error ? reviewMutation.error.message : 'Failed to start review'}
        </div>
      )}
      {mergeMutation.isError && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
          {mergeMutation.error instanceof Error ? mergeMutation.error.message : 'Failed to merge'}
        </div>
      )}
      {startAgentMutation.isError && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
          {startAgentMutation.error instanceof Error ? startAgentMutation.error.message : 'Failed to start agent'}
        </div>
      )}
      {syncMainMutation.isError && (
        <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
          {syncMainMutation.error instanceof Error ? syncMainMutation.error.message : 'Sync with main failed'}
        </div>
      )}
      {syncMainMutation.isSuccess && syncMainMutation.data && (
        <div className="text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded mt-2">
          {syncMainMutation.data.alreadyUpToDate ? 'Already up to date with main' : `Synced ${syncMainMutation.data.commitCount ?? 0} commit(s) from main`}
        </div>
      )}
    </div>
  );
}
