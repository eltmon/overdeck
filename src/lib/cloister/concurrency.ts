/**
 * Concurrency governor for deacon auto-resume / auto-dispatch (PAN-1665).
 *
 * The deacon's patrol re-spawns work from several sources (resume stopped work
 * agents, re-dispatch orphaned review/test specialists, …). With no ceiling, an
 * unfreeze marches the box toward dozens of concurrent heavy `claude` processes.
 *
 * This module is the single budget every patrol spawn path consults. Two rules:
 *
 *  1. It is a **gate on starting new work** — it NEVER kills a running agent to
 *     get back under a limit. If the system is already over (a forced `pan start`,
 *     a backlog at unfreeze), the deacon simply resumes/dispatches nothing until
 *     natural attrition drains the count. Forcibly trimming an over-limit system
 *     is the operator's explicit emergency brake, never automatic.
 *  2. Advancing roles (review/test/ship) get reserved headroom above the work cap
 *     so the pipeline can always drain instead of deadlocking with work agents.
 */

import { loadCloisterConfigSync } from './config.js';
import {
  listRunningAgentsSync,
  stopAgentSync,
  getAgentStateSync,
  saveAgentStateSync,
  getAgentRuntimeStateSync,
} from '../agents.js';

const DEFAULT_MAX_WORK_AGENTS = 6;
const DEFAULT_RESERVED_ADVANCING_SLOTS = 3;

/** Roles that advance work through the pipeline and must keep reserved headroom. */
const ADVANCING_ROLES = new Set(['review', 'test', 'ship']);

export interface ConcurrencyLimits {
  maxWorkAgents: number;
  reservedAdvancingSlots: number;
  /** Overall ceiling for any auto-dispatch: work cap + reserved advancing slots. */
  totalCeiling: number;
}

function normalizeCount(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored < min ? min : floored;
}

export function getConcurrencyLimits(): ConcurrencyLimits {
  const c = loadCloisterConfigSync().concurrency;
  const maxWorkAgents = normalizeCount(c?.max_work_agents, DEFAULT_MAX_WORK_AGENTS, 1);
  const reservedAdvancingSlots = normalizeCount(c?.reserved_advancing_slots, DEFAULT_RESERVED_ADVANCING_SLOTS, 0);
  return {
    maxWorkAgents,
    reservedAdvancingSlots,
    totalCeiling: maxWorkAgents + reservedAdvancingSlots,
  };
}

export interface RunningCounts {
  work: number;
  advancing: number;
  total: number;
}

/** Count currently-running (tmux-alive) agents by role class. */
export function countRunningAgents(): RunningCounts {
  let work = 0;
  let advancing = 0;
  for (const agent of listRunningAgentsSync()) {
    if (!agent.tmuxActive) continue;
    if (agent.role === 'work') work++;
    else if (agent.role && ADVANCING_ROLES.has(agent.role)) advancing++;
  }
  return { work, advancing, total: work + advancing };
}

/**
 * How many work agents the deacon may resume/spawn this patrol. Zero when already
 * at or over the cap — the deacon then resumes nothing and lets attrition drain.
 */
export function workResumeSlotsAvailable(
  counts: RunningCounts = countRunningAgents(),
  limits: ConcurrencyLimits = getConcurrencyLimits(),
): number {
  return Math.max(0, limits.maxWorkAgents - counts.work);
}

/**
 * Whether an advancing-role (review/test/ship) dispatch is allowed. Gated on the
 * overall ceiling so review/test/ship can always claim their reserved headroom.
 */
export function canDispatchAdvancing(
  counts: RunningCounts = countRunningAgents(),
  limits: ConcurrencyLimits = getConcurrencyLimits(),
): boolean {
  return counts.total < limits.totalCeiling;
}

