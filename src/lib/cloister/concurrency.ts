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
import { countAgentsByStatus } from '../overdeck/agents.js';

const DEFAULT_MAX_WORK_AGENTS = 6;
const DEFAULT_RESERVED_ADVANCING_SLOTS = 3;
const DEFAULT_RESERVED_SWARM_SLOTS = 3;

/** Roles that advance work through the pipeline and must keep reserved headroom. */
const ADVANCING_ROLES = new Set(['review', 'test', 'ship']);

/**
 * Swarm slots (PAN-2212) are work-role sessions with an `agent-<issue>-slot-N`
 * id. They draw from a dedicated swarm reserve and are counted APART from `work`,
 * so a busy pipeline never starves the swarm — and running swarm slots never
 * starve review/test in reverse.
 */
const SWARM_SLOT_ID = /-slot-\d+$/;

export interface ConcurrencyLimits {
  maxWorkAgents: number;
  reservedAdvancingSlots: number;
  /** Dedicated swarm-slot reserve, isolated from the work/advancing ceiling (PAN-2212). */
  reservedSwarmSlots: number;
  /** Overall ceiling for any auto-dispatch: work cap + reserved advancing slots. */
  totalCeiling: number;
  /** Whether operator-started agents are exempt from governor reaping (PAN-1812). */
  exemptOperatorStarted: boolean;
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
  const reservedSwarmSlots = normalizeCount(c?.reserved_swarm_slots, DEFAULT_RESERVED_SWARM_SLOTS, 0);
  return {
    maxWorkAgents,
    reservedAdvancingSlots,
    reservedSwarmSlots,
    totalCeiling: maxWorkAgents + reservedAdvancingSlots,
    exemptOperatorStarted: c?.exempt_operator_started ?? true,
  };
}

export interface RunningCounts {
  /** Regular work agents, EXCLUDING swarm slots (PAN-2212). */
  work: number;
  advancing: number;
  /** Swarm-slot work agents, counted apart from `work` (PAN-2212). */
  swarm: number;
  /** work + advancing (EXCLUDES swarm) — the ceiling every non-swarm dispatch consults. */
  total: number;
}

/**
 * Human-readable breakdown of what currently counts against the ceiling, for
 * deferral diagnostics (PAN-1716). Lists the offending session ids so a
 * starvation is diagnosable from the patrol log alone — the original livelock
 * (completed review/test sessions that never get reaped) is invisible from a
 * bare "ceiling reached" line.
 */
export function describeRunningAgents(): string {
  const alive = listRunningAgentsSync().filter(a => a.tmuxActive);
  const swarm = alive.filter(a => a.role === 'work' && SWARM_SLOT_ID.test(a.id)).map(a => a.id);
  const work = alive.filter(a => a.role === 'work' && !SWARM_SLOT_ID.test(a.id)).map(a => a.id);
  const advancing = alive.filter(a => a.role && ADVANCING_ROLES.has(a.role)).map(a => a.id);
  const { totalCeiling } = getConcurrencyLimits();
  return `counts: work=${work.length} advancing=${advancing.length} swarm=${swarm.length} total=${work.length + advancing.length}/${totalCeiling}`
    + ` | advancing=[${advancing.join(', ')}] work=[${work.join(', ')}] swarm=[${swarm.join(', ')}]`;
}

/** Count currently-running agents by role class.
 *
 * PAN-1908: the agents table is the authoritative runtime registry. Counts are
 * derived from status='running' rows grouped by role; the deacon's event-driven
 * updates keep status in sync with tmux liveness.
 */
/** Count tmux-alive swarm-slot work agents (agent-<issue>-slot-N) — PAN-2212. */
function countRunningSwarmSlots(): number {
  return listRunningAgentsSync().filter(
    a => a.tmuxActive && a.role === 'work' && SWARM_SLOT_ID.test(a.id),
  ).length;
}

export function countRunningAgents(): RunningCounts {
  const counts = countAgentsByStatus('running');
  const workTotal = counts['work'] ?? 0;
  let advancing = 0;
  for (const role of ADVANCING_ROLES) {
    advancing += counts[role] ?? 0;
  }
  // Swarm slots are work-role sessions but draw from the dedicated swarm reserve,
  // so subtract them from `work` (PAN-2212): the swarm neither starves nor is
  // starved by the work/advancing ceiling.
  const swarm = countRunningSwarmSlots();
  const work = Math.max(0, workTotal - swarm);
  return { work, advancing, swarm, total: work + advancing };
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
/** Dedicated per-patrol swarm-dispatch budget, isolated from advancing (PAN-2212). */
let swarmReservedThisPatrol = 0;

/** Reset the per-patrol dispatch budgets. Called once at patrol start. */
export function resetPatrolDispatchBudget(): void {
  advancingReservedThisPatrol = 0;
  swarmReservedThisPatrol = 0;
}

/**
 * Claim one advancing-role (review/test/ship) dispatch slot for this patrol.
 * Returns false when the total ceiling is reached — the caller must DEFER (leave
 * status untouched so a later patrol retries), never fail. Counts both tmux-alive
 * agents and advancing dispatches already reserved this patrol.
 */
export function tryReserveAdvancingSlot(
  counts: RunningCounts = countRunningAgents(),
  limits: ConcurrencyLimits = getConcurrencyLimits(),
): boolean {
  if (counts.total + advancingReservedThisPatrol >= limits.totalCeiling) return false;
  advancingReservedThisPatrol++;
  return true;
}

/** Release a same-patrol advancing reservation when dispatch was calmly gated. */
export function releaseAdvancingSlot(): void {
  advancingReservedThisPatrol = Math.max(0, advancingReservedThisPatrol - 1);
}

/**
 * Claim one swarm-slot dispatch for this patrol (PAN-2212). Gated ONLY on the
 * dedicated swarm reserve — never the work/advancing ceiling — so a busy pipeline
 * never starves the swarm. Returns false when the reserve is full; the caller
 * DEFERS (leave the item unclaimed so a later patrol retries), never fails.
 */
export function tryReserveSwarmSlot(
  counts: RunningCounts = countRunningAgents(),
  limits: ConcurrencyLimits = getConcurrencyLimits(),
): boolean {
  if (counts.swarm + swarmReservedThisPatrol >= limits.reservedSwarmSlots) return false;
  swarmReservedThisPatrol++;
  return true;
}

/** Release a same-patrol swarm reservation when dispatch was calmly gated. */
export function releaseSwarmSlot(): void {
  swarmReservedThisPatrol = Math.max(0, swarmReservedThisPatrol - 1);
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
  const { maxWorkAgents, exemptOperatorStarted } = getConcurrencyLimits();
  const runningWork = listRunningAgentsSync().filter(a => a.tmuxActive && a.role === 'work');
  const excess = runningWork.length - maxWorkAgents;
  if (excess <= 0) {
    return { before: runningWork.length, cap: maxWorkAgents, stopped: [], remaining: runningWork.length };
  }

  // PAN-1812: operator-started work agents (no flywheelRunId) are exempt from
  // automatic governor reaping when the config flag is enabled.
  const candidates = exemptOperatorStarted
    ? runningWork.filter(a => a.flywheelRunId !== undefined && a.flywheelRunId !== null && a.flywheelRunId !== '')
    : runningWork;

  // Stop the least-productive first: idle agents ahead of active ones, and among
  // equals the stalest (oldest lastActivity) first.
  const ordered = [...candidates].sort((a, b) => {
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
