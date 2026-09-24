/**
 * Deacon-lite (PAN-3917 W4): the surviving watcher.
 *
 * Replaces the 3,400-line `deacon.ts` (~60 awaited patrol routines writing to
 * the record plane) with five routines that only observe and nudge/notify —
 * never reconcile a stored copy. See docs/PIPELINE-GATES.md and the PAN-3917
 * PRD ("The patrol loop", FR-11, D1/D4/D5/D6/D7).
 *
 * No heartbeat file, no patrol-result aggregation, no firing budgets, no
 * invariant checker. Status is in-memory only (see getDeaconLiteStatus
 * below) and is lost on process restart by design. The forked deacon child
 * relays each completed tick to its parent through setPatrolRunObserver
 * (PAN-3922), so the dashboard process can project the child's status.
 */
import { existsSync } from 'node:fs';

import { getIssuePause, type AgentState } from '../agents/agent-state.js';
import { listAgentStates } from '../agents.js';
import { isAlive, isConfirmedDead, isIdle } from '../agents/liveness.js';
import { liveAgentInventory } from '../terminal-backends/inventory.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { getWorkspaceGitState } from '../workspaces/git-state.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';
import { listWorkspaces } from '../workspaces/resolver.js';
import { reconcileClosedIssueAgents } from './closed-issue-reaper.js';
import { checkApiErrorAgents } from './deacon-api-recovery.js';
import { appendPipelineEntry, lastPipelineEntry } from './pipeline-journal.js';

export { checkApiErrorAgents };

// ============================================================================
// checkStuckWorkAgents (FR-11): a work agent idle for N minutes whose feature
// branch has commits not on its upstream gets one nudge, at most once/hour.
// ============================================================================

const STUCK_IDLE_MINUTES_DEFAULT = 20;
const STUCK_IDLE_THRESHOLD_MS = STUCK_IDLE_MINUTES_DEFAULT * 60_000;
const STUCK_NUDGE_COOLDOWN_MS = 60 * 60_000; // one nudge per agent per hour

const lastStuckNudgeAt = new Map<string, number>();

/** Test seam: clear the per-agent nudge cooldown between test cases. */
export function __resetStuckWorkAgentCooldownForTests(): void {
  lastStuckNudgeAt.clear();
}

function stuckNudgeMessage(idleMinutes: number, unpushedCommits: number): string {
  return `You've been idle for ${idleMinutes}+ minutes with ${unpushedCommits} commit(s) not pushed to your upstream branch. ` +
    'Continue your work, or push and open a PR if it is ready.';
}

export async function checkStuckWorkAgents(now = Date.now()): Promise<string[]> {
  const actions: string[] = [];
  const workAgents = listAgentStates({ role: 'work', status: 'running' });
  // A nudge can only reach an agent the backend still hosts. An unreadable
  // inventory is indeterminate: nudge nobody rather than message the dead.
  const inventory = await liveAgentInventory();
  if (inventory === null) return actions;
  const liveIds = new Set(inventory.panes.map((pane) => pane.agentId));

  for (const agent of workAgents) {
    if (!agent.workspace) continue;
    if (!liveIds.has(agent.id)) continue;
    if (!isIdle(agent.id, STUCK_IDLE_THRESHOLD_MS, now)) continue;

    const lastNudge = lastStuckNudgeAt.get(agent.id);
    if (lastNudge !== undefined && now - lastNudge < STUCK_NUDGE_COOLDOWN_MS) continue;

    let ahead: number | null;
    try {
      const gitState = await getWorkspaceGitState(agent.workspace);
      ahead = gitState.ahead;
    } catch {
      continue;
    }
    if (!ahead) continue; // null (probe failed) or 0 — nothing unpushed to nudge about

    try {
      await deliverAgentMessage(
        agent.id,
        stuckNudgeMessage(STUCK_IDLE_MINUTES_DEFAULT, ahead),
        'deacon-lite:checkStuckWorkAgents',
      );
      lastStuckNudgeAt.set(agent.id, now);
      actions.push(`checkStuckWorkAgents: nudged ${agent.id} (idle ${STUCK_IDLE_MINUTES_DEFAULT}+ min, ${ahead} unpushed commit(s))`);
    } catch (err) {
      console.error(`[deacon-lite] Failed to nudge stuck work agent ${agent.id}:`, err);
    }
  }

  return actions;
}

