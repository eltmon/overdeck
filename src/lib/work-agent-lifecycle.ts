import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import { getAgentState, getAgentStateEffect, getAgentRuntimeState, getAgentRuntimeStateEffect, getLatestSessionId, getLatestSessionIdEffect, normalizeAgentId } from './agents.js';
import { sessionExists, sessionExistsAsyncEffect } from './tmux.js';

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
  /** Agent has a live tmux session and running status, but its runtime is idle or
   * suspended — meaning the model stopped producing output (e.g. model errors).
   * The session should be restarted via resume rather than messaged via pan tell. */
  isRunningButStuck: boolean;
  isStopped: boolean;
  isCompleted: boolean;
  isCrashed: boolean;
  runtimeState: string;
  agentStatus: string;
  canStartFresh: boolean;
  /** True when the session can be resumed (stopped, crashed, or running-but-stuck).
   * Always false when `isRunning` is true — a live, active session is not resumable. */
  canResumeSession: boolean;
  canRestartWithContext: boolean;
  canResetSession: boolean;
  requiresSessionResetBeforeFreshStart: boolean;
  recommendedAction: WorkAgentRecommendedAction;
  reason?: string;
}

async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const pathExistsEffect = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() => pathExistsAsync(path));

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
  // Running-but-stuck: live session + running status, but the runtime is idle or suspended
  // (e.g. the model returned errors and stopped producing output). The tmux session exists but
  // the agent is no longer making progress — it needs a resume, not a message.
  const isRunningButStuck = isRunning && (runtime === 'idle' || runtime === 'suspended');
  const hasResumableBackingState = hasAgentState && hasWorkspace && !isPlaceholder;
  const isOrphaned = !hasLiveTmuxSession && (
    (hasSavedSession && !hasResumableBackingState)
    || (hasAgentState && (!hasWorkspace || isPlaceholder))
  );
  const requiresSessionResetBeforeFreshStart = hasSavedSession && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed);

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (isRunningButStuck) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a live session but its runtime is ${runtime} — it is no longer making progress. Use 'pan resume ${agentOrIssueId}' to restart it.`;
  } else if (hasLiveTmuxSession && agentStatus === 'running') {
    recommendedAction = 'none';
    reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
  } else if (hasLiveTmuxSession && isStopped) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a live tmux session but is stopped. Use 'pan resume ${agentOrIssueId}' to continue or 'pan start ${agentOrIssueId}' will kill the session and start fresh.`;
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
    isRunningButStuck,
    isStopped,
    isCompleted,
    isCrashed,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: (!hasLiveTmuxSession || (hasLiveTmuxSession && isStopped)) && (!requiresSessionResetBeforeFreshStart || isOrphaned),
    // A live, actively-running agent (isRunning=true, isRunningButStuck=false) is already in
    // session — no resume needed. Stuck agents (isRunning=true, isRunningButStuck=true) must
    // use the dedicated isRunningButStuck flag at call sites; canResumeSession stays false for
    // them so `isRunning` and `canResumeSession` are never simultaneously true.
    canResumeSession: !isRunning && hasSavedSession && hasResumableBackingState && (isStopped || isCrashed),
    canRestartWithContext: hasAgentState && hasWorkspace,
    canResetSession: hasSavedSession && hasResumableBackingState,
    requiresSessionResetBeforeFreshStart,
    recommendedAction,
    reason,
  };
}

export async function getWorkAgentLifecycleStateAsync(agentOrIssueId: string): Promise<WorkAgentLifecycleState> {
  return Effect.runPromise(getWorkAgentLifecycleStateAsyncEffect(agentOrIssueId));
}

interface StartFreshOptions {
  allowPausedForce?: boolean;
}

export function assertCanStartFresh(agentOrIssueId: string, options: StartFreshOptions = {}): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleState(agentOrIssueId);
  const pausedForceOverride = options.allowPausedForce === true
    && lifecycle.requiresSessionResetBeforeFreshStart
    && getAgentState(lifecycle.agentId)?.paused === true;
  if (!lifecycle.canStartFresh && !pausedForceOverride) {
    throw new Error(lifecycle.reason || `Cannot start fresh for ${lifecycle.agentId}`);
  }
  return lifecycle;
}

export function assertCanResumeSession(agentOrIssueId: string): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleState(agentOrIssueId);
  if (!lifecycle.canResumeSession && !lifecycle.isRunningButStuck) {
    throw new Error(lifecycle.reason || `Cannot resume session for ${lifecycle.agentId}`);
  }
  return lifecycle;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Asserts about agent lifecycle (cannot start fresh / cannot resume) fail in
 * the typed error channel as `WorkAgentLifecycleViolation`.
 */
