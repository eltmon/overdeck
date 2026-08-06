import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import { getAgentStateSync, getAgentState, getAgentRuntimeStateSync, getAgentRuntimeState, getLatestSessionIdSync, getLatestSessionId, normalizeAgentId } from './agents.js';
import { hasCompletionMarkerForAgent } from './agents/supervisor-channels.js';
import { claudeSessionTranscriptExists } from './paths.js';
import { getReviewStatusSync } from './review-status.js';
import { sessionExistsSync, sessionExists } from './tmux.js';

export type WorkAgentOperation = 'start' | 'resume' | 'restart_with_context' | 'reset_session';
export type WorkAgentRecommendedAction = 'start' | 'resume' | 'restart_with_context' | 'reset_session' | 'none';

function sessionResetRequiredReason(agentId: string, agentOrIssueId: string): string {
  return `Agent ${agentId} has a resumable Claude session. Use 'pan resume ${agentOrIssueId}' to continue it, or run 'pan reset-session ${agentOrIssueId}' before starting a new session.`;
}

/**
 * PAN-3555: a completion marker stops meaning "nothing to resume" the moment the
 * pipeline owes the agent rework — a failed verification, a blocked/failed review,
 * or a failed test after the handoff makes the warm session the rework target
 * (the same condition PAN-2668 uses to clear stoppedByUser for feedback delivery).
 * Without this, the handed-off branch routed `pan start` to a silent fresh session
 * whenever the feedback loop's direct resumeAgent() path failed, abandoning the
 * resumable transcript with no refusal and no logged reason.
 */
export function issueOwesReworkSync(issueId: string | undefined): boolean {
  if (!issueId) return false;
  try {
    const row = getReviewStatusSync(issueId);
    if (!row) return false;
    return row.verificationStatus === 'failed'
      || row.reviewStatus === 'blocked'
      || row.reviewStatus === 'failed'
      || row.testStatus === 'failed';
  } catch {
    return false;
  }
}

