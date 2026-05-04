/**
 * ZoneActionStrip — compact issue-scoped action buttons for Zone A.
 *
 * Consumes useZoneAActions for data + mutations, computes getZoneAActions(input)
 * for parity, and renders the canonical 25-action surface inline. Primary actions
 * render as prominent buttons; secondary as subtle text buttons; overflow folds
 * into a "…" menu (danger zone + non-essential artifacts).
 *
 * This component is self-contained: it fetches its own data and wires its own
 * mutations so ZoneA doesn't need to lift state from InspectorPanel.
 */

import { useState, useMemo } from 'react';
import {
  Play, RefreshCw, RotateCcw, FolderPlus, Check, Loader2,
  MoreHorizontal, FileText, ListTodo, ScrollText, Brain, MessageSquare,
  Upload, Send, XCircle, GitMerge,
} from 'lucide-react';
import type { Agent, Issue } from '../../types';
import { getZoneAActions, type ActionKey } from '../../lib/commandDeckActions';
import { useZoneAActions } from './useZoneAActions';
import { MergeButton } from '../MergeButton';
import { StopAgentButton } from '../StopAgentButton';
import { RecoverButton } from '../RecoverButton';
import { RestartFromPlanButton } from '../RestartFromPlanButton';
import { ResetIssueButton } from '../ResetIssueButton';

interface ZoneActionStripProps {
  issueId: string;
  agent?: Agent;
  issue?: Issue;
  onOpenBeads?: () => void;
  onOpenVBrief?: () => void;
  /** Called when an artifact action wants to switch a ZoneCOverview tab. */
  onSwitchTab?: (tab: 'overview' | 'activity' | 'costs' | 'prd' | 'state' | 'inference' | 'vbrief' | 'beads' | 'prdiff' | 'discussions') => void;
}