export class WorkAgentLifecycleViolation extends Data.TaggedError('WorkAgentLifecycleViolation')<{
  readonly agentId: string;
  readonly reason: string;
}> {}

/** Pure snapshot of the work-agent lifecycle state for an agent or issue. */
export const getWorkAgentLifecycleStateEffect = (
  agentOrIssueId: string,
): Effect.Effect<WorkAgentLifecycleState> =>
  Effect.sync(() => getWorkAgentLifecycleState(agentOrIssueId));

/** Async-FS snapshot of the work-agent lifecycle state. */
export const getWorkAgentLifecycleStateAsyncEffect = (
  agentOrIssueId: string,
): Effect.Effect<WorkAgentLifecycleState> =>
  Effect.gen(function* () {
    const agentId = normalizeAgentId(agentOrIssueId);
    const agentState = yield* getAgentStateEffect(agentId);
    const runtimeState = yield* getAgentRuntimeStateEffect(agentId);
    const hasAgentState = !!agentState;
    const hasSavedSession = !!(yield* getLatestSessionIdEffect(agentId));
    const hasLiveTmuxSession = yield* sessionExistsAsyncEffect(agentId);
    const hasWorkspace = agentState?.workspace ? yield* pathExistsEffect(agentState.workspace) : false;
    const agentStatus = agentState?.status || 'unknown';
    const runtime = runtimeState?.state || 'uninitialized';
    const isCompleted = runtimeState?.resolution === 'completed';
    const isPlaceholder = !!agentState && agentStatus === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
    const isStopped = agentStatus === 'stopped' || agentStatus === 'error' || isCompleted || runtime === 'stopped' || runtime === 'idle' || runtime === 'suspended';
    const isRunning = (agentStatus === 'running' || isPlaceholder) && hasLiveTmuxSession;
    const isCrashed = (agentStatus === 'running' || isPlaceholder) && !hasLiveTmuxSession;
    const isRunningButStuck = isRunning && (runtime === 'idle' || runtime === 'suspended');
    const hasResumableBackingState = hasAgentState && hasWorkspace && !isPlaceholder;
    const isOrphaned = !hasLiveTmuxSession && (
      (hasSavedSession && !hasResumableBackingState)
      || (hasAgentState && (!hasWorkspace || isPlaceholder))
    );
    const requiresSessionResetBeforeFreshStart = hasSavedSession && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed);

    let recommendedAction: WorkAgentRecommendedAction = 'start';
    let reason: string | undefined;

    if (isRunningButStuck) {
      recommendedAction = 'resume';
      reason = `Agent ${agentId} has a live session but its runtime is ${runtime} — it is no longer making progress. Use 'pan resume ${agentOrIssueId}' to restart it.`;
    } else if (hasLiveTmuxSession && agentStatus === 'running') {
      recommendedAction = 'none';
      reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
    } else if (hasLiveTmuxSession && isStopped) {
      recommendedAction = 'resume';
      reason = `Agent ${agentId} has a live tmux session but is stopped. Use 'pan resume ${agentOrIssueId}' to continue or 'pan start ${agentOrIssueId}' will kill the session and start fresh.`;
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
      isRunningButStuck,
      isStopped,
      isCompleted,
      isCrashed,
      runtimeState: runtime,
      agentStatus,
      canStartFresh: (!hasLiveTmuxSession || (hasLiveTmuxSession && isStopped)) && (!requiresSessionResetBeforeFreshStart || isOrphaned),
      canResumeSession: !isRunning && hasSavedSession && hasResumableBackingState && (isStopped || isCrashed),
      canRestartWithContext: hasAgentState && hasWorkspace,
      canResetSession: hasSavedSession && hasResumableBackingState,
      requiresSessionResetBeforeFreshStart,
      recommendedAction,
      reason,
    };
  }).pipe(Effect.orDie);

/** Assert the agent can start fresh; lifts the synchronous throw to a typed error. */
export const assertCanStartFreshEffect = (
  agentOrIssueId: string,
  options: { allowPausedForce?: boolean } = {},
): Effect.Effect<WorkAgentLifecycleState, WorkAgentLifecycleViolation> =>
  Effect.try({
    try: () => assertCanStartFresh(agentOrIssueId, options),
    catch: (cause) =>
      new WorkAgentLifecycleViolation({
        agentId: agentOrIssueId,
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Assert the agent can resume; lifts the synchronous throw to a typed error. */
export const assertCanResumeSessionEffect = (
  agentOrIssueId: string,
): Effect.Effect<WorkAgentLifecycleState, WorkAgentLifecycleViolation> =>
  Effect.try({
    try: () => assertCanResumeSession(agentOrIssueId),
    catch: (cause) =>
      new WorkAgentLifecycleViolation({
        agentId: agentOrIssueId,
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });
