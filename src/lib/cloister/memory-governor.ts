import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readProcMemory } from '../../dashboard/server/services/system-health-service.js';
import { loadConfigSync } from '../config-yaml/load.js';
import { loadCloisterConfigSync } from './config.js';
import { getDockerStatsCollector } from '../../dashboard/server/routes/resources/shared.js';
import { getResourceStacks, type ResourceStack, type StackContainerResource } from '../../dashboard/server/routes/resources/stacks.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { listRunningAgentsSync } from '../agents/queries.js';
import { getAgentRuntimeStateSync } from '../agents/runtime-state.js';
import { setAgentPausedSync, GOVERNOR_SLOT_PAUSE_REASON_PREFIX } from '../agents/agent-state.js';
import { stopAgentSync } from '../agents/termination.js';
import {
  getCachedMemoryVerdict,
  setCachedMemoryVerdict,
  type GovernorTrigger,
  type GovernorTriggerKind,
  type MemoryPressureBand,
  type MemoryPressureThresholds,
  type MemoryVerdict,
} from './memory-verdict-cache.js';

const execFileAsync = promisify(execFile);

const GIB = 1024 ** 3;

// Re-exported for backward compatibility — memory-verdict-cache.ts is now the
// canonical source (it must have no imports of its own to stay cycle-free).
export type { GovernorTrigger, GovernorTriggerKind, MemoryPressureBand, MemoryPressureThresholds, MemoryVerdict };
export { getCachedMemoryVerdict };

/**
 * Shared memory-pressure predicate — the single source of truth for both the
 * HTTP spawn path (evaluateSpawnGuardrails) and the deacon's autonomous
 * resume/dispatch path (PAN-2500). Never fork this comparison.
 *
 * This is the HTTP path's threshold pair (memoryWarnGb/memoryBlockGb, read
 * via the dashboard's getResourceConfig() cache) — stateless and unrelated to
 * the governor's own hysteresis bands below. evaluateSpawnGuardrails must stay
 * behavior-preserving, so this function is never touched by the governor.
 */
export function classifyMemoryPressure(
  availableBytes: number,
  thresholds: MemoryPressureThresholds,
): MemoryPressureBand {
  if (availableBytes < thresholds.criticalBytes) return 'hard';
  if (availableBytes < thresholds.warningBytes) return 'soft';
  return 'ok';
}

// --- PAN-2500 hysteresis-bands ---------------------------------------------
//
// The deacon governor uses its OWN three reserve thresholds (config-yaml
// resources.governor{Soft,Hard,Recovery}ReserveGb — NOT memoryWarnGb/
// memoryBlockGb, which belong to the unrelated HTTP-path predicate above) and
// a small state machine so it never oscillates: once below SOFT it holds
// (admits nothing new); once below HARD it sheds; it never re-admits until
// MemAvailable clears RECOVERY, which is always > SOFT.

export type GovernorMode = 'admitting' | 'holding' | 'shedding';

export interface GovernorReserves {
  softBytes: number;
  hardBytes: number;
  recoveryBytes: number;
}

export interface GovernorRunway {
  swapTotalBytes: number;
  swapFreeBytes: number;
  psiFullAvg10: number | null;
}

export interface GovernorRunwayThresholds {
  swapSoftFreePercent: number;
  swapRecoveryFreePercent: number;
  psiFullShedAvg10: number;
}

export interface GovernorPsiCalmConfig {
  readmitAvg10: number;
  windowMs: number;
}

let governorMode: GovernorMode = 'admitting';
let governorTrigger: GovernorTrigger | null = null;
let psiCalmSinceMs: number | null = null;

export interface GovernorTriggerSeed {
  kind: GovernorTriggerKind;
  readingBytes: number;
  thresholdBytes: number;
}

export interface GovernorTransition {
  mode: GovernorMode;
  trigger: GovernorTriggerSeed | null;
}

/** Test-only: reset the module-level hysteresis state between test cases. */
export function resetGovernorModeForTests(): void {
  governorMode = 'admitting';
  governorTrigger = null;
  psiCalmSinceMs = null;
  setCachedMemoryVerdict(null);
}

export function readGovernorReserves(): GovernorReserves {
  const resources = loadConfigSync().config.resources;
  return {
    softBytes: resources.governorSoftReserveGb * GIB,
    hardBytes: resources.governorHardReserveGb * GIB,
    recoveryBytes: resources.governorRecoveryReserveGb * GIB,
  };
}

/** PAN-3550: the activity-feed warn reserve, always above the SOFT reserve. */
export function readGovernorWatchReserveBytes(): number {
  return loadConfigSync().config.resources.governorWatchReserveGb * GIB;
}

export function readGovernorRunwayThresholds(): GovernorRunwayThresholds {
  const resources = loadConfigSync().config.resources;
  return {
    swapSoftFreePercent: resources.governorSwapSoftFreePercent,
    swapRecoveryFreePercent: resources.governorSwapRecoveryFreePercent,
    psiFullShedAvg10: resources.governorPsiFullShedAvg10,
  };
}

export function readGovernorPsiCalmConfig(): GovernorPsiCalmConfig {
  const resources = loadConfigSync().config.resources;
  return {
    readmitAvg10: resources.governorPsiCalmReadmitAvg10,
    windowMs: resources.governorPsiCalmWindowMs,
  };
}

/**
 * Pure hysteresis transition: given the current MemAvailable, the governor's
 * three reserves, and the previous mode, decide the next mode. RECOVERY only
 * re-admits from a held/shedding state; HARD sheds; between HARD and RECOVERY
 * a previously-admitting governor holds once it crosses SOFT, and a
 * previously-held/shedding governor never re-admits early (no oscillation).
 */
export function nextGovernorMode(
  availableBytes: number,
  reserves: GovernorReserves,
  previousMode: GovernorMode,
): GovernorMode {
  if (availableBytes >= reserves.recoveryBytes) return 'admitting';
  if (availableBytes < reserves.hardBytes) return 'shedding';
  if (previousMode === 'admitting') {
    return availableBytes < reserves.softBytes ? 'holding' : 'admitting';
  }
  return 'holding';
}

export function nextGovernorModeWithRunway(
  availableBytes: number,
  reserves: GovernorReserves,
  runway: GovernorRunway,
  runwayThresholds: GovernorRunwayThresholds,
  previousMode: GovernorMode,
): GovernorTransition {
  const memoryMode = nextGovernorMode(availableBytes, reserves, previousMode);
  const memoryTrigger: GovernorTriggerSeed | null = availableBytes < reserves.hardBytes
    ? { kind: 'hard', readingBytes: availableBytes, thresholdBytes: reserves.hardBytes }
    : previousMode === 'admitting' && memoryMode === 'holding'
      ? { kind: 'soft-dip', readingBytes: availableBytes, thresholdBytes: reserves.softBytes }
      : null;
  if (runway.swapTotalBytes <= 0) return { mode: memoryMode, trigger: memoryTrigger };

  const swapSoftBytes = runway.swapTotalBytes * runwayThresholds.swapSoftFreePercent / 100;
  const swapRecoveryBytes = runway.swapTotalBytes * runwayThresholds.swapRecoveryFreePercent / 100;
  const activeSwapThresholdBytes = previousMode === 'admitting' ? swapSoftBytes : swapRecoveryBytes;
  const swapLow = runway.swapFreeBytes < activeSwapThresholdBytes;
  const psiShed = swapLow
    && runway.psiFullAvg10 != null
    && runway.psiFullAvg10 >= runwayThresholds.psiFullShedAvg10;

  if (memoryMode === 'shedding') return { mode: 'shedding', trigger: memoryTrigger };
  if (psiShed) {
    return {
      mode: 'shedding',
      trigger: { kind: 'swap-psi', readingBytes: runway.swapFreeBytes, thresholdBytes: activeSwapThresholdBytes },
    };
  }
  // Operator-approved correction (PAN-3485 follow-up, 2026-08-02): swap
  // RESIDENCY is not pressure. Pages swapped during a leak era sit idle for
  // weeks while PSI pins at 0.00 — and holding admissions for them wedges the
  // entire pipeline (sweeper re-drives, yield-unpauses, resume gates all
  // deferred for weeks on this host). Low swap now matters only with live
  // stall evidence: PSI at/above the shed threshold sheds above; below it we
  // admit. When PSI is UNAVAILABLE we cannot prove safety, so the
  // conservative hold (with its swap-recovery hysteresis) still stands.
  if (swapLow && runway.psiFullAvg10 == null) {
    return {
      mode: 'holding',
      trigger: { kind: 'psi-unavailable', readingBytes: runway.swapFreeBytes, thresholdBytes: activeSwapThresholdBytes },
    };
  }
  return { mode: memoryMode, trigger: memoryTrigger };
}

