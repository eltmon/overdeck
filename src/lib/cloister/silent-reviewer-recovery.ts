/**
 * deacon-lite's silent-reviewer recovery routine (PAN-4433).
 *
 * A reviewer can be dispatched and never run: its pane is live, it writes no
 * transcript and no report, and nothing notices. Quick mode writes no
 * `review.dispatched`, so `recoverStalledReviews` skips the `verification.*`
 * tail, and `recoverUndispatchedReviews` skips any issue with a live review
 * pane. This routine anchors to the dispatch stamp (`reviewDispatchedAt`)
 * instead: a reviewer with no report and no transcript write since the stamp,
 * `roles.review.stallMinutes` after it, is silent.
 *
 * First failure: journal `review.stalled` BEFORE acting (the durable one-shot
 * marker), close the pane, reset the reviewer's state dir, and re-dispatch
 * once. Any failure after that point escalates in the same tick. Second
 * failure for the same (run, reviewer) — silent again, or confirmed dead
 * without a report — journals `review.stall-escalated` and surfaces needs-you;
 * the pane is left alone. It never writes `review.redispatched` (that tail
 * would make `recoverStalledReviews` launch convoy lanes on a quick-mode issue).
 * See docs/PIPELINE-GATES.md.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';

import { emitActivityEntry } from '../activity-logger.js';
import { decideResumeGate, getAgentResumeGateBlockReason, getIssuePause } from '../agents/agent-state.js';
import { getAgentState, type AgentState } from '../agents/agent-state-read.js';
import { isAlive, isConfirmedDead, type LivenessVerdict } from '../agents/liveness.js';
import { getAgentRuntimeStateSync } from '../agents/runtime-state.js';
import { listAgentStates } from '../agents.js';
import { loadConfigSync, reviewStallMs } from '../config-yaml.js';
import { AGENTS_DIR } from '../paths.js';
import { withReviewLifecycleGuard } from '../review-lifecycle-guard.js';
import { appendPipelineEntry, readPipelineJournal, type PipelineJournalEntry } from './pipeline-journal.js';
import { classifyReviewer, reviewerReportPaths, stallHistory } from './silent-reviewer-detect.js';

const SOURCE = 'deacon-lite';

export interface SilentReviewerDeps {
  listReviewStates: () => AgentState[];
  readState: (agentId: string) => AgentState | null;
  isAlive: (agentId: string) => Promise<LivenessVerdict>;
  runtimeWaitingOnHuman: (agentId: string) => boolean;
  /** Last transcript write in ms; null = no transcript. */
  transcriptActivityMs: (agentId: string) => Promise<number | null>;
  reportMtimeMs: (path: string) => number | null;
  /** The run id of the workspace's current head; null when the head is unknown. */
  currentRunId: (issueId: string, workspace: string) => Promise<string | null>;
  stallMs: () => number;
  getIssuePause: typeof getIssuePause;
  resumeGateAllows: (state: AgentState) => boolean;
  redispatchLane: (issueId: string, laneId: string) => Promise<{ success: boolean; message: string }>;
  redispatchParent: (issueId: string, workspace: string, saved: AgentState) => Promise<{ success: boolean; message: string }>;
  surfaceNeedsYou: (issueId: string, reason: string, details?: Record<string, unknown>) => Promise<void>;
}

/** Issues with a recovery in progress, across concurrent patrol invocations. */
const inFlightIssues = new Set<string>();

/** Test seam: clear the in-flight set between test cases. */
export function __resetSilentReviewerStateForTests(): void {
  inFlightIssues.clear();
}

/**
 * Close the reviewer's pane, stop it and reset its state dir so the door
 * fresh-spawns: the saved session is the prime suspect. Transcripts survive
 * (`removeAgentStateDir` preserves every *.jsonl). Returns an error message,
 * or null on success.
 */
async function resetReviewer(agentId: string): Promise<string | null> {
  const { closeAgentPaneDetailed } = await import('../terminal-backends/launch.js');
  const closed = await closeAgentPaneDetailed(agentId);
  if (closed.outcome === 'failed') return `could not close ${agentId}: ${closed.reason}`;
  const { stopAgent } = await import('../agents.js');
  await Effect.runPromise(stopAgent(agentId)).catch((err: unknown) => {
    console.warn(`[deacon-lite] stopAgent(${agentId}) before silent-reviewer re-dispatch failed (non-fatal):`, err);
  });
  const { removeAgentStateDir } = await import('../agents/state-dir-removal.js');
  await removeAgentStateDir(join(AGENTS_DIR, agentId));
  return null;
}

const defaultDeps: SilentReviewerDeps = {
  listReviewStates: () => listAgentStates({ role: 'review' }),
  readState: getAgentState,
  isAlive: (agentId) => isAlive(agentId),
  runtimeWaitingOnHuman: (agentId) => getAgentRuntimeStateSync(agentId)?.state === 'waiting-on-human',
  transcriptActivityMs: async (agentId) => {
    // Dynamic: a static import of the runtimes barrel from cloister closes a module cycle.
    const { getRuntimeForAgent } = await import('../runtimes/index.js');
    return getRuntimeForAgent(agentId)?.getHeartbeat(agentId)?.timestamp.getTime() ?? null;
  },
  reportMtimeMs: (path) => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  },
  currentRunId: async (issueId, workspace) => {
    const { deriveReviewRunHead8 } = await import('./review-agent.js');
    const head8 = await deriveReviewRunHead8(issueId, workspace);
    return head8 === 'unknown' ? null : `agent-${issueId.toLowerCase()}-review-${head8}`;
  },
  stallMs: () => reviewStallMs(loadConfigSync().config),
  getIssuePause,
  resumeGateAllows: (state) => decideResumeGate(getAgentResumeGateBlockReason(state), 'autonomous').decision === 'proceed',
  redispatchLane: async (issueId, laneId) => {
    const resetError = await resetReviewer(laneId);
    if (resetError) return { success: false, message: resetError };
    const { recoverMissingConvoyReviewers } = await import('./review-convoy.js');
    const result = await recoverMissingConvoyReviewers(issueId, { source: 'silent-reviewer-recovery' });
    return { success: result.success, message: result.message };
  },
  redispatchParent: async (issueId, workspace, saved) => {
    const resetError = await resetReviewer(saved.id);
    if (resetError) return { success: false, message: resetError };
    // Straight to the door, not requestReviewThroughRoute: the route re-verifies
    // the head, and the run id proves the head is unchanged since the
    // verification that covers it.
    const { spawnReviewRoleForIssue } = await import('./review-agent.js');
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId,
      workspace,
      branch: `feature/${issueId.toLowerCase()}`,
      force: true,
      operatorRequested: saved.reviewOperatorRequested === true,
      ...(saved.hostOverride ? { allowHost: true } : {}),
    }));
    return { success: result.success, message: result.error ? `${result.message}: ${result.error}` : result.message };
  },
  surfaceNeedsYou: async (issueId, reason, details) => {
    const { surfaceIssueFeedbackNeedsYou } = await import('./feedback-target.js');
    await surfaceIssueFeedbackNeedsYou(issueId, reason, details);
  },
};

type StallHistory = ReturnType<typeof stallHistory>;

/**
 * The journal facts that rule a reviewer out, or its stall history when none
 * does: a verdict for this run (or an unscoped one since the stamp), an abort
 * since the stamp, an earlier escalation, or a stall entry that is not about
 * this dispatch.
 */
function journalAllows(
  entries: readonly PipelineJournalEntry[],
  state: { id: string; reviewRunId: string },
  dispatchedAtMs: number,
): StallHistory | null {
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    if (entry.type === 'review.verdict') {
      const runId = entry.data?.runId;
      if (runId === state.reviewRunId || (runId === undefined && at >= dispatchedAtMs)) return null;
    } else if (entry.type === 'review.aborted' && at >= dispatchedAtMs) {
      return null;
    }
  }
  const history = stallHistory(entries, state.reviewRunId, state.id);
  if (history.escalated) return null;
  // After a stall the verdict must be about the re-dispatched reviewer. The
  // re-dispatch stamps its state in the same tick as the stall entry, often in
  // the same millisecond, so the comparison is inclusive.
  if (history.stalledCount >= 1 && (history.lastStalledAtMs === null || dispatchedAtMs < history.lastStalledAtMs)) return null;
  return history;
}

function paneStateOf(verdict: LivenessVerdict): string {
  return verdict.alive ? (verdict.backendState ?? 'alive') : verdict.reason;
}

async function escalate(
  d: SilentReviewerDeps,
  s: AgentState & { reviewRunId: string; workspace: string },
  issueId: string,
  paneState: string,
  attempt: number,
  journalReason: string,
  needsYouReason: string,
): Promise<string> {
  appendPipelineEntry(s.workspace, {
    type: 'review.stall-escalated',
    issueId,
    source: SOURCE,
    data: { runId: s.reviewRunId, reviewer: s.id, paneState, attempt, reason: journalReason },
  });
  await d.surfaceNeedsYou(issueId, needsYouReason, { reviewer: s.id, runId: s.reviewRunId, paneState, attempts: attempt });
  return `recoverSilentReviewers: escalated silent ${s.id} for ${issueId} — ${journalReason}`;
}

