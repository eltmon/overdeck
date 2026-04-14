import { getAgentState, getAgentRuntimeState, getLatestSessionId, normalizeAgentId } from './agents.js';
import { sessionExists } from './tmux.js';

export type WorkAgentOperation = 'start' | 'resume' | 'restart_with_context' | 'reset_session';
export type WorkAgentRecommendedAction = 'start' | 'resume' | 'restart_with_context' | 'reset_session' | 'none';

export interface WorkAgentLifecycleState {
  agentId: string;
  hasAgentState: boolean;
  hasLiveTmuxSession: boolean;
  hasSavedSession: boolean;
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
  const hasSavedSession = !!getLatestSessionId(agentId);
  const hasLiveTmuxSession = sessionExists(agentId);
  const agentStatus = agentState?.status || 'unknown';
  const runtime = runtimeState?.state || 'uninitialized';
  const isCompleted = runtimeState?.resolution === 'completed';
  const isRunning = agentStatus === 'running' && hasLiveTmuxSession;
  const isStopped = agentStatus === 'stopped' || isCompleted || runtime === 'stopped' || runtime === 'idle' || runtime === 'suspended';
  const isCrashed = agentStatus === 'running' && !hasLiveTmuxSession;
  const requiresSessionResetBeforeFreshStart = !hasLiveTmuxSession && hasSavedSession && (isStopped || isCrashed);

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (hasLiveTmuxSession) {
    recommendedAction = 'none';
    reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
  } else if (requiresSessionResetBeforeFreshStart) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a resumable Claude session. Use 'pan resume ${agentOrIssueId}' to continue it or 'pan review reset --session ${agentOrIssueId}' before starting fresh.`;
  } else if (agentState && !hasSavedSession && isStopped) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} is stopped and has no saved Claude session. Start Agent will create a fresh session in the existing workspace.`;
  }

  return {
    agentId,
    hasAgentState: !!agentState,
    hasLiveTmuxSession,
    hasSavedSession,
    isRunning,
    isStopped,
    isCompleted,
    isCrashed,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: !hasLiveTmuxSession && !requiresSessionResetBeforeFreshStart,
    canResumeSession: hasSavedSession && !hasLiveTmuxSession && (isStopped || isCrashed),
    canRestartWithContext: !!agentState && !hasLiveTmuxSession,
    canResetSession: hasSavedSession && !hasLiveTmuxSession,
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
