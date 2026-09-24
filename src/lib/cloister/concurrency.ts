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

import { Effect } from 'effect';
import { loadCloisterConfigSync } from './config.js';
import {
  listRunningAgentsSync, listRunningAgents,
  stopAgentSync,
  getAgentRuntimeStateSync,
} from '../agents.js';
import { isIdle } from '../agents/liveness.js';
import { listLiveAgentIds } from '../terminal-backends/inventory.js';
import { isTerminalSwarmSlotAgent } from './swarm-slot-lifecycle.js';

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

/** Count currently-running agents by role class.
 *
 * PAN-1908: the agents table is the authoritative runtime registry. Counts are
 * derived from status='running' rows grouped by role; the deacon's event-driven
 * updates keep status in sync with tmux liveness.
 */
/** Count live swarm-slot work agents (agent-<issue>-slot-N) — PAN-2212. */
function countRunningSwarmSlots(
  agents: ReturnType<typeof listRunningAgentsSync>,
): { total: number; active: number } {
  const slots = agents.filter(a => a.role === 'work' && SWARM_SLOT_ID.test(a.id));
  return {
    total: slots.length,
    active: slots.filter(agent => !isTerminalSwarmSlotAgent(agent)).length,
  };
}

/**
 * Count tmux-ALIVE swarm-slot work agents for one issue (agent-<issue>-slot-N).
 * Stale agents-table rows whose tmux session is dead do NOT count — counting
 * them blocked all dispatch at zero live slots after a reset (PAN-2214).
 */
export function countRunningSwarmSlotsForIssue(
  issueId: string,
  agents: ReturnType<typeof listRunningAgentsSync> = listRunningAgentsSync(),
  isTerminalSlot: (agent: ReturnType<typeof listRunningAgentsSync>[number]) => boolean = isTerminalSwarmSlotAgent,
): number {
  const prefix = `agent-${issueId.toLowerCase()}-slot-`;
  return agents.filter(
    a => a.tmuxActive
      && a.role === 'work'
      && SWARM_SLOT_ID.test(a.id)
      && a.id.startsWith(prefix)
      && !isTerminalSlot(a),
  ).length;
}

/**
 * PAN-2579: count running advancing-role agents whose issue's phase verdict is
 * already terminal — "warm-idle" sessions kept alive for fast re-review under
 * the warm-by-default lifecycle. They are free capacity, not load: excluding
 * them from the ceiling is what lets warm sessions persist without recreating
 * the PAN-1716 livelock (completed reviewers starving every new dispatch).
 * PAN-3917: warm-idle used to mean "the stored verdict for this role is
 * terminal". It now means what it always described: the pane has stopped
 * working. `isIdle` is the same liveness oracle every other surface uses, so a
 * reviewer that finished (or a reviewer that was never busy) frees its slot
 * without anything needing to have written a verdict down first.
 */
function countWarmIdleAdvancingAgents(
  agents: ReturnType<typeof listRunningAgentsSync> = listRunningAgentsSync(),
): number {
  const advancingRows = agents.filter(a => a.role && ADVANCING_ROLES.has(a.role) && a.issueId);
  if (advancingRows.length === 0) return 0;
  let warmIdle = 0;
  for (const row of advancingRows) {
    if (isIdle(row.id)) warmIdle++;
  }
  return warmIdle;
}

/**
 * PAN-3917: this used to count rows in the overdeck.db mirror, which the boot
 * backfill reconciled against tmux. The mirror is gone and nothing corrects a
 * crashed agent's state file, so the ceiling would count stale `running` files
 * forever and starve dispatch — liveness has to come from somewhere live.
 *
 * That somewhere is the SELECTED terminal backend's inventory, not a tmux
 * census: under Herdr no agent has a tmux session, so a tmux census would
 * report the box empty and dispatch would never stop. An unreadable inventory
 * fails open (every `running` state file counts), because the ceiling's job is
 * to hold work back, and holding back on incomplete evidence is the safe side.
 */
export async function countRunningAgents(): Promise<RunningCounts> {
  const liveIds = await listLiveAgentIds();
  const live = (await Effect.runPromise(listRunningAgents())).filter(
    agent => agent.status === 'running' && (liveIds === null || liveIds.has(agent.id)),
  );
  const counts: Record<string, number> = {};
  for (const agent of live) {
    counts[agent.role] = (counts[agent.role] ?? 0) + 1;
  }
  const workTotal = counts['work'] ?? 0;
  let advancingTotal = 0;
  for (const role of ADVANCING_ROLES) {
    advancingTotal += counts[role] ?? 0;
  }
  // Swarm slots are work-role sessions but draw from the dedicated swarm reserve,
  // so subtract them from `work` (PAN-2212): the swarm neither starves nor is
  // starved by the work/advancing ceiling.
  const swarmSlots = countRunningSwarmSlots(live);
  const swarm = swarmSlots.active;
  const work = Math.max(0, workTotal - swarmSlots.total);
  // PAN-2579: warm-idle advancing sessions (verdict terminal, kept alive for the
  // next cycle) do not occupy the ceiling.
  const advancing = Math.max(0, advancingTotal - countWarmIdleAdvancingAgents(live));
  return { work, advancing, swarm, total: work + advancing };
}

// ---------------------------------------------------------------------------
// Swarm-dispatch reservation
//
// countRunningAgents() only sees live sessions. Slots dispatched earlier in the
// same pass haven't registered a session yet, so each dispatch reserves one
// here. Swarm dispatch runs from one-shot `pan swarm` processes, so the budget
// starts at zero with each run.
// ---------------------------------------------------------------------------
/** Dedicated swarm-dispatch budget, isolated from advancing (PAN-2212). */
let swarmReservedThisPatrol = 0;

/**
 * Reset the swarm-dispatch budget.
 *
 * Test seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8).
 */
export function resetPatrolDispatchBudget(): void {
  swarmReservedThisPatrol = 0;
}

/**
 * Claim one swarm-slot dispatch for this patrol (PAN-2212). Gated ONLY on the
 * dedicated swarm reserve — never the work/advancing ceiling — so a busy pipeline
 * never starves the swarm. Returns false when the reserve is full; the caller
 * DEFERS (leave the item unclaimed so a later patrol retries), never fails.
 */
export function tryReserveSwarmSlot(
  counts: RunningCounts,
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
      // 'system' cause (the default) leaves stoppedByUser unset so the deacon
      // re-admits this agent when a slot frees — the brake trims to the cap, it
      // does not retire the work.
      stopAgentSync(agent.id, 'system');
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