async function recoverOne(
  d: SilentReviewerDeps,
  state: AgentState,
  now: number,
  stallMs: number,
  actedThisTick: Set<string>,
): Promise<string | null> {
  const { issueId: rawIssueId, workspace, reviewRunId, reviewDispatchedAt } = state;
  if (!rawIssueId || !workspace || !reviewRunId || !reviewDispatchedAt) return null;
  const dispatchedAtMs = Date.parse(reviewDispatchedAt);
  if (!Number.isFinite(dispatchedAtMs) || !existsSync(workspace)) return null;
  const s = { ...state, workspace, reviewRunId };
  const issueId = rawIssueId.toUpperCase();
  if (actedThisTick.has(issueId) || inFlightIssues.has(issueId)) return null;

  const history = journalAllows(readPipelineJournal(workspace), s, dispatchedAtMs);
  if (!history) return null;

  const reportSinceDispatch = reviewerReportPaths({
    workspace,
    runId: reviewRunId,
    ...(s.reviewSubRole ? { subRole: s.reviewSubRole } : {}),
    ...(s.reviewOutputPath ? { reviewOutputPath: s.reviewOutputPath } : {}),
  }).some((path) => {
    const mtime = d.reportMtimeMs(path);
    return mtime !== null && mtime >= dispatchedAtMs;
  });
  const verdict = classifyReviewer({
    agentId: s.id,
    runId: reviewRunId,
    dispatchedAtMs,
    lastTranscriptActivityMs: await d.transcriptActivityMs(s.id),
    reportSinceDispatch,
  }, stallMs, now);
  if (verdict.silent === false && verdict.reason !== 'active') return null;
  // An active reviewer is fine unless it was already re-dispatched once and
  // has since died without a report: nothing else recovers that one (D7).
  if (verdict.silent === false && history.stalledCount === 0) return null;

  if ((await d.currentRunId(issueId, workspace)) !== reviewRunId) return null;
  if (d.getIssuePause(issueId).status !== 'unpaused' || !d.resumeGateAllows(s)) return null;

  const liveness = await d.isAlive(s.id);
  if (!liveness.alive && !isConfirmedDead(liveness)) return null;
  if (liveness.alive && (liveness.backendState === 'blocked' || d.runtimeWaitingOnHuman(s.id))) return null;
  // A first-time dead reviewer belongs to recoverStalledReviews / recoverUndispatchedReviews.
  if (!liveness.alive && history.stalledCount === 0) return null;
  if (liveness.alive && !verdict.silent) return null;
  const paneState = paneStateOf(liveness);

  actedThisTick.add(issueId);
  inFlightIssues.add(issueId);
  try {
    return await withReviewLifecycleGuard(issueId, async () => {
      // Another door may have re-dispatched or finished the review while this
      // tick was probing. Act only on exactly what was inspected.
      const fresh = d.readState(s.id);
      if (!fresh || fresh.reviewRunId !== reviewRunId || fresh.reviewDispatchedAt !== reviewDispatchedAt) return null;
      const recheck = journalAllows(readPipelineJournal(workspace), s, dispatchedAtMs);
      if (!recheck || recheck.stalledCount !== history.stalledCount) return null;

      if (history.stalledCount >= 1) {
        const died = !liveness.alive;
        return escalate(
          d, s, issueId, paneState, history.stalledCount + 1,
          died ? 'died without a report after re-dispatch' : 'silent again after re-dispatch',
          died
            ? `review agent ${s.id} died without a report for run ${reviewRunId} after a re-dispatch (pane ${paneState})`
            : `review agent ${s.id} produced no output for run ${reviewRunId} after a re-dispatch (pane ${paneState})`,
        );
      }

      const silentForMs = verdict.silent ? verdict.silentForMs : now - dispatchedAtMs;
      appendPipelineEntry(workspace, {
        type: 'review.stalled',
        issueId,
        source: SOURCE,
        data: { runId: reviewRunId, reviewer: s.id, paneState, dispatchedAt: reviewDispatchedAt, silentForMs, attempt: 1 },
      });
      const detected = `${issueId}: review agent ${s.id} produced no output ${Math.round(silentForMs / 60_000)}m after dispatch (pane ${paneState}) — re-dispatching once`;
      console.warn(`[deacon-lite] ${detected}`);
      emitActivityEntry({ source: 'review', level: 'warn', message: detected, issueId });

      let outcome: { success: boolean; message: string };
      try {
        outcome = s.reviewSubRole
          ? await d.redispatchLane(issueId, s.id)
          : await d.redispatchParent(issueId, workspace, s);
      } catch (err) {
        outcome = { success: false, message: err instanceof Error ? err.message : String(err) };
      }
      if (!outcome.success) {
        return escalate(
          d, s, issueId, paneState, 1,
          `re-dispatch failed: ${outcome.message}`,
          `review agent ${s.id} produced no output for run ${reviewRunId} and its re-dispatch failed: ${outcome.message} (pane ${paneState})`,
        );
      }
      return `recoverSilentReviewers: re-dispatched silent ${s.id} for ${issueId} — ${outcome.message}`;
    });
  } finally {
    inFlightIssues.delete(issueId);
  }
}

/**
 * Detect review agents that were dispatched but never produced output, re-
 * dispatch each once per run, and escalate a second failure to the operator.
 * Never throws: a failure on one reviewer is logged and the next is inspected.
 */
export async function recoverSilentReviewers(now = Date.now(), deps: Partial<SilentReviewerDeps> = {}): Promise<string[]> {
  const d: SilentReviewerDeps = { ...defaultDeps, ...deps };
  const actions: string[] = [];
  let states: AgentState[];
  let stallMs: number;
  try {
    states = d.listReviewStates();
    stallMs = d.stallMs();
  } catch (err) {
    console.error('[deacon-lite] Could not list review agents for silent-reviewer recovery:', err);
    return actions;
  }

  const actedThisTick = new Set<string>();
  for (const state of states) {
    try {
      const action = await recoverOne(d, state, now, stallMs, actedThisTick);
      if (action) actions.push(action);
    } catch (err) {
      console.error(`[deacon-lite] Silent-reviewer recovery failed for ${state.id}:`, err);
    }
  }
  return actions;
}
