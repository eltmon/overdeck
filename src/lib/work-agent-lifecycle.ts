import { existsSync } from 'node:fs';
import { getAgentState, getAgentRuntimeState, getLatestSessionId, normalizeAgentId } from './agents.js';
import { sessionExists } from './tmux.js';

export type WorkAgentOperation = 'start' | 'resume' | 'restart_with_context' | 'reset_session';
export type WorkAgentRecommendedAction = 'start' | 'resume' | 'restart_with_context' | 'reset_session' | 'none';

export interface WorkAgentLifecycleState {
  agentId: string;
  hasAgentState: boolean;
  hasLiveTmuxSession: boolean;
  hasSavedSession: boolean;
  hasWorkspace: boolean;
  isPlaceholder: boolean;
  isOrphaned: boolean;
  isRunning: boolean;
  isStopped: boolean;
  isCompleted: boolean;
  isCrashed: boolean;
  runtimeState: string;
  agentStatus: string;
  canStartFresh: boolean;
  canResumeSession: boolean;
  canRestartWithContext: boolean;
  canResetSession: boolean;
  requiresSessionResetBeforeFreshStart: boolean;
  recommendedAction: WorkAgentRecommendedAction;
  reason?: string;
}

export function getWorkAgentLifecycleState(agentOrIssueId: string): WorkAgentLifecycleState {
  const agentId = normalizeAgentId(agentOrIssueId);
  const agentState = getAgentState(agentId);
  const runtimeState = getAgentRuntimeState(agentId);
  const hasAgentState = !!agentState;
  const hasSavedSession = !!getLatestSessionId(agentId);
  const hasLiveTmuxSession = sessionExists(agentId);
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const agentStatus = agentState?.status || 'unknown';
  const runtime = runtimeState?.state || 'uninitialized';
  const isCompleted = runtimeState?.resolution === 'completed';
  const isPlaceholder = !!agentState && agentStatus === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const isStopped = agentStatus === 'stopped' || agentStatus === 'error' || isCompleted || runtime === 'stopped' || runtime === 'idle' || runtime === 'suspended';
  const isRunning = (agentStatus === 'running' || isPlaceholder) && hasLiveTmuxSession;
  const isCrashed = (agentStatus === 'running' || isPlaceholder) && !hasLiveTmuxSession;
  const hasResumableBackingState = hasAgentState && hasWorkspace && !isPlaceholder;
  const isOrphaned = !hasLiveTmuxSession && (
    (hasSavedSession && !hasResumableBackingState)
    || (hasAgentState && (!hasWorkspace || isPlaceholder))
  );
  const requiresSessionResetBeforeFreshStart = hasSavedSession && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed);

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (hasLiveTmuxSession) {
    recommendedAction = 'none';
    reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
  } else if (isOrphaned) {
    recommendedAction = 'start';
    reason = hasSavedSession
      ? `Agent ${agentId} has stale/orphaned session metadata without a resumable workspace-backed agent state. Start Agent should create a fresh session.`
      : `Agent ${agentId} is an orphaned placeholder/stale record. Start Agent should create a fresh session.`;
  } else if (requiresSessionResetBeforeFreshStart) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a resumable Claude session. Use 'pan resume ${agentOrIssueId}' to continue it or 'pan review reset --session ${agentOrIssueId}' before starting fresh.`;
  } else if (hasAgentState && !hasSavedSession && isStopped) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} is stopped and has no saved Claude session. Start Agent will create a fresh session in the existing workspace.`;
  } else if (!hasAgentState && !hasSavedSession) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} has no prior resumable session. Start Agent will create a fresh workspace-backed session.`;
  }

  return {
    agentId,
    hasAgentState,
    hasLiveTmuxSession,
    hasSavedSession,
    hasWorkspace,
    isPlaceholder,
    isOrphaned,
    isRunning,
    isStopped,
    isCompleted,
    isCrashed,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: !hasLiveTmuxSession && (!requiresSessionResetBeforeFreshStart || isOrphaned),
    canResumeSession: hasSavedSession && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed),
    canRestartWithContext: hasAgentState && hasWorkspace && !hasLiveTmuxSession,
    canResetSession: hasSavedSession && !hasLiveTmuxSession && hasResumableBackingState,
    requiresSessionResetBeforeFreshStart,
    recommendedAction,
    reason,
  };
}

export function assertCanStartFresh(agentOrIssueId: string): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleState(agentOrIssueId);
  if (!lifecycle.canStartFresh) {
    throw new Error(lifecycle.reason || `Cannot start fresh for ${lifecycle.agentId}`);
  }
  return lifecycle;
}

export function assertCanResumeSession(agentOrIssueId: string): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleState(agentOrIssueId);
  if (!lifecycle.canResumeSession) {
    throw new Error(lifecycle.reason || `Cannot resume session for ${lifecycle.agentId}`);
  }
  return lifecycle;
}