export interface WorkAgentLifecycleState {
  agentId: string;
  hasAgentState: boolean;
  hasLiveTmuxSession: boolean;
  hasSavedSession: boolean;
  hasResumableTranscript: boolean;
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
  /** Agent ran `pan done` and a completion marker exists — its work is handed
   * off. A handed-off agent is never offered a plain resume (PAN-3334): there
   * is nothing to continue, the resume only relaunches a huge transcript that
   * the harness compacts, and the session then strands (continuation nets
   * correctly refuse to re-drive handed-off agents, PAN-2974). The review →
   * feedback loop is unaffected — it resurrects through `resumeAgent()`
   * directly, not through this read door. */
  handedOff: boolean;
  /** PAN-3555: true when the agent handed off but the canonical review row shows the
   * pipeline owes it rework (failed verification, blocked/failed review, or failed
   * test). An owed-rework handoff is resumable again — `handedOff` alone no longer
   * closes the resume doors. */
  owesRework: boolean;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function getWorkAgentLifecycleStateSync(agentOrIssueId: string): WorkAgentLifecycleState {
  const agentId = normalizeAgentId(agentOrIssueId);
  const agentState = getAgentStateSync(agentId);
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const hasAgentState = !!agentState;
  const sessionId = getLatestSessionIdSync(agentId) ?? null;
  const hasSavedSession = !!sessionId;
  const hasLiveTmuxSession = sessionExistsSync(agentId);
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const hasResumableTranscript = !sessionId
    || (!!agentState?.harness && agentState.harness !== 'claude-code')
    || !agentState?.workspace
    || claudeSessionTranscriptExists(agentState.workspace, sessionId);
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
  const handedOff = agentState ? hasCompletionMarkerForAgent(agentState) : false;
  const owesRework = handedOff && issueOwesReworkSync(agentState?.issueId);
  const canWarmResumeAfterHandoff = owesRework && !isRunning && hasSavedSession && hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed);
  const isOrphaned = !hasLiveTmuxSession && (
    (hasSavedSession && !hasResumableBackingState)
    || (hasAgentState && (!hasWorkspace || isPlaceholder))
  );
  // handedOff exempts fresh-start (PAN-3543): a completed-handoff agent has
  // "nothing to resume" by design (PAN-3334), so gating --fresh behind a
  // resumable-session reset leaves NO forward path — pan start, --fresh, and
  // reset-session all refused while the refusal message recommended --fresh
  // (observed blocking PAN-3511's rework after a blocked verdict; the durable
  // agents plane reconstructs the session pointer past reset-session, PAN-3541).
  const requiresSessionResetBeforeFreshStart = hasSavedSession && hasResumableTranscript && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed) && !handedOff;

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (isRunningButStuck) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a live session but its runtime is ${runtime} — it is no longer making progress. Use 'pan resume ${agentOrIssueId}' to restart it.`;
  } else if (hasLiveTmuxSession && agentStatus === 'running') {
    recommendedAction = 'none';
    reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
  } else if (canWarmResumeAfterHandoff) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} handed off its work but the pipeline now owes it rework (failed verification, blocked/failed review, or failed test). Use 'pan resume ${agentOrIssueId}' to continue its warm session with the pending feedback (PAN-3555).`;
  } else if (handedOff) {
    // PAN-3334: a handed-off agent has nothing to resume. Offering Resume here
    // only relaunches a finished transcript (which the harness then compacts)
    // and strands the session — continuation nets refuse to re-drive it by
    // design (PAN-2974). The review → feedback loop is unaffected: it
    // resurrects through resumeAgent() directly, not through this read door.
    recommendedAction = 'none';
    reason = `Agent ${agentId} finished and handed off its work (completion marker on disk) — there is nothing to resume. The session is preserved for inspection; message it with 'pan tell ${agentOrIssueId}', or start over with 'pan start ${agentOrIssueId} --fresh'.`;
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
    reason = sessionResetRequiredReason(agentId, agentOrIssueId);
  } else if (hasSavedSession && !hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed)) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} has a saved Claude session id but its transcript is missing on disk (jsonl-missing). Start Agent will create a fresh session in the existing workspace.`;
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
    hasResumableTranscript,
    hasWorkspace,
    isPlaceholder,
    isOrphaned,
    isRunning,
    isRunningButStuck,
    isStopped,
    isCompleted,
    isCrashed,
    handedOff,
    owesRework,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: (!hasLiveTmuxSession || (hasLiveTmuxSession && isStopped)) && (!requiresSessionResetBeforeFreshStart || isOrphaned),
    // A live, actively-running agent (isRunning=true, isRunningButStuck=false) is already in
    // session — no resume needed. Stuck agents (isRunning=true, isRunningButStuck=true) must
    // use the dedicated isRunningButStuck flag at call sites; canResumeSession stays false for
    // them so `isRunning` and `canResumeSession` are never simultaneously true.
    canResumeSession: !isRunning && hasSavedSession && hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed) && (!handedOff || owesRework),
    canRestartWithContext: hasAgentState && hasWorkspace,
    canResetSession: hasSavedSession && hasResumableTranscript && hasResumableBackingState,
    requiresSessionResetBeforeFreshStart,
    recommendedAction,
    reason,
  };
}

async function getWorkAgentLifecycleStateSnapshot(agentOrIssueId: string): Promise<WorkAgentLifecycleState> {
  const agentId = normalizeAgentId(agentOrIssueId);
  const agentState = await Effect.runPromise(getAgentState(agentId));
  const runtimeState = await Effect.runPromise(getAgentRuntimeState(agentId));
  const hasAgentState = !!agentState;
  const sessionId = await Effect.runPromise(getLatestSessionId(agentId)) ?? null;
  const hasSavedSession = !!sessionId;
  const hasLiveTmuxSession = await Effect.runPromise(sessionExists(agentId));
  const hasWorkspace = !!agentState?.workspace && await pathExists(agentState.workspace);
  const hasResumableTranscript = !sessionId
    || (!!agentState?.harness && agentState.harness !== 'claude-code')
    || !agentState?.workspace
    || claudeSessionTranscriptExists(agentState.workspace, sessionId);
  const agentStatus = agentState?.status || 'unknown';
  const runtime = runtimeState?.state || 'uninitialized';
  const isCompleted = runtimeState?.resolution === 'completed';
  const isPlaceholder = !!agentState && agentStatus === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const isStopped = agentStatus === 'stopped' || agentStatus === 'error' || isCompleted || runtime === 'stopped' || runtime === 'idle' || runtime === 'suspended';
  const isRunning = (agentStatus === 'running' || isPlaceholder) && hasLiveTmuxSession;
  const isCrashed = (agentStatus === 'running' || isPlaceholder) && !hasLiveTmuxSession;
  const isRunningButStuck = isRunning && (runtime === 'idle' || runtime === 'suspended');
  const hasResumableBackingState = hasAgentState && hasWorkspace && !isPlaceholder;
  const handedOff = agentState ? hasCompletionMarkerForAgent(agentState) : false;
  const owesRework = handedOff && issueOwesReworkSync(agentState?.issueId);
  const canWarmResumeAfterHandoff = owesRework && !isRunning && hasSavedSession && hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed);
  const isOrphaned = !hasLiveTmuxSession && (
    (hasSavedSession && !hasResumableBackingState)
    || (hasAgentState && (!hasWorkspace || isPlaceholder))
  );
  // handedOff exempts fresh-start (PAN-3543): a completed-handoff agent has
  // "nothing to resume" by design (PAN-3334), so gating --fresh behind a
  // resumable-session reset leaves NO forward path — pan start, --fresh, and
  // reset-session all refused while the refusal message recommended --fresh
  // (observed blocking PAN-3511's rework after a blocked verdict; the durable
  // agents plane reconstructs the session pointer past reset-session, PAN-3541).
  const requiresSessionResetBeforeFreshStart = hasSavedSession && hasResumableTranscript && !hasLiveTmuxSession && hasResumableBackingState && (isStopped || isCrashed) && !handedOff;

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (isRunningButStuck) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a live session but its runtime is ${runtime} — it is no longer making progress. Use 'pan resume ${agentOrIssueId}' to restart it.`;
  } else if (hasLiveTmuxSession && agentStatus === 'running') {
    recommendedAction = 'none';
    reason = `Agent ${agentId} is already running. Use 'pan tell' to message it.`;
  } else if (canWarmResumeAfterHandoff) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} handed off its work but the pipeline now owes it rework (failed verification, blocked/failed review, or failed test). Use 'pan resume ${agentOrIssueId}' to continue its warm session with the pending feedback (PAN-3555).`;
  } else if (handedOff) {
    // PAN-3334: a handed-off agent has nothing to resume. Offering Resume here
    // only relaunches a finished transcript (which the harness then compacts)
    // and strands the session — continuation nets refuse to re-drive it by
    // design (PAN-2974). The review → feedback loop is unaffected: it
    // resurrects through resumeAgent() directly, not through this read door.
    recommendedAction = 'none';
    reason = `Agent ${agentId} finished and handed off its work (completion marker on disk) — there is nothing to resume. The session is preserved for inspection; message it with 'pan tell ${agentOrIssueId}', or start over with 'pan start ${agentOrIssueId} --fresh'.`;
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
    reason = sessionResetRequiredReason(agentId, agentOrIssueId);
  } else if (hasSavedSession && !hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed)) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} has a saved Claude session id but its transcript is missing on disk (jsonl-missing). Start Agent will create a fresh session in the existing workspace.`;
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
    hasResumableTranscript,
    hasWorkspace,
    isPlaceholder,
    isOrphaned,
    isRunning,
    isRunningButStuck,
    isStopped,
    isCompleted,
    isCrashed,
    handedOff,
    owesRework,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: (!hasLiveTmuxSession || (hasLiveTmuxSession && isStopped)) && (!requiresSessionResetBeforeFreshStart || isOrphaned),
    // A live, actively-running agent (isRunning=true, isRunningButStuck=false) is already in
    // session — no resume needed. Stuck agents (isRunning=true, isRunningButStuck=true) must
    // use the dedicated isRunningButStuck flag at call sites; canResumeSession stays false for
    // them so `isRunning` and `canResumeSession` are never simultaneously true.
    // PAN-2908: the async snapshot used to omit hasSavedSession here — every stopped agent with
    // a workspace looked resumable, so the CTA offered Resume with nothing to resume (PAN-806).
    canResumeSession: !isRunning && hasSavedSession && hasResumableTranscript && hasResumableBackingState && (isStopped || isCrashed) && (!handedOff || owesRework),
    canRestartWithContext: hasAgentState && hasWorkspace,
    canResetSession: hasSavedSession && hasResumableTranscript && hasResumableBackingState,
    requiresSessionResetBeforeFreshStart,
    recommendedAction,
    reason,
  };
}

interface StartFreshOptions {
  allowPausedForce?: boolean;
  allowLiveSessionReplacement?: boolean;
  /** True only when the caller carries an explicit operator `--fresh` intent.
   * PAN-3555: without it, a handed-off agent that owes rework and has a
   * resumable warm session must be refused a fresh start — plain `pan start`
   * silently abandoning the warm transcript is exactly the bug. Explicit
   * `--fresh` keeps working (the PAN-3543 escape from the reset deadlock). */
  explicitFresh?: boolean;
}

export function assertCanStartFreshSync(agentOrIssueId: string, options: StartFreshOptions = {}): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleStateSync(agentOrIssueId);
  const pausedForceOverride = options.allowPausedForce === true
    && lifecycle.requiresSessionResetBeforeFreshStart
    && getAgentStateSync(lifecycle.agentId)?.paused === true;
  const liveSessionReplacement = options.allowLiveSessionReplacement === true && lifecycle.isRunning;
  if (liveSessionReplacement && lifecycle.canResetSession) {
    throw new Error(sessionResetRequiredReason(lifecycle.agentId, agentOrIssueId));
  }
  if (options.explicitFresh !== true && lifecycle.owesRework && lifecycle.canResumeSession) {
    throw new Error(
      `Agent ${lifecycle.agentId} handed off its work but the pipeline owes it rework, and its warm session is resumable. `
      + `Use 'pan resume ${agentOrIssueId}' to continue that session with the pending feedback, or pass --fresh to deliberately start a new one (PAN-3555).`,
    );
  }
  if (!lifecycle.canStartFresh && !pausedForceOverride && !liveSessionReplacement) {
    throw new Error(lifecycle.reason || `Cannot start fresh for ${lifecycle.agentId}`);
  }
  return lifecycle;
}

export function assertCanResumeSessionSync(agentOrIssueId: string): WorkAgentLifecycleState {
  const lifecycle = getWorkAgentLifecycleStateSync(agentOrIssueId);
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

export const getWorkAgentLifecycleState = (
  agentOrIssueId: string,
): Effect.Effect<WorkAgentLifecycleState> =>
  Effect.promise(() => getWorkAgentLifecycleStateSnapshot(agentOrIssueId));

/** Assert the agent can start fresh; lifts the synchronous throw to a typed error. */
export const assertCanStartFresh = (
  agentOrIssueId: string,
  options: { allowPausedForce?: boolean } = {},
): Effect.Effect<WorkAgentLifecycleState, WorkAgentLifecycleViolation> =>
  Effect.try({
    try: () => assertCanStartFreshSync(agentOrIssueId, options),
    catch: (cause) =>
      new WorkAgentLifecycleViolation({
        agentId: agentOrIssueId,
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Assert the agent can resume; lifts the synchronous throw to a typed error. */
export const assertCanResumeSession = (
  agentOrIssueId: string,
): Effect.Effect<WorkAgentLifecycleState, WorkAgentLifecycleViolation> =>
  Effect.try({
    try: () => assertCanResumeSessionSync(agentOrIssueId),
    catch: (cause) =>
      new WorkAgentLifecycleViolation({
        agentId: agentOrIssueId,
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });
