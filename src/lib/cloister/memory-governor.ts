import { readProcMemory } from '../../dashboard/server/services/system-health-service.js';
import { loadConfigSync } from '../config-yaml/load.js';
import { getDockerStatsCollector } from '../../dashboard/server/routes/resources/shared.js';
import { getResourceStacks, type ResourceStack, type StackContainerResource } from '../../dashboard/server/routes/resources/stacks.js';
import { resolveProjectFromIssueSync } from '../projects.js';

const GIB = 1024 ** 3;

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';

export interface MemoryPressureThresholds {
  warningBytes: number;
  criticalBytes: number;
}

export interface MemoryVerdict {
  band: MemoryPressureBand;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
}

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

let governorMode: GovernorMode = 'admitting';

/** Test-only: reset the module-level hysteresis state between test cases. */
export function resetGovernorModeForTests(): void {
  governorMode = 'admitting';
}

export function readGovernorReserves(): GovernorReserves {
  const resources = loadConfigSync().config.resources;
  return {
    softBytes: resources.governorSoftReserveGb * GIB,
    hardBytes: resources.governorHardReserveGb * GIB,
    recoveryBytes: resources.governorRecoveryReserveGb * GIB,
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
  const snapshot = await readProcMemory();
  governorMode = nextGovernorMode(snapshot.memAvailable, reserves, governorMode);
  return {
    band: bandForGovernorMode(governorMode),
    availableBytes: snapshot.memAvailable,
    thresholds: { warningBytes: reserves.softBytes, criticalBytes: reserves.hardBytes },
  };
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