function bandForGovernorMode(mode: GovernorMode): MemoryPressureBand {
  if (mode === 'shedding') return 'hard';
  if (mode === 'holding') return 'soft';
  return 'ok';
}

/**
 * Read live MemAvailable via the existing async /proc parser and run it
 * through the governor's hysteresis state machine. `band` mirrors the mode
 * ('admitting'->'ok', 'holding'->'soft', 'shedding'->'hard') so existing
 * consumers (wire-deacon-gate) are unaffected by the upgrade from the
 * mem-governor-module placeholder thresholds to these dedicated reserves.
 */
export async function assessMemoryPressure(): Promise<MemoryVerdict> {
  const reserves = readGovernorReserves();
  const runwayThresholds = readGovernorRunwayThresholds();
  const psiCalmConfig = readGovernorPsiCalmConfig();
  const snapshot = await readProcMemory();
  const now = Date.now();
  const psiIsCalm = snapshot.psiFullAvg10 != null
    && snapshot.psiFullAvg10 < psiCalmConfig.readmitAvg10;
  const previousMode = governorMode;
  const transition = nextGovernorModeWithRunway(
    snapshot.memAvailable,
    reserves,
    {
      swapTotalBytes: snapshot.swapTotal,
      swapFreeBytes: snapshot.swapFree,
      psiFullAvg10: snapshot.psiFullAvg10,
    },
    runwayThresholds,
    governorMode,
  );
  governorMode = transition.mode;
  const triggerKindChanged = transition.trigger != null
    && transition.trigger.kind !== governorTrigger?.kind;
  const pressureStateChanged = governorMode !== 'admitting'
    && (previousMode !== governorMode || triggerKindChanged);
  if (governorMode === 'admitting') {
    governorTrigger = null;
  } else if (
    transition.trigger
    && (previousMode === 'admitting' || transition.trigger.kind !== governorTrigger?.kind)
  ) {
    governorTrigger = { ...transition.trigger, at: now };
  }
  if (governorMode === 'admitting') {
    psiCalmSinceMs = null;
  } else if (pressureStateChanged) {
    psiCalmSinceMs = psiIsCalm ? now : null;
  } else if (psiIsCalm) {
    psiCalmSinceMs ??= now;
  } else {
    psiCalmSinceMs = null;
  }
  if (
    governorMode === 'holding'
    && psiCalmSinceMs != null
    && now - psiCalmSinceMs >= psiCalmConfig.windowMs
    && snapshot.memAvailable >= reserves.softBytes
  ) {
    governorMode = 'admitting';
    governorTrigger = null;
    psiCalmSinceMs = null;
  }
  const verdict: MemoryVerdict = {
    band: bandForGovernorMode(governorMode),
    availableBytes: snapshot.memAvailable,
    thresholds: { warningBytes: reserves.softBytes, criticalBytes: reserves.hardBytes },
    swapTotalBytes: snapshot.swapTotal,
    swapFreeBytes: snapshot.swapFree,
    psiSomeAvg10: snapshot.psiSomeAvg10,
    psiFullAvg10: snapshot.psiFullAvg10,
    trigger: governorTrigger,
  };
  setCachedMemoryVerdict(verdict);
  return verdict;
}

// --- PAN-2500 footprint-budget ----------------------------------------------
//
// Gigabyte-budget admission: estimate the footprint an about-to-be-admitted
// agent will hold, and admit only if it fits under the SOFT reserve. The
// docker-stack RSS (#2464 attribution, reused via getResourceStacks) is the
// learned signal — reused across agents in the same project, since a new
// agent's own stack doesn't exist yet to measure. A configured per-role
// cold-start default (NFR-3: no inline literal) covers the case where no
// live stack exists yet for the project.

export type FootprintRole = 'work' | 'review' | 'test';

function coldStartFootprintBytes(role: FootprintRole): number {
  const resources = loadConfigSync().config.resources;
  const gb =
    role === 'work' ? resources.governorFootprintDefaultWorkGb
    : role === 'review' ? resources.governorFootprintDefaultReviewGb
    : resources.governorFootprintDefaultTestGb;
  return gb * GIB;
}

