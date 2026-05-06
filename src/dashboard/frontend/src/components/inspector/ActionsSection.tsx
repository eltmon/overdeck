import { useState } from 'react';
import {
  XCircle, RefreshCw, CheckCircle, Play, FolderPlus, Check, Loader2, RotateCcw, X, Send, ChevronRight, ChevronDown, Box, Tag, LayoutGrid,
} from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Agent, WorkAgentLifecycle, STATUS_LABELS } from '../../types';
import type { ReviewStatus, WorkspaceInfo } from './types';
import { ReviewPipelineSection } from './ReviewPipelineSection';
import { isReviewPipelineStuck } from '../../lib/pipeline-state';
import { ResetIssueButton } from '../ResetIssueButton';
import { StopAgentButton } from '../StopAgentButton';
import { MergeButton } from '../MergeButton';
import { RecoverButton } from '../RecoverButton';
import { RestartFromPlanButton } from '../RestartFromPlanButton';
import { ArtifactLinks } from '../ArtifactLinks';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';
import { FileText } from 'lucide-react';
import { useAvailableModels } from '../shared/ModelPicker/ModelPicker';
import { useSwitchModel } from '../../hooks/useSwitchModel';

// Convenience alias — most mutations use void variables and unknown data
type AnyMutation = UseMutationResult<unknown, Error, void, unknown>;
type SyncMutation = UseMutationResult<{ alreadyUpToDate?: boolean; commitCount?: number }, Error, void, unknown>;
type ReopenMutation = UseMutationResult<unknown, Error, string | undefined, unknown>;

interface ActionsSectionProps {
  agent?: Agent;
  issueId: string;
  reviewStatus?: ReviewStatus;
  reviewStatusLoading?: boolean;
  workspace?: WorkspaceInfo;
  hasPlan: boolean;
  hasBeads: boolean;
  beadsCount?: number;  // Deprecated — use hasBeads
  reviewMutation: AnyMutation;
  cancelMutation: AnyMutation;
  startAgentMutation: UseMutationResult<unknown, Error, string | undefined, unknown>;
  createWorkspaceMutation: AnyMutation;
  syncMainMutation: SyncMutation;
  copySettingsMutation: AnyMutation;
  resetSessionMutation: AnyMutation;
  reopenMutation?: ReopenMutation;
  onReview: () => void;
  onCancel: () => void;
  onResetSession: () => void;
  onDismissPending: () => void;
  onStartAgent: (message?: string) => void;
  onCreateWorkspace: () => void;
  onCopySettings: () => void;
  onReopen?: () => void;
  onKillSuccess?: () => void;
  onViewBeads: () => void;
  onViewVBrief: () => void;
  onViewLog?: () => void;
  onSwitchModel?: () => void;
  lifecycle?: WorkAgentLifecycle;
  agentLaunchState?: 'starting' | 'resuming' | null;
  isFeature?: boolean;
  issueStatus?: string;
  onPlan?: () => void;
}

void COMMAND_DECK_SURFACE_REGISTRY;