// ============================================================================
// reconcileAgentLiveness (FR-11): compare the live backend inventory against
// the dashboard's in-memory cache and correct the cache side only, via the
// same notifier seam deacon.ts used to wire to the server's event-sourced
// read model (src/dashboard/server/main.ts). Never writes a record or a
// state file itself.
// ============================================================================

type AgentStoppedNotifier = (agentId: string) => void;
type AgentStatusChangedNotifier = (
  state: AgentState,
  previousStatus?: AgentState['status'],
  hasLiveTmuxSession?: boolean,
) => void;

let agentStoppedNotifier: AgentStoppedNotifier | null = null;
let agentStatusChangedNotifier: AgentStatusChangedNotifier | null = null;

/** Registered by the dashboard server layer (main.ts) to project a confirmed-dead agent into its own read model. */
export function setAgentStoppedNotifier(fn: AgentStoppedNotifier | null): void {
  agentStoppedNotifier = fn;
}

/** Registered by the dashboard server layer (main.ts) to project a status change into its own read model. */
export function setAgentStatusChangedNotifier(fn: AgentStatusChangedNotifier | null): void {
  agentStatusChangedNotifier = fn;
}

export async function reconcileAgentLiveness(): Promise<string[]> {
  const actions: string[] = [];
  const runningAgents = listAgentStates({ status: 'running' });
  // PAN-3917: the evidence is the SELECTED backend's inventory. Under Herdr no
  // agent has a tmux session, so the tmux liveness oracle would declare every
  // one of them dead and this routine would blank the dashboard's cache.
  const inventory = await liveAgentInventory();
  if (inventory === null) return actions;
  const liveIds = new Set(inventory.panes.map((pane) => pane.agentId));

  for (const agent of runningAgents) {
    if (liveIds.has(agent.id)) continue;
    // Absence from the inventory is not yet a death: on tmux it can be a probe
    // that failed, and on Herdr the agent may still run in the tmux session it
    // had before the host switched (review of #4018, L1) — the Herdr inventory
    // lists Herdr panes only. The oracle gets the final word on both, so this
    // never marks stopped an agent `resumeAgent` refuses as healthy. An
    // indeterminate verdict leaves the cache as it is.
    const verdict = await isAlive(agent.id);
    if (verdict.alive || !isConfirmedDead(verdict)) continue;
    const reason = `absent from the ${inventory.backend} inventory; ${verdict.reason}`;

    if (agentStoppedNotifier) {
      try {
        agentStoppedNotifier(agent.id);
        actions.push(`reconcileAgentLiveness: corrected cache for ${agent.id} (confirmed dead: ${reason})`);
      } catch (err) {
        console.error(`[deacon-lite] Failed to notify cache correction for ${agent.id}:`, err);
      }
    }
  }

  return actions;
}

// ============================================================================
// reapClosedIssueAgents (D4): keep closed-issue-reaper.ts as-is — it reads
// the tracker only.
// ============================================================================

export const reapClosedIssueAgents = reconcileClosedIssueAgents;

// ============================================================================
// recoverStalledReviews: the one recovery routine, driven by the pipeline
// journal. A dashboard restart mid-convoy used to lose the convoy with nothing
// left to re-dispatch from, and a dead reviewer pane blocked re-dispatch
// forever (PAN-3939). The journal says what Overdeck last DID for an issue; if
// that was "reviewers exist" and no reviewer pane does, the convoy is gone.
//
// ACCEPTED v1 GAPS — stated, not built:
//   - A convoy where some reviewers posted a verdict and one died is not
//     recovered: the last entry is then `review.verdict`.
//     `review.dispatched.data.reviewers` carries enough to count verdicts
//     later, when that case is worth the code.
//   - A quick-mode review writes no `review.dispatched` entry (there is no
//     convoy), so a dead quick reviewer is not recovered here either.
//   - Any issue whose LAST entry is `verification.*` is skipped, and that is
//     wider than it sounds: a `verification.passed` with nothing after it means
//     the review was never dispatched (the runner died while pushing, or the
//     review spawn came back gated) — the PAN-3705 shape itself. It stays
//     unrecovered on purpose: the same skip is what stops this routine from
//     re-running verification every hour for an agent that owes rework, and
//     the runner may still legitimately be mid-push when the tick fires.
// ============================================================================

const STALLED_REVIEW_MIN_AGE_MS = 15 * 60_000;
const STALLED_REVIEW_COOLDOWN_MS = 60 * 60_000; // one re-dispatch per issue per hour

const lastReviewRedispatchAt = new Map<string, number>();
/** issueId -> pausedAt of the pause already logged, so a hold logs once, not every tick. */
const loggedPausedSkip = new Map<string, string>();

/** Test seam: clear the per-issue re-dispatch cooldown between test cases. */
export function __resetStalledReviewCooldownForTests(): void {
  lastReviewRedispatchAt.clear();
  loggedPausedSkip.clear();
}

/**
 * The LAST entry overall decides — never the last `review.` one. A
 * `verification.failed` written after `review.requested` means the work agent
 * owes rework, and re-dispatching there would re-run verification every hour
 * forever.
 */
function stalledReviewReason(type: string): string | null {
  if (type === 'review.dispatched' || type === 'review.redispatched') {
    return 'reviewers were dispatched but none is live and no verdict was posted';
  }
  if (type === 'review.requested') {
    return 'the review was requested but the pipeline never dispatched reviewers';
  }
  return null;
}

export async function recoverStalledReviews(now = Date.now()): Promise<string[]> {
  const actions: string[] = [];
  // An unreadable inventory is indeterminate: re-dispatch nobody rather than
  // relaunch a convoy that is alive.
  const inventory = await liveAgentInventory();
  if (inventory === null) return actions;
  const livePaneIds = inventory.panes.map((pane) => pane.agentId);

  let workspaces: ReturnType<typeof listWorkspaces>;
  try {
    workspaces = listWorkspaces();
  } catch (err) {
    console.error('[deacon-lite] Could not list workspaces for stalled-review recovery:', err);
    return actions;
  }

  for (const workspace of workspaces) {
    const issueId = workspace.issueId?.toUpperCase();
    if (!issueId || !workspace.path || !existsSync(workspace.path)) continue;

    const last = lastPipelineEntry(workspace.path);
    if (!last) continue;
    const reason = stalledReviewReason(last.type);
    if (!reason) continue;
    const at = Date.parse(last.at);
    if (Number.isNaN(at) || now - at < STALLED_REVIEW_MIN_AGE_MS) continue;

    // An operator issue pause holds the whole issue, reviewers included
    // (PAN-3911). An unreadable pause is a hold too. getIssuePause never throws.
    const pause = getIssuePause(issueId);
    if (pause.status !== 'unpaused') {
      const key = pause.status === 'paused' ? `paused:${pause.pausedAt ?? ''}` : `unknown:${pause.reason}`;
      if (loggedPausedSkip.get(issueId) !== key) {
        loggedPausedSkip.set(issueId, key);
        const why = pause.status === 'paused'
          ? `is paused (${pause.agentId}${pause.pausedReason ? `: ${pause.pausedReason}` : ''})`
          : `has an unreadable pause state (${pause.agentId}: ${pause.reason})`;
        console.log(`[deacon-lite] ${issueId} ${why} — not re-dispatching its stalled review`);
      }
      continue;
    }

    // Only SUB-reviewers count as "the convoy is alive". The synthesis parent's
    // id is exactly `agent-<issue>-review`, so a prefix without the trailing
    // dash would let a live parent mask four dead lanes — the PAN-3939 wedge.
    const reviewerPrefix = `agent-${issueId.toLowerCase()}-review-`;
    if (livePaneIds.some((agentId) => agentId.startsWith(reviewerPrefix))) continue;

    const lastRedispatch = lastReviewRedispatchAt.get(issueId);
    if (lastRedispatch !== undefined && now - lastRedispatch < STALLED_REVIEW_COOLDOWN_MS) continue;
    // The in-memory map dies with the deacon child; our own journal entry is
    // the cooldown that survives a restart (PAN-3914).
    if (last.type === 'review.redispatched' && now - at < STALLED_REVIEW_COOLDOWN_MS) continue;

    // Cheapest first: relaunching missing lanes against the existing run reuses
    // the parent's own state.json, which survives a server restart, so nothing
    // re-verifies. Only a parent with no run state at all needs the full door.
    let via = 'convoy-recovery';
    let outcome: string;
    try {
      const { recoverMissingConvoyReviewers } = await import('./review-convoy.js');
      const recovery = await recoverMissingConvoyReviewers(issueId, { source: 'deacon-lite' });
      outcome = recovery.message;
      if (!recovery.success && /no review parent state|missing workspace\/runId/i.test(recovery.message)) {
        const { getRequestReviewStarter } = await import('./request-review-pipeline.js');
        const startReview = getRequestReviewStarter();
        if (!startReview) continue;
        via = 'request-review';
        const started = await startReview(issueId, {
          note: `deacon-lite: ${reason}`,
          source: 'deacon-lite',
        });
        if (!started.started) continue;
        outcome = `re-requested review (${reason})`;
      } else if (!recovery.success) {
        // Nothing was launched: do not journal a re-dispatch that never happened.
        console.warn(`[deacon-lite] Stalled-review recovery declined for ${issueId}: ${recovery.message}`);
        continue;
      } else if (!recovery.launched) {
        // Every lane already reported: nothing to relaunch, so no re-dispatch
        // to journal or report (PAN-3914). Cool down so the next tick does not
        // re-probe the same convoy.
        lastReviewRedispatchAt.set(issueId, now);
        // A confirmed-dead synthesis parent is a real stall nothing here can
        // recover (#4134): say so, once per cooldown. A live or indeterminate
        // parent may still be synthesizing, so it stays quiet.
        const parentId = `agent-${issueId.toLowerCase()}-review`;
        if (isConfirmedDead(await isAlive(parentId))) {
          console.warn(`[deacon-lite] ${issueId}: every review lane reported but no verdict was posted and the synthesis parent ${parentId} is dead — not recoverable here (#4134)`);
        }
        continue;
      }
    } catch (err) {
      console.error(`[deacon-lite] Stalled-review recovery failed for ${issueId}:`, err);
      continue;
    }

    lastReviewRedispatchAt.set(issueId, now);
    appendPipelineEntry(workspace.path, {
      type: 'review.redispatched',
      issueId,
      source: 'deacon-lite',
      data: { reason, via },
    });
    actions.push(`recoverStalledReviews: re-dispatched ${issueId} via ${via} — ${outcome}`);
  }

  return actions;
}