/**
 * Pure core of estimateFootprint — takes already-fetched stacks so it's
 * testable with a stubbed docker-stats map (no live collector needed).
 * Returns the average live memoryBytes across the project's current stacks,
 * or null when no stack exists yet for that project (cold start).
 */
export function computeLearnedFootprintBytes(stacks: readonly ResourceStack[], projectKey: string): number | null {
  const projectStacks = stacks.filter((stack) => {
    if (!stack.issueId) return false;
    return resolveProjectFromIssueSync(stack.issueId)?.projectKey === projectKey;
  });
  if (projectStacks.length === 0) return null;
  const total = projectStacks.reduce((sum, stack) => sum + stack.aggregates.memoryBytes, 0);
  const average = total / projectStacks.length;
  return average > 0 ? average : null;
}

/**
 * Estimate the footprint (bytes) of an agent about to be admitted for `role`
 * in `projectKey`: the learned average live stack RSS for that project when
 * any of its stacks are currently running, else the configured per-role
 * cold-start default.
 */
export async function estimateFootprint(role: FootprintRole, projectKey: string): Promise<number> {
  const containers = getDockerStatsCollector().getStats() as unknown as StackContainerResource[];
  const stacks = getResourceStacks(containers);
  const learned = computeLearnedFootprintBytes(stacks, projectKey);
  return learned ?? coldStartFootprintBytes(role);
}

/**
 * Admission predicate (PRD AC-3, pinned public shape — specialist-budget,
 * tiered-eviction, and memory-paced-boot all call this exact signature):
 * fits only if the footprint leaves the SOFT reserve intact.
 */
export function canAdmit(footprintBytes: number, availableBytes: number): boolean {
  return footprintBytes <= availableBytes - readGovernorReserves().softBytes;
}

// --- PAN-2500 tiered-eviction ------------------------------------------------
//
// shed() runs under HARD pressure, reclaiming cheapest-value-first: merged/
// closed docker stacks (pure reclaim, no running work lost) before pausing an
// idle work agent (frees claude RSS, resumable via --resume once RECOVERY is
// crossed). Never an operator-attached agent or a core service. Never
// `docker pause` to reclaim RAM (retains RSS) — only `docker stop`.

export interface ShedResult {
  stoppedStacks: string[];
  pausedAgents: string[];
}

interface ShedCandidateAgent {
  id: string;
  issueId: string;
  flywheelRunId?: string | null;
}

export interface ShedAgentLike {
  issueId?: string | null;
  hasLiveTmuxSession?: boolean;
}

/**
 * Pure core: which merged/closed stacks are safe to stop.
 *
 * This mirrors reclaim.ts's isClosedStack (stack.phase === 'merged') + live-
 * issue exclusion exactly, rather than importing buildReclaimPayload directly:
 * the root tsconfig.json excludes src/dashboard/**, so any import from
 * reclaim.ts pulls its unrelated deleteResourceVenvEffect (a pre-existing,
 * out-of-scope HttpRouter.schemaParams type error under the ROOT tsconfig's
 * effect resolution — that route typechecks fine under the dashboard's own
 * tsconfig/node_modules) into this module's compilation graph and breaks the
 * build. Keep this predicate in sync with reclaim.ts's isClosedStack if that
 * definition ever changes.
 */
export function selectStackShedCandidates(
  stacks: readonly ResourceStack[],
  runningAgents: readonly ShedAgentLike[],
): ResourceStack[] {
  const liveIssueIds = new Set(
    runningAgents
      .filter((agent) => agent.hasLiveTmuxSession === true)
      .map((agent) => agent.issueId?.toUpperCase())
      .filter((issueId): issueId is string => Boolean(issueId)),
  );
  return stacks.filter(
    (stack) => stack.issueId && stack.phase === 'merged' && !liveIssueIds.has(stack.issueId.toUpperCase()),
  );
}

/**
 * Pure core: the next idle work agent to pause, exempting operator-started
 * agents (PAN-1812, mirrors emergencyBrake's exemption in concurrency.ts —
 * duplicated rather than imported to avoid a memory-governor <-> concurrency
 * circular import) and any agent not in an 'idle' runtime state.
 */
