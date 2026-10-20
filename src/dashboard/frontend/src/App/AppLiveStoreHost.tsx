/**
 * AppLiveStoreHost — the app shell's live-store consumers (PAN-4560).
 *
 * The pending-input dialogs, desktop activity notifications and the
 * "Rebuild stack for" workspace invalidation all follow agent, issue and
 * activity changes. They live here, as a sibling of the routed tree, so those
 * changes re-render this host and not `App` with everything below it.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentSnapshot } from '@overdeck/contracts';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ChannelPermissionDialog } from '../components/ChannelPermissionDialog';
import { TerminalPermissionDialog } from '../components/TerminalPermissionDialog';
import { AskUserQuestionDialog } from '../components/AskUserQuestionDialog';
import { PlanApprovalDialog } from '../components/PlanApprovalDialog';
import { isRunningAgentStatus } from '../components/AgentPillPopoverRow';
import { useDashboardStore } from '../lib/store';
import { usePendingInputDialogs } from './hooks/usePendingInputDialogs';
import { useDesktopActivityNotifications } from './hooks/useDesktopActivityNotifications';

/** Live agent count for the app-bar status pill (PAN-1591). Returns a number, so `App` re-renders only when it changes. */
export function countRunningAgents(agentsById: Record<string, AgentSnapshot>): number {
  let count = 0;
  for (const agent of Object.values(agentsById)) {
    if (isRunningAgentStatus(agent.status)) count += 1;
  }
  return count;
}

const EMPTY_ACTIVITY: Array<Record<string, unknown>> = [];

/** Invalidates a workspace's query when the activity feed reports a stack rebuild for it. */
function useRebuildStackInvalidation(): void {
  const queryClient = useQueryClient();
  const recentActivity = useDashboardStore((state) => (state.recentActivity ?? EMPTY_ACTIVITY) as Array<Record<string, unknown>>);
  const seenWorkspaceActivityIds = useRef(new Set<string>());

  useEffect(() => {
    for (const entry of recentActivity.slice(0, 10)) {
      const id = typeof entry['id'] === 'string' ? entry['id'] : null;
      const issueId = typeof entry['issueId'] === 'string' ? entry['issueId'] : null;
      const message = typeof entry['message'] === 'string' ? entry['message'] : '';
      if (!id || !issueId || seenWorkspaceActivityIds.current.has(id)) continue;
      if (!/^Rebuild stack for\b/.test(message)) continue;
      seenWorkspaceActivityIds.current.add(id);
      void queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    }
  }, [queryClient, recentActivity]);
}

export function AppLiveStoreHost() {
  const {
    currentChannelPermissionRequest,
    currentChannelPermissionIssueId,
    isChannelPermissionSubmitting,
    handleAllowChannelPermission,
    handleDenyChannelPermission,
    terminalPermissionDialog,
    currentAskUserQuestionSubject,
    isAskUserQuestionSubmitting,
    handleSubmitAskUserQuestion,
    handleDismissAskUserQuestion,
    currentPlanApprovalSubject,
    isPlanActionSubmitting,
    handleApprovePlan,
    handleRequestPlanChanges,
    handleDismissPlanApproval,
    currentConfirmation,
    handleConfirm,
    handleDeny,
    handleCloseConfirmation,
  } = usePendingInputDialogs();
  useDesktopActivityNotifications();
  useRebuildStackInvalidation();

  return (
    <>
      <ChannelPermissionDialog
        request={currentChannelPermissionRequest}
        issueId={currentChannelPermissionIssueId}
        isOpen={!!currentChannelPermissionRequest}
        isSubmitting={isChannelPermissionSubmitting}
        onAllow={handleAllowChannelPermission}
        onDeny={handleDenyChannelPermission}
      />
      <TerminalPermissionDialog {...terminalPermissionDialog} />

      {/* PAN-1520 — AskUserQuestion interactive dialog (covers both work
          agents and conversation sessions — same modal, same code path). */}
      <AskUserQuestionDialog
        subject={currentAskUserQuestionSubject}
        isOpen={!!currentAskUserQuestionSubject && !currentChannelPermissionRequest}
        isSubmitting={isAskUserQuestionSubmitting}
        onSubmit={handleSubmitAskUserQuestion}
        onDismiss={handleDismissAskUserQuestion}
      />

      {/* PAN-1520 (FR-3) — plan-approval popup modal. Priority: permission
          modal > AUQ dialog > plan dialog (extends the existing exclusion). */}
      <PlanApprovalDialog
        subject={currentPlanApprovalSubject}
        isOpen={!!currentPlanApprovalSubject && !currentChannelPermissionRequest && !currentAskUserQuestionSubject}
        isSubmitting={isPlanActionSubmitting}
        onApprove={handleApprovePlan}
        onRequestChanges={handleRequestPlanChanges}
        onDismiss={handleDismissPlanApproval}
      />

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        request={currentConfirmation}
        isOpen={!!currentConfirmation}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
        onClose={handleCloseConfirmation}
      />
    </>
  );
}
