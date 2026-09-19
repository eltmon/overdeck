/**
 * Deacon-lite (PAN-3917 W4): the surviving watcher.
 *
 * Replaces the 3,400-line `deacon.ts` (~60 awaited patrol routines writing to
 * the record plane) with four routines that only observe and nudge/notify —
 * never reconcile a stored copy. See docs/PIPELINE-GATES.md and the PAN-3917
 * PRD ("The patrol loop", FR-11, D1/D4/D5/D6/D7).
 *
 * No heartbeat file, no patrol-result aggregation, no firing budgets, no
 * invariant checker. Status is in-memory only (see getDeaconLiteStatus
 * below) and is lost on process restart by design. The forked deacon child
 * relays each completed tick to its parent through setPatrolRunObserver
 * (PAN-3922), so the dashboard process can project the child's status.
 */
import type { AgentState } from '../agents/agent-state.js';
import { listAgentStates } from '../agents.js';
import { isAlive, isConfirmedDead, isIdle } from '../agents/liveness.js';
import { liveAgentInventory } from '../terminal-backends/inventory.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { getWorkspaceGitState } from '../workspaces/git-state.js';
import { isDeaconGloballyPausedSync } from '../overdeck/control-settings.js';
import { reconcileClosedIssueAgents } from './closed-issue-reaper.js';
import { checkApiErrorAgents } from './deacon-api-recovery.js';

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
    // On tmux an absent session can still mean a probe that failed rather than
    // a death, so the oracle gets the final word; on Herdr the inventory IS the
    // oracle, and absence from it is the confirmed death.
    let reason = `absent from the ${inventory.backend} inventory`;
    if (inventory.backend === 'tmux') {
      const verdict = await isAlive(agent.id);
      if (verdict.alive || !isConfirmedDead(verdict)) continue;
      reason = verdict.reason;
    }

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
// The patrol loop
// ============================================================================

export async function runDeaconLite(): Promise<void> {
  // D7 keeps DeaconPauseToggle / pan admin cloister pause — honor it here so
  // a manual "run patrol now" and the interval both respect it. Host hygiene
  // is unaffected (FR-11 runs it outside deacon-lite).
  if (isDeaconGloballyPausedSync()) return;
  await checkStuckWorkAgents();
  await checkApiErrorAgents();
  await reconcileAgentLiveness();
  await reapClosedIssueAgents();
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