export function selectAgentToPause(
  candidates: readonly ShedCandidateAgent[],
  isIdle: (agentId: string) => boolean,
  exemptOperatorStarted: boolean,
): ShedCandidateAgent | null {
  const eligible = exemptOperatorStarted
    ? candidates.filter((a) => a.flywheelRunId !== undefined && a.flywheelRunId !== null && a.flywheelRunId !== '')
    : candidates;
  return eligible.find((a) => isIdle(a.id)) ?? null;
}

async function stopStackContainers(stack: ResourceStack): Promise<void> {
  for (const service of stack.services) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(service.id)) continue;
    try {
      await execFileAsync('docker', ['stop', '--time', '30', service.id], { encoding: 'utf-8', timeout: 35000 });
    } catch {
      // Best effort — a container already stopped or gone is not a shed failure.
    }
  }
}

/**
 * Reclaim under HARD pressure. Stops ALL merged/closed stacks unconditionally
 * (pure reclaim, cheap), then — only if still HARD afterward — pauses idle
 * work agents one at a time, re-checking memory pressure after each pause,
 * until it clears HARD or no eligible idle agent remains.
 */
export async function shed(): Promise<ShedResult> {
  const result: ShedResult = { stoppedStacks: [], pausedAgents: [] };

  const containers = getDockerStatsCollector().getStats() as unknown as StackContainerResource[];
  const stacks = getResourceStacks(containers);
  const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
  const agentsLike: ShedAgentLike[] = runningAgents.map((a) => ({ issueId: a.issueId, hasLiveTmuxSession: a.tmuxActive }));

  for (const stack of selectStackShedCandidates(stacks, agentsLike)) {
    await stopStackContainers(stack);
    if (stack.issueId) result.stoppedStacks.push(stack.issueId);
  }

  let verdict = await assessMemoryPressure();
  if (verdict.band !== 'hard') return result;

  // PAN-2579: warm-idle advancing sessions (review/test/ship with a recorded
  // terminal verdict, kept alive for fast re-review) are the cheapest agent shed —
  // killing one loses no state (the next dispatch resumes the saved session with
  // its context) while an active work agent's pause loses momentum. Shed them
  // before touching any work agent. This shed — plus a reboot — is the ONLY
  // sanctioned way a warm session dies (see docs/ROLES.md warm-by-default policy).
  try {
    const { loadReviewStatuses } = await import('../review-status.js');
    const { listSessionNames, killSession } = await import('../tmux.js');
    const { selectNonMergedTerminalAdvancingSessions } = await import('./reap-terminal-sessions.js');
    const { markAdvancingSessionStopped } = await import('./advancing-selfheal.js');
    const { Effect } = await import('effect');
    const aliveSessions = await Effect.runPromise(listSessionNames());
    const warmIdle = selectNonMergedTerminalAdvancingSessions(loadReviewStatuses(), [...aliveSessions]);
    for (const session of warmIdle) {
      if (verdict.band !== 'hard') break;
      try {
        await Effect.runPromise(killSession(session));
        markAdvancingSessionStopped(session);
        result.pausedAgents.push(session);
        console.log(`[memory-governor] Shed warm-idle advancing session ${session} under HARD pressure (PAN-2579; resumable with context)`);
      } catch (err) {
        console.warn(`[memory-governor] Failed to shed warm-idle session ${session}: ${err instanceof Error ? err.message : String(err)}`);
      }
      verdict = await assessMemoryPressure();
    }
  } catch (err) {
    console.warn(`[memory-governor] Warm-idle shed step failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (verdict.band !== 'hard') return result;

  const exemptOperatorStarted = loadCloisterConfigSync().concurrency?.exempt_operator_started;
  const workAgents: ShedCandidateAgent[] = runningAgents
    .filter((a) => a.role === 'work')
    .map((a) => ({ id: a.id, issueId: a.issueId, flywheelRunId: a.flywheelRunId }));
  const paused = new Set<string>();

  while (verdict.band === 'hard') {
    const next = selectAgentToPause(
      workAgents.filter((a) => !paused.has(a.id)),
      (agentId) => getAgentRuntimeStateSync(agentId)?.state === 'idle',
      exemptOperatorStarted ?? true,
    );
    if (!next) break;
    setAgentPausedSync(next.id, `${GOVERNOR_SLOT_PAUSE_REASON_PREFIX} memory pressure — shed under HARD reserve`, true);
    stopAgentSync(next.id);
    paused.add(next.id);
    result.pausedAgents.push(next.id);
    verdict = await assessMemoryPressure();
  }

  return result;
}