// ---------------------------------------------------------------------------
// Per-patrol advancing-dispatch reservation
//
// countRunningAgents() only sees tmux-alive sessions. Agents dispatched earlier
// in the SAME patrol haven't registered a session yet, so several dispatch
// functions (checkOrphanedReviewStatuses, checkMissingReviewStatuses,
// checkPendingTestDispatch, checkPostReviewCommits) running back-to-back would
// each see the stale low count and blow past the ceiling. runPatrol() resets
// this counter at the top of every cycle; each dispatch site reserves a slot.
// ---------------------------------------------------------------------------
let advancingReservedThisPatrol = 0;

/** Reset the per-patrol advancing-dispatch budget. Called once at patrol start. */
export function resetPatrolDispatchBudget(): void {
  advancingReservedThisPatrol = 0;
}

/**
 * Claim one advancing-role (review/test/ship) dispatch slot for this patrol.
 * Returns false when the total ceiling is reached — the caller must DEFER (leave
 * status untouched so a later patrol retries), never fail. Counts both tmux-alive
 * agents and advancing dispatches already reserved this patrol.
 */
export function tryReserveAdvancingSlot(): boolean {
  const { total } = countRunningAgents();
  const { totalCeiling } = getConcurrencyLimits();
  if (total + advancingReservedThisPatrol >= totalCeiling) return false;
  advancingReservedThisPatrol++;
  return true;
}

// ---------------------------------------------------------------------------
// Emergency brake
//
// The governor never auto-kills to satisfy a limit, so an over-cap system
// (forced `pan start`s, an unfreeze backlog) stays over until attrition drains.
// The emergency brake is the *explicit operator action* that forcibly trims the
// excess. It is deliberately separate from the nuclear `emergencyStop` (which
// kills ALL agents): the brake stops only work agents above the cap, idle ones
// first, and clears the user-stop flag so the deacon re-admits them as slots free
// (drain-at-cap, not retirement). Never called automatically.
// ---------------------------------------------------------------------------
export interface BrakeResult {
  /** Running work agents before the brake. */
  before: number;
  /** The configured work-agent cap. */
  cap: number;
  /** Agent ids stopped by the brake. */
  stopped: string[];
  /** Running work agents after the brake. */
  remaining: number;
}

export function emergencyBrake(): BrakeResult {
  const { maxWorkAgents } = getConcurrencyLimits();
  const runningWork = listRunningAgentsSync().filter(a => a.tmuxActive && a.role === 'work');
  const excess = runningWork.length - maxWorkAgents;
  if (excess <= 0) {
    return { before: runningWork.length, cap: maxWorkAgents, stopped: [], remaining: runningWork.length };
  }

  // Stop the least-productive first: idle agents ahead of active ones, and among
  // equals the stalest (oldest lastActivity) first.
  const ordered = [...runningWork].sort((a, b) => {
    const aIdle = getAgentRuntimeStateSync(a.id)?.state === 'idle' ? 0 : 1;
    const bIdle = getAgentRuntimeStateSync(b.id)?.state === 'idle' ? 0 : 1;
    if (aIdle !== bIdle) return aIdle - bIdle;
    return (Date.parse(a.lastActivity ?? '') || 0) - (Date.parse(b.lastActivity ?? '') || 0);
  });

  const stopped: string[] = [];
  for (const agent of ordered.slice(0, excess)) {
    try {
      stopAgentSync(agent.id);
      // stopAgentSync stamps stoppedByUser=true (deliberate stop). Clear it so the
      // deacon re-admits this agent when a slot frees — the brake trims to the cap,
      // it does not retire the work.
      const state = getAgentStateSync(agent.id);
      if (state) {
        delete state.stoppedByUser;
        saveAgentStateSync(state);
      }
      stopped.push(agent.id);
    } catch {
      // best effort — skip agents that fail to stop cleanly
    }
  }

  return {
    before: runningWork.length,
    cap: maxWorkAgents,
    stopped,
    remaining: runningWork.length - stopped.length,
  };
}