export function ZoneActionStrip({
  issueId,
  agent,
  issue,
  onOpenBeads,
  onOpenVBrief,
  onSwitchTab,
}: ZoneActionStripProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [showResumeInput, setShowResumeInput] = useState(false);
  const [resumeMessage, setResumeMessage] = useState('');

  const {
    workspace,
    reviewStatus,
    reviewStatusLoading,
    lifecycle,
    planningState,
    agentLaunchState,
    startAgentMutation,
    reviewMutation,
    cancelMutation,
    resetSessionMutation,
    reopenMutation,
    createWorkspaceMutation,
    copySettingsMutation,
    syncMainMutation,
    onStartAgent,
    onReview,
    onCancel,
    onResetSession,
    onReopen,
    onCreateWorkspace,
    onCopySettings,
    onSyncMain,
  } = useZoneAActions(issueId, agent, issue);

  const layout = useMemo(() => {
    if (reviewStatusLoading) {
      return { primary: [] as ActionKey[], secondary: [] as ActionKey[], overflow: [] as ActionKey[] };
    }
    return getZoneAActions({
      reviewStatus,
      agent,
      lifecycle,
      workspace,
      hasPlan: planningState?.hasPlan ?? false,
      hasBeads: planningState?.hasBeads ?? false,
      beadsCount: planningState?.beadsCount ?? 0,
      hasInference: false,
      hasTranscripts: false,
      hasDiscussions: false,
      issueCanonicalState: issue?.status?.toLowerCase() ?? null,
      isMerged: reviewStatus?.mergeStatus === 'merged',
    });
  }, [reviewStatus, reviewStatusLoading, agent, lifecycle, workspace, planningState, issue, reviewStatus?.mergeStatus]);

  // Density rule (B6): when the state is "boring" (no agent, no review, no plan,
  // no beads), collapse secondary actions into overflow so Zone A stays clean.
  const isBoring = !agent && !reviewStatus && !planningState?.hasPlan && !planningState?.hasBeads;
  const displayLayout = isBoring
    ? { primary: layout.primary, secondary: [] as ActionKey[], overflow: [...layout.secondary, ...layout.overflow] }
    : layout;

  const isResume = !!agent && agent.status === 'stopped' && lifecycle?.canResumeSession === true && !resetSessionMutation.isSuccess;
  const isLifecycleUnresolved = !!agent && agent.status === 'stopped' && !lifecycle;
  const isLaunching = agentLaunchState === 'starting' || agentLaunchState === 'resuming';
  const launchLabel = agentLaunchState === 'resuming' ? 'Resuming...' : 'Starting...';

  const shouldPromoteReviewAction = !!reviewStatus?.readyForMerge
    || reviewStatus?.reviewStatus === 'failed'
    || reviewStatus?.reviewStatus === 'blocked'
    || reviewStatus?.testStatus === 'failed'
    || reviewStatus?.testStatus === 'dispatch_failed'
    || reviewStatus?.mergeStatus === 'failed';

  if (reviewStatusLoading) {
    return (
      <div style={{ display: 'flex', gap: 8, padding: '6px 12px', alignItems: 'center' }}>
        <div className="h-5 w-16 rounded bg-card/50 animate-pulse" />
        <div className="h-5 w-12 rounded bg-card/50 animate-pulse" />
      </div>
    );
  }

  const renderAction = (key: ActionKey) => {
    switch (key) {
      case 'merge':
        return (
          <MergeButton
            key={key}
            issueId={issueId}
            reviewStatus={reviewStatus}
            variant="inspector"
          />
        );

      case 'reviewTest':
        return (
          <button
            key={key}
            data-testid="zone-a-review-test"
            onClick={onReview}
            disabled={reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${
              shouldPromoteReviewAction
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {(reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing')
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            {reviewStatus?.readyForMerge ? 'Re-Review' : 'Review & Test'}
          </button>
        );

      case 'recover':
        return (
          <RecoverButton
            key={key}
            issueId={issueId}
            reviewStatus={reviewStatus}
            variant="inspector"
          />
        );

      case 'stopAgent':
        return agent ? (
          <StopAgentButton
            key={key}
            agentId={agent.id}
            variant="inspector"
          />
        ) : null;

      case 'startAgent':
      case 'resumeSession':
        return (
          <button
            key={key}
            data-testid="zone-a-start-resume"
            onClick={() => {
              if (isResume) {
                setShowResumeInput(true);
              } else {
                onStartAgent();
              }
            }}
            disabled={isLaunching || showResumeInput || isLifecycleUnresolved}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-60 ${
              isLifecycleUnresolved
                ? 'text-destructive cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium'
            }`}
            title={isLifecycleUnresolved ? 'Checking for resumable session…' : undefined}
          >
            {(isLaunching || isLifecycleUnresolved)
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Play className="w-3 h-3" />}
            <span>{isLaunching ? launchLabel : isLifecycleUnresolved ? 'Checking…' : (isResume ? 'Resume Session' : 'Start Agent')}</span>
          </button>
        );

      case 'resetSession':
        return (
          <button
            key={key}
            onClick={onResetSession}
            disabled={resetSessionMutation.isPending || resetSessionMutation.isSuccess}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
            title="Clear saved session so next start creates a fresh Claude session"
          >
            {resetSessionMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : resetSessionMutation.isSuccess ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
            {resetSessionMutation.isPending ? 'Resetting...' : resetSessionMutation.isSuccess ? 'Reset' : 'Reset Session'}
          </button>
        );

      case 'createWorkspace':
        return (
          <button
            key={key}
            onClick={onCreateWorkspace}
            disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
            className="flex items-center gap-1 px-2 py-1 text-xs text-card-foreground rounded disabled:opacity-50 border bg-card border-border"
          >
            {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
            {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
          </button>
        );

      case 'copySettings':
        return (
          <button
            key={key}
            onClick={onCopySettings}
            disabled={copySettingsMutation.isPending || copySettingsMutation.isSuccess}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
            title="Copy Panopticon global settings into workspace"
          >
            {copySettingsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : copySettingsMutation.isSuccess ? <Check className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            {copySettingsMutation.isPending ? 'Copying...' : copySettingsMutation.isSuccess ? 'Copied' : 'Copy Settings'}
          </button>
        );

      case 'beads':
        return (
          <button
            key={key}
            onClick={onOpenBeads}
            className="flex items-center gap-1 px-2 py-1 text-xs text-primary rounded hover:bg-primary/10"
          >
            <ListTodo className="w-3 h-3" />
            Tasks
          </button>
        );

      case 'vbrief':
        return (
          <button
            key={key}
            onClick={onOpenVBrief}
            className="flex items-center gap-1 px-2 py-1 text-xs text-signal-review rounded hover:bg-signal-review/10"
          >
            <ScrollText className="w-3 h-3" />
            vBRIEF
          </button>
        );

      case 'state':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('state')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <FileText className="w-3 h-3" />
            STATE
          </button>
        );

      case 'prd':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('prd')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <FileText className="w-3 h-3" />
            PRD
          </button>
        );

      case 'inference':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('inference')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <Brain className="w-3 h-3" />
            Inference
          </button>
        );

      case 'discussions':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('discussions')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <MessageSquare className="w-3 h-3" />
            Discussions
          </button>
        );

      case 'transcripts':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('activity')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <FileText className="w-3 h-3" />
            Transcripts
          </button>
        );

      case 'upload':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('activity')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <Upload className="w-3 h-3" />
            Upload
          </button>
        );

      case 'syncDiscussions':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('discussions')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <RefreshCw className="w-3 h-3" />
            Sync
          </button>
        );

      case 'statusReview':
        return (
          <button
            key={key}
            onClick={() => onSwitchTab?.('overview')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          >
            <FileText className="w-3 h-3" />
            Status
          </button>
        );

      case 'syncMain':
        return (
          <button
            key={key}
            onClick={onSyncMain}
            disabled={syncMainMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent disabled:opacity-50"
            title="Sync with main"
          >
            {syncMainMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
            {syncMainMutation.isPending ? 'Syncing...' : 'Sync'}
          </button>
        );

      case 'reopen':
        return (
          <button
            key={key}
            onClick={onReopen}
            disabled={reopenMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-warning rounded hover:bg-warning hover:text-warning-foreground transition-colors disabled:opacity-50"
          >
            {reopenMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
          </button>
        );

      case 'restartFromPlan':
        return <RestartFromPlanButton key={key} issueId={issueId} />;

      case 'resetIssue':
        return <ResetIssueButton key={key} issueId={issueId} variant="danger-zone" issue={issue} />;

      case 'cancel':
        return (
          <button
            key={key}
            onClick={onCancel}
            disabled={cancelMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs text-destructive rounded hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
          >
            {cancelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
            {cancelMutation.isPending ? 'Canceling...' : 'Cancel Issue'}
          </button>
        );

      default:
        return null;
    }
  };

  const hasOverflow = displayLayout.overflow.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Primary + Secondary inline strip */}
      <div
        data-testid="zone-a-action-strip"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '6px 12px',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {displayLayout.primary.map(renderAction)}
        {displayLayout.secondary.map(renderAction)}

        {hasOverflow && (
          <div style={{ position: 'relative' }}>
            <button
              data-testid="zone-a-overflow-btn"
              onClick={() => setShowOverflow((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
            {showOverflow && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40,
                  }}
                  onClick={() => setShowOverflow(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    minWidth: 180,
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    zIndex: 50,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', padding: '0 4px' }}>
                    More actions
                  </div>
                  {displayLayout.overflow.map(renderAction)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Resume message input */}
      {showResumeInput && (
        <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="text-xs text-muted-foreground">Message for agent (optional):</label>
          <textarea
            value={resumeMessage}
            onChange={(e) => setResumeMessage(e.target.value)}
            placeholder="Tell the agent what to do, e.g. 'Address the PR feedback about error handling' or leave empty to let it pick up from the continue file"
            className="w-full px-2 py-1.5 text-xs bg-card border border-border rounded resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
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
              className="flex items-center gap-1 px-2 py-1 text-xs text-primary-foreground rounded bg-primary hover:bg-primary/90 disabled:opacity-50 font-medium"
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
    </div>
  );
}