export function ActionsSection({
  agent,
  issueId,
  reviewStatus,
  reviewStatusLoading,
  workspace,
  hasPlan,
  hasBeads,
  beadsCount,
  reviewMutation,
  cancelMutation,
  startAgentMutation,
  createWorkspaceMutation,
  syncMainMutation,
  copySettingsMutation,
  resetSessionMutation,
  reopenMutation,
  onReview,
  onCancel,
  onResetSession,
  onDismissPending,
  onStartAgent,
  onCreateWorkspace,
  onCopySettings,
  onReopen,
  onKillSuccess,
  onViewBeads,
  onViewVBrief,
  onViewLog,
  onSwitchModel,
  lifecycle,
  agentLaunchState,
  isFeature,
  issueStatus,
  onPlan,
}: ActionsSectionProps) {
  const [showResumeInput, setShowResumeInput] = useState(false);
  const [resumeMessage, setResumeMessage] = useState('');
  const isResume = !!agent && agent.status === 'stopped' && lifecycle?.canResumeSession === true && !resetSessionMutation.isSuccess;
  const isLifecycleUnresolved = !!agent && agent.status === 'stopped' && !lifecycle;
  const isLaunching = agentLaunchState === 'starting' || agentLaunchState === 'resuming';
  const launchLabel = agentLaunchState === 'resuming' ? 'Resuming...' : 'Starting...';

  const [showResumeModelDropdown, setShowResumeModelDropdown] = useState(false);
  const { groups } = useAvailableModels();
  const { switchMutation, isPending: isSwitchingModel } = useSwitchModel(agent?.id, issueId);

  const isPipelineStuck = isReviewPipelineStuck(reviewStatus);
  const hasVerificationState = !!reviewStatus?.verificationStatus && reviewStatus.verificationStatus !== 'pending';
  const showPipelineStatus = !!reviewStatus && (
    reviewStatus.reviewStatus !== 'pending'
    || reviewStatus.testStatus !== 'pending'
    || hasVerificationState
  );
  const isReReview = reviewStatus?.readyForMerge
    || (reviewStatus?.reviewStatus === 'passed' && reviewStatus?.testStatus === 'passed' && reviewStatus?.mergeStatus === 'failed');
  const reviewActionHint = !reviewStatus ? null : (() => {
    if (reviewStatus.verificationStatus === 'failed') {
      return {
        label: 'Fix build gate errors, then re-run',
        title: 'Build gate (typecheck/lint) failed — fix the errors before review can start.',
      };
    }
    if (reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked') {
      return {
        label: 'Next: Review & Test',
        detail: reviewStatus.reviewNotes || 'Review did not pass.',
        title: 'Review did not pass — rerun Review & Test after addressing the issue.',
      };
    }
    if (reviewStatus.testStatus === 'failed' || reviewStatus.testStatus === 'dispatch_failed') {
      return {
        label: 'Next: Review & Test',
        detail: reviewStatus.testNotes || 'Tests failed.',
        title: 'Tests failed — rerun Review & Test to continue the pipeline.',
      };
    }
    if (reviewStatus.mergeStatus === 'failed') {
      return {
        label: 'Next: Re-Review',
        detail: 'Merge did not complete.',
        title: 'Merge failed after a prior pass — rerun the pipeline before merging again.',
      };
    }
    return null;
  })();
  const shouldPromoteReviewAction = !!reviewActionHint || !!reviewStatus?.readyForMerge;

  if (reviewStatusLoading) {
    return (
      <div className="px-3 py-2 border-b border-border" data-testid="workspace-actions">
        <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-muted-foreground">Actions</div>
        <div className="flex flex-wrap gap-1.5">
          <div className="h-6 w-24 rounded bg-card/50 animate-pulse" />
          <div className="h-6 w-16 rounded bg-card/50 animate-pulse" />
          <div className="h-6 w-20 rounded bg-card/50 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-border" data-testid="workspace-actions">
      <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-muted-foreground">Actions</div>

      {/* Pending operation status */}
      {workspace?.pendingOperation?.type === 'approve' && workspace.pendingOperation.status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-primary badge-bg-primary px-2 py-1.5 rounded mb-2">
          <Loader2 className="w-3 h-3 animate-spin" /><span>Merging in progress...</span>
        </div>
      )}
      {workspace?.pendingOperation?.status === 'failed' && (
        <div className="text-xs text-destructive badge-bg-destructive px-2 py-1.5 rounded mb-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Operation failed</span>
            <button onClick={onDismissPending} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-muted-foreground">{workspace.pendingOperation.error}</div>
        </div>
      )}

      {/* Review status */}
      {showPipelineStatus && reviewStatus && (
        <ReviewPipelineSection reviewStatus={reviewStatus} issueId={issueId} onViewLog={onViewLog} />
      )}
      {reviewActionHint && (
        <div
          className="mt-2 rounded border border-warning/40 badge-bg-warning px-2 py-1 text-xs text-warning-foreground"
          title={reviewActionHint.title}
        >
          <span className="font-medium">{reviewActionHint.label}</span>
        </div>
      )}

      {/* Workspace Actions */}
      <div className="mt-4">
        <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-muted-foreground flex items-center gap-1.5">
          <Box className="w-3 h-3" /> Workspace
        </div>
        <div className="flex flex-wrap gap-1.5">
          {/* MERGE */}
          <div className="flex items-center gap-1">
            <MergeButton issueId={issueId} reviewStatus={reviewStatus} variant="inspector" />
            <span title="Also shown on card">
              <LayoutGrid className="w-3 h-3 text-muted-foreground opacity-40 self-center" />
            </span>
          </div>
          {reviewStatus?.mergeStatus === 'merged' && (
            <span className="flex items-center gap-1 px-2 py-1 text-xs badge-bg-success text-success rounded font-medium">
              <CheckCircle className="w-3 h-3" />Merged
            </span>
          )}

          {/* Review & Test */}
          <button
            data-testid="review-test-btn"
            onClick={onReview}
            disabled={reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${
              shouldPromoteReviewAction
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {(reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ?
              <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {isReReview ? 'Re-Review' : 'Review & Test'}
          </button>

          {/* Stop Agent — hidden for features (features are planned, not executed) */}
          {agent && agent.status !== 'stopped' && !isFeature && (
            <div className="flex items-center gap-1">
              <StopAgentButton
                agentId={agent?.id}
                variant="inspector"
                onSuccess={onKillSuccess}
                data-testid="inspector-stop-agent"
              />
              <span title="Also shown on card">
                <LayoutGrid className="w-3 h-3 text-muted-foreground opacity-40 self-center" />
              </span>
            </div>
          )}

          {/* Switch Model — only for work agents with an active/stopped agent */}
          {agent && onSwitchModel && !isFeature && (
            <button
              onClick={onSwitchModel}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
              title="Restart agent with a different model"
              data-testid="inspector-switch-model"
            >
              <RefreshCw className="w-3 h-3" />
              Switch Model
            </button>
          )}

          {/* Recover failed review/test/merge pipeline */}
          {reviewStatus && isPipelineStuck && (
            <div className="flex items-center gap-1">
              <RecoverButton
                issueId={issueId}
                reviewStatus={reviewStatus}
                variant="inspector"
                data-testid="inspector-recover"
              />
              <span title="Also shown on card">
                <LayoutGrid className="w-3 h-3 text-muted-foreground opacity-40 self-center" />
              </span>
            </div>
          )}

          {/* Start/Resume Agent when no agent or stopped — hidden for features */}
          {(!agent || agent.status === 'stopped') && !isFeature && (
            <>
              <div className="flex items-center relative">
                <button
                  onClick={() => {
                    if (isResume) {
                      setShowResumeInput(true);
                    } else {
                      onStartAgent();
                    }
                  }}
                  disabled={isLaunching || showResumeInput || isLifecycleUnresolved || isSwitchingModel}
                  className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-60 ${
                    isLifecycleUnresolved
                      ? 'text-destructive cursor-not-allowed'
                      : 'text-primary hover:text-primary/80'
                  }`}
                  title={isLifecycleUnresolved ? 'Checking for resumable session…' : undefined}
                  data-testid={isResume ? 'inspector-resume-session' : 'inspector-start-agent'}
                >
                  {(isLaunching || isLifecycleUnresolved || isSwitchingModel) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  <span>{isLaunching ? launchLabel : isLifecycleUnresolved ? 'Checking…' : isSwitchingModel ? 'Switching…' : (isResume ? 'Resume Session' : 'Start Agent')}</span>
                </button>
                {isResume && (
                  <>
                    <button
                      data-testid="inspector-resume-model-dropdown"
                      onClick={() => setShowResumeModelDropdown(v => !v)}
                      disabled={isLaunching || isSwitchingModel}
                      className="flex items-center px-1 py-0.5 text-xs text-primary hover:text-primary/80 disabled:opacity-60 ml-0.5"
                      title="Resume with a different model"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showResumeModelDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowResumeModelDropdown(false)}
                        />
                        <div
                          className="absolute left-0 top-full mt-1 min-w-[200px] bg-popover border border-border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto"
                        >
                          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Resume with model…
                          </div>
                          {groups.map((group) => (
                            <div key={group.provider}>
                              <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground/80 border-t border-border">
                                {group.label}
                              </div>
                              {group.models.map((m) => (
                                <button
                                  key={m.id}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between"
                                  onClick={() => {
                                    setShowResumeModelDropdown(false);
                                    switchMutation.mutate({ model: m.id, message: resumeMessage || undefined });
                                  }}
                                  disabled={isSwitchingModel}
                                >
                                  <span>{m.label}</span>
                                  {m.costDisplay && (
                                    <span className="text-[10px] opacity-50 ml-2">{m.costDisplay}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              {/* Reset Session — only when resuming (has a saved session) */}
              {isResume && (
                <button
                  onClick={onResetSession}
                  disabled={resetSessionMutation.isPending || resetSessionMutation.isSuccess}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
                  title="Clear saved session so next start creates a fresh Claude session (preserves workspace)"
                  data-testid="inspector-reset-session"
                >
                  {resetSessionMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : resetSessionMutation.isSuccess ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
                  {resetSessionMutation.isPending ? 'Resetting...' : resetSessionMutation.isSuccess ? 'Session Reset' : 'Reset Session'}
                </button>
              )}
              {!workspace?.exists && (
                 <button
                   onClick={onCreateWorkspace}
                   disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
                   className="flex items-center gap-1 px-2 py-1 text-xs text-card-foreground rounded disabled:opacity-50 border bg-card border-border"
                   data-testid="inspector-create-workspace"
                 >
                   {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                   {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
                 </button>
               )}
               {workspace?.exists && (
                 <button
                   onClick={onCopySettings}
                   disabled={copySettingsMutation.isPending || copySettingsMutation.isSuccess}
                   className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
                   title="Copy Panopticon global settings (projects, models, hooks) into workspace"
                 >
                   {copySettingsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : copySettingsMutation.isSuccess ? <Check className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                   {copySettingsMutation.isPending ? 'Copying...' : copySettingsMutation.isSuccess ? 'Settings Copied' : 'Copy Settings'}
                 </button>
               )}
             </>
           )}
           {/* Feature-only actions: Plan button (features are planned, not executed) */}
           {isFeature && onPlan && STATUS_LABELS[issueStatus ?? ''] !== 'done' && STATUS_LABELS[issueStatus ?? ''] !== 'canceled' && (
             <button
               onClick={onPlan}
               className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                 hasPlan
                   ? 'text-success hover:text-success/80'
                   : 'text-muted-foreground hover:text-foreground hover:bg-accent'
               }`}
               title={hasPlan ? 'See plan / continue planning' : 'Plan'}
               data-testid="inspector-plan-feature"
             >
               <FileText className="w-3 h-3" />
               {hasPlan ? 'See Plan' : 'Plan'}
             </button>
           )}
         </div>
      </div>

      {!!agent && agent.status === 'stopped' && lifecycle?.reason && (
        <div className="text-xs text-muted-foreground mt-2 px-2 py-1 rounded bg-card/40 border border-border">
          {lifecycle.reason}
        </div>
      )}

      {/* Resume message input */}
      {showResumeInput && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Message for agent (optional):</label>
          <textarea
            value={resumeMessage}
            onChange={(e) => setResumeMessage(e.target.value)}
            placeholder="Tell the agent what to do, e.g. 'Address the PR feedback about error handling' or leave empty to let it pick up from the continue file"
            className="w-full px-2 py-1.5 text-xs bg-card border border-border rounded resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            rows={3}
            autoFocus
            data-testid="inspector-resume-input"
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
              className="flex items-center gap-1 px-2 py-1 text-xs text-primary-foreground rounded bg-primary hover:bg-primary/90 disabled:opacity-50 font-medium"
              data-testid="inspector-resume-send"
            >
              {startAgentMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {startAgentMutation.isPending ? 'Resuming...' : 'Resume'}
            </button>
            <button
              onClick={() => { setShowResumeInput(false); setResumeMessage(''); }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:bg-card"
            >
              Cancel
            </button>
            <span className="text-xs text-muted-foreground ml-auto">Ctrl+Enter to send</span>
          </div>
        </div>
      )}

      {/* Error states */}
      {reviewMutation.isError && (
        <div className="text-xs text-destructive badge-bg-destructive px-2 py-1 rounded mt-2">
          {reviewMutation.error instanceof Error ? reviewMutation.error.message : 'Failed to start review'}
        </div>
      )}
      {startAgentMutation.isError && (
        <div className="text-xs text-destructive badge-bg-destructive px-2 py-1 rounded mt-2">
          {startAgentMutation.error instanceof Error ? startAgentMutation.error.message : 'Failed to start agent'}
        </div>
      )}
      {syncMainMutation.isError && (
        <div className="text-xs text-destructive badge-bg-destructive px-2 py-1 rounded mt-2">
          {syncMainMutation.error instanceof Error ? syncMainMutation.error.message : 'Sync with main failed'}
        </div>
      )}
      {syncMainMutation.isSuccess && syncMainMutation.data && (
        <div className="text-xs text-success badge-bg-success px-2 py-1 rounded mt-2">
          {syncMainMutation.data.alreadyUpToDate ? 'Already up to date with main' : `Synced ${syncMainMutation.data.commitCount ?? 0} commit(s) from main`}
        </div>
      )}
      {copySettingsMutation.isError && (
        <div className="text-xs text-destructive badge-bg-destructive px-2 py-1 rounded mt-2">
          {copySettingsMutation.error instanceof Error ? copySettingsMutation.error.message : 'Failed to copy settings'}
        </div>
      )}
      {copySettingsMutation.isSuccess && (
        <div className="text-xs text-success badge-bg-success px-2 py-1 rounded mt-2">
          Copied Panopticon settings into workspace
        </div>
      )}

      {/* Issue Actions */}
      <div className="mt-4">
        <div className="text-xs uppercase tracking-wider mb-2 font-semibold text-muted-foreground flex items-center gap-1.5">
          <Tag className="w-3 h-3" /> Issue
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div className="flex items-center gap-1">
            <ArtifactLinks
              issueId={issueId}
              hasPlan={hasPlan}
              hasBeads={hasBeads}
              beadsCount={beadsCount}
              onViewBeads={onViewBeads}
              onViewVBrief={onViewVBrief}
              variant="inspector"
            />
            <span title="Also shown on card">
              <LayoutGrid className="w-3 h-3 text-muted-foreground opacity-40 self-center" />
            </span>
          </div>
        </div>

        {/* Danger Zone — destructive actions (collapsed by default) */}
        {reviewStatus?.mergeStatus !== 'merged' && (
          <details className="mt-4 rounded border border-destructive/30 group" data-testid="inspector-danger-zone">
            <summary className="px-3 py-2 bg-destructive/5 rounded cursor-pointer list-none select-none flex items-center gap-1.5 group-open:rounded-b-none group-open:border-b group-open:border-destructive/30">
              <ChevronRight className="w-3 h-3 text-destructive transition-transform group-open:rotate-90" />
              <span className="text-xs font-semibold uppercase tracking-wider text-destructive">Danger Zone</span>
            </summary>
            <div className="px-3 py-3 space-y-4">
              {/* Reopen */}
              {onReopen && (
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">Reopen for more work</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5" title="Moves the issue back to In Progress so the work agent can continue. Keeps the workspace, branch, PR, continue file, and all planning artifacts intact.">
                    Moves the issue back to In Progress. The workspace, branch, PR, continue file, and all planning artifacts are preserved.
                  </div>
                  <button
                    onClick={onReopen}
                    disabled={reopenMutation?.isPending}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-warning/40 text-warning hover:bg-warning hover:text-warning-foreground transition-colors disabled:opacity-50"
                    title="Reopen: moves issue to In Progress, keeps workspace + branch + PR + continue file + beads"
                    data-testid="inspector-reopen"
                  >
                    {reopenMutation?.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {reopenMutation?.isPending ? 'Reopening...' : 'Reopen'}
                  </button>
                </div>
              )}

              {/* Restart from Plan */}
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Restart from Plan</div>
                <div className="text-[11px] text-muted-foreground mt-0.5" title="Stops any running agent, resets the feature branch to the post-planning commit, clears session state. Keeps vBRIEF, beads, continue file, and PRD. Moves to In Progress.">
                  Stops agent, resets branch to post-planning commit, clears session state. Keeps vBRIEF, beads, continue file, and PRD. Moves to In Progress.
                </div>
                <RestartFromPlanButton issueId={issueId} />
              </div>

              {/* Reset Issue */}
              <ResetIssueButton issueId={issueId} variant="danger-zone" />

              {/* Cancel Issue */}
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Cancel this issue</div>
                <div className="text-[11px] text-muted-foreground mt-0.5" title="Permanently stops the agent, deletes the workspace and branch (including the continue file), closes the PR, removes beads, and moves the issue to Canceled. This cannot be undone.">
                  Permanently stops the agent, deletes the workspace and branch (including the continue file), closes the PR, and moves the issue to Canceled. This cannot be undone.
                </div>
                <button
                  onClick={onCancel}
                  disabled={cancelMutation.isPending}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
                  title="Cancel Issue: permanent — stops agent, deletes workspace + branch + continue file, closes PR, moves to Canceled"
                  data-testid="inspector-cancel-issue"
                >
                  {cancelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                  {cancelMutation.isPending ? 'Canceling...' : 'Cancel Issue'}
                </button>
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