// ============================================================================
// The patrol loop
// ============================================================================

export async function runDeaconLite(): Promise<void> {
  // D7 keeps DeaconPauseToggle / pan admin cloister pause — honor it here so
  // a manual "run patrol now" and the interval both respect it. Host hygiene
  // is unaffected (FR-11 runs it outside deacon-lite).
  if (isDeaconGloballyPaused()) return;
  await checkStuckWorkAgents();
  await checkApiErrorAgents();
  await reconcileAgentLiveness();
  await reapClosedIssueAgents();
  await recoverStalledReviews();
}

// ============================================================================
// Loop control + in-memory status. No heartbeat file, no patrol-result
// aggregation — just enough to answer "is it running and did it last run
// cleanly" (see module docstring).
// ============================================================================

export const DEACON_LITE_INTERVAL_MS = 60_000; // the 60s cadence runScheduledPatrol used

export interface PatrolRunReport {
  at: string;
  error: string | null;
}

let deaconLiteInterval: ReturnType<typeof setInterval> | null = null;
let lastRunAt: string | null = null;
let lastRunError: string | null = null;
let patrolRunObserver: ((report: PatrolRunReport) => void) | null = null;

/** Registered by the deacon child to relay each completed tick to its parent process (PAN-3922). */
export function setPatrolRunObserver(fn: ((report: PatrolRunReport) => void) | null): void {
  patrolRunObserver = fn;
}

export async function runDeaconLitePatrol(): Promise<void> {
  try {
    await runDeaconLite();
    lastRunAt = new Date().toISOString();
    lastRunError = null;
  } catch (err) {
    lastRunAt = new Date().toISOString();
    lastRunError = err instanceof Error ? err.message : String(err);
    console.error('[deacon-lite] run error:', err);
  }

  if (patrolRunObserver) {
    try {
      patrolRunObserver({ at: lastRunAt, error: lastRunError });
    } catch (err) {
      console.error('[deacon-lite] patrol run observer failed:', err);
    }
  }
}

export function startDeaconLite(): void {
  if (deaconLiteInterval) return;
  void runDeaconLitePatrol();
  deaconLiteInterval = setInterval(() => { void runDeaconLitePatrol(); }, DEACON_LITE_INTERVAL_MS);
  deaconLiteInterval.unref?.();
}

export function stopDeaconLite(): void {
  if (!deaconLiteInterval) return;
  clearInterval(deaconLiteInterval);
  deaconLiteInterval = null;
}

export function isDeaconLiteRunning(): boolean {
  return deaconLiteInterval !== null;
}

export interface DeaconLiteStatus {
  running: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  lastRunError: string | null;
}

export function getDeaconLiteStatus(): DeaconLiteStatus {
  return { running: isDeaconLiteRunning(), intervalMs: DEACON_LITE_INTERVAL_MS, lastRunAt, lastRunError };
}
