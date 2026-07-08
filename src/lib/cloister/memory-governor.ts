import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { loadConfigSync } from '../config-yaml/load.js';
import { loadCloisterConfigSync } from './config.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { listRunningAgentsSync } from '../agents/queries.js';
import { getAgentRuntimeStateSync } from '../agents/runtime-state.js';
import { setAgentPausedSync, GOVERNOR_SLOT_PAUSE_REASON_PREFIX } from '../agents/agent-state.js';
import { stopAgentSync } from '../agents/termination.js';
import { DockerStatsCollector, type ContainerStats } from '../docker-stats.js';
import { readProcMemory } from '../proc-memory.js';

const execFileAsync = promisify(execFile);

const GIB = 1024 ** 3;
let dockerStatsCollector: DockerStatsCollector | null = null;

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
let cachedVerdict: MemoryVerdict | null = null;

/** Test-only: reset the module-level hysteresis state between test cases. */
export function resetGovernorModeForTests(): void {
  governorMode = 'admitting';
  cachedVerdict = null;
}

/**
 * The verdict from the most recent assessMemoryPressure() call, or null before
 * any patrol has run one. Synchronous — no I/O — so synchronous call sites
 * (PAN-2500 specialist-budget: canDispatchAdvancing/tryReserveAdvancingSlot in
 * concurrency.ts, called from many places across deacon.ts/deacon-review-status.ts)
 * can consult live-ish memory pressure without becoming async themselves. At
 * most one patrol cycle stale; wire-deacon-gate already calls
 * assessMemoryPressure every patrol before advancing dispatch runs.
 */
export function getCachedMemoryVerdict(): MemoryVerdict | null {
  return cachedVerdict;
}

/** Test-only. */
export function setCachedMemoryVerdictForTests(verdict: MemoryVerdict | null): void {
  cachedVerdict = verdict;
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
  const memAvailable = (await readProcMemory()).memAvailable;
  governorMode = nextGovernorMode(memAvailable, reserves, governorMode);
  const verdict: MemoryVerdict = {
    band: bandForGovernorMode(governorMode),
    availableBytes: memAvailable,
    thresholds: { warningBytes: reserves.softBytes, criticalBytes: reserves.hardBytes },
  };
  cachedVerdict = verdict;
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

export interface StackContainerResource {
  id: string;
  name: string;
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  diskUsage?: number;
  status?: string;
  labels?: Record<string, string>;
}

export interface ResourceStack {
  id: string;
  issueId: string | null;
  issueTitle: string;
  composeProject: string;
  serviceCount: number;
  services: StackContainerResource[];
  aggregates: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  phase: 'merged' | 'work' | 'todo';
}

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

function getMemoryGovernorDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    Effect.runFork(
      dockerStatsCollector.start().pipe(Effect.provide(nodeServicesLayer)),
    );
  }
  return dockerStatsCollector;
}

function composeProjectFor(container: StackContainerResource): string | null {
  const labelProject = container.labels?.['com.docker.compose.project']?.trim();
  if (labelProject) return labelProject;

  const issueProject = container.name.match(/^(.+?feature[-_](?:pan|min|aur|krux)[-_]?\d+)/i);
  if (issueProject?.[1]) return issueProject[1];

  const match = container.name.match(/^(.+?)[_-][a-z0-9]+[._-][0-9]+$/i);
  return match?.[1] ?? null;
}

function issueIdFromText(value: string): string | null {
  const match = value.match(/(?:workspaces[\\/])?feature[-_](pan|min|aur|krux)[-_]?(\d+)/i)
    ?? value.match(/\b(pan|min|aur|krux)[-_]?(\d+)\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function issueIdFor(composeProject: string, services: StackContainerResource[]): string | null {
  if (composeProject === 'unassigned') return null;
  const fromProject = issueIdFromText(composeProject);
  if (fromProject) return fromProject;

  for (const service of services) {
    const labelText = Object.values(service.labels ?? {}).join(' ');
    const fromLabels = issueIdFromText(labelText);
    if (fromLabels) return fromLabels;
  }

  return null;
}

function phaseForServices(services: StackContainerResource[]): ResourceStack['phase'] {
  return services.some((service) => service.labels?.['overdeck.phase'] === 'merged') ? 'merged' : 'todo';
}

export function buildMemoryGovernorResourceStacks(containers: StackContainerResource[]): ResourceStack[] {
  const groups = new Map<string, StackContainerResource[]>();
  for (const container of containers) {
    const key = composeProjectFor(container) ?? 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }

  return [...groups.entries()].map(([composeProject, services]) => {
    const issueId = issueIdFor(composeProject, services);
    return {
      id: issueId ?? composeProject,
      issueId,
      issueTitle: issueId ?? 'Unassigned',
      composeProject,
      serviceCount: services.length,
      services,
      aggregates: {
        cpuPercent: Math.round(services.reduce((sum, service) => sum + (service.cpuPercent ?? 0), 0) * 10) / 10,
        memoryBytes: services.reduce((sum, service) => sum + (service.memoryUsage ?? 0), 0),
        diskBytes: services.reduce((sum, service) => sum + (service.diskUsage ?? 0), 0),
      },
      phase: phaseForServices(services),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function readResourceStacks(): ResourceStack[] {
  const containers = getMemoryGovernorDockerStatsCollector().getStats() as ContainerStats[];
  return buildMemoryGovernorResourceStacks(containers);
}

/**
 * Estimate the footprint (bytes) of an agent about to be admitted for `role`
 * in `projectKey`: the learned average live stack RSS for that project when
 * any of its stacks are currently running, else the configured per-role
 * cold-start default.
 */
export async function estimateFootprint(role: FootprintRole, projectKey: string): Promise<number> {
  const stacks = readResourceStacks();
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

  const stacks = readResourceStacks();
  const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
  const agentsLike: ShedAgentLike[] = runningAgents.map((a) => ({ issueId: a.issueId, hasLiveTmuxSession: a.tmuxActive }));

  for (const stack of selectStackShedCandidates(stacks, agentsLike)) {
    await stopStackContainers(stack);
    if (stack.issueId) result.stoppedStacks.push(stack.issueId);
  }

  let verdict = await assessMemoryPressure();
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
