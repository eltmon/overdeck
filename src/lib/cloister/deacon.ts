/**
 * Cloister Deacon - Health Monitor for Specialist Agents
 *
 * The Deacon is a health-check system that:
 * - Actively pings specialists to verify they're responsive
 * - Tracks consecutive failures per specialist
 * - Force-kills stuck specialists after threshold failures
 * - Enforces cooldown periods after force-kills
 * - Detects mass death events (infrastructure issues)
 *
 * Inspired by gastown's deacon pattern.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
// PAN-1249: readFile / writeFile / unlink are consumed by the additive Effect
// helpers below (`readFileOp`, `writeFileOp`, `unlinkPath`).
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { homedir, loadavg, cpus } from 'os';
import { Effect } from 'effect';
import {
  FsError,
  GitError,
  ProcessSpawnError,
  ProcessTimeoutError,
} from '../errors.js';
import { isStartingWithinGrace } from './agent-grace.js';
import { recordDeaconNudge } from './deacon-nudge-log.js';
import { listAllAgentsSync as listAllAgents } from '../overdeck/agents.js';
import { isContextOverflowTail } from '../context-overflow.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// PAN-1249 Effect helpers (additive — internal use only)
// ---------------------------------------------------------------------------

/**
 * Wrap an `execAsync` call in Effect with a typed `ProcessSpawnError`. Used
 * internally so callers can keep their Promise-returning signatures while the
 * implementation drifts towards Effect.
 */
const execCommand = (
  command: string,
  options?: Parameters<typeof execAsync>[1],
): Effect.Effect<{ stdout: string; stderr: string }, ProcessSpawnError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await execAsync(command, options);
      return {
        stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf-8'),
        stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr.toString('utf-8'),
      };
    },
    catch: (cause) =>
      new ProcessSpawnError({
        command,
        args: [],
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Wrap `execFileAsync` in Effect with a typed error. */
const execFileCommand = (
  command: string,
  args: readonly string[],
  options?: Parameters<typeof execFileAsync>[2],
): Effect.Effect<{ stdout: string; stderr: string }, ProcessSpawnError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await execFileAsync(command, args as string[], options);
      return {
        stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf-8'),
        stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr.toString('utf-8'),
      };
    },
    catch: (cause) =>
      new ProcessSpawnError({
        command,
        args,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Wrap a fs/promises read in Effect with a typed FsError. */
const readFileOp = (path: string): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => readFile(path, 'utf-8'),
    catch: (cause) =>
      new FsError({
        path,
        operation: 'readFile',
        cause,
      }),
  });

/** Wrap a fs/promises write in Effect with a typed FsError. */
const writeFileOp = (path: string, data: string): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => writeFile(path, data, 'utf-8'),
    catch: (cause) =>
      new FsError({
        path,
        operation: 'writeFile',
        cause,
      }),
  });

/** Wrap a fs/promises unlink in Effect with a typed FsError. */
const unlinkPath = (path: string): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => unlink(path),
    catch: (cause) =>
      new FsError({
        path,
        operation: 'unlink',
        cause,
      }),
  });

/** Re-exported for symmetry with the additive pattern in the rest of src/lib. */
export { GitError, ProcessTimeoutError };

import { OVERDECK_HOME, AGENTS_DIR, sessionFilePath } from '../paths.js';
import { loadCloisterConfigSync, loadCloisterConfig } from './config.js';
import { workResumeSlotsAvailable, getConcurrencyLimits, countRunningAgents, resetPatrolDispatchBudget, tryReserveAdvancingSlot, releaseAdvancingSlot, describeRunningAgents } from './concurrency.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { setReviewStatusSync, loadReviewStatuses, getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { markWorkspaceStuck } from '../overdeck/review-status-sync.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { resolveProjectFromIssueSync, listProjectsSync, getProjectSync } from '../projects.js';
import { queueBeadsAutoCommit } from '../pan-dir/auto-commit.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { mapGitHubStateToCanonical } from '../../core/state-mapping.js';
import { logDeaconEventSync, logAgentLifecycleSync } from '../persistent-logger.js';
import { emitActivityTtsSync } from '../activity-logger.js';
import { getShadowState } from '../shadow-state.js';
import type { TrackerConfig } from '../tracker/factory.js';

// Review status file location (same as dashboard server)

import {
  SpecialistAgentName,
  getTmuxSessionName,
  isRunning,
  getAllProjectSpecialistStatuses,
  parseReviewerSessionName,
} from './specialists.js';
import { getAgentRuntimeStateSync, saveAgentRuntimeState, saveSessionId, listRunningAgentsSync, listRunningAgents, listAgentStates, getAgentDir, getAgentStateSync, getAgentState, saveAgentStateSync, saveAgentState, resumeAgent, recordAgentFailure, resetAgentFailureCount, markAgentRunningState, buildDefaultResumeContinueMessage, type AgentState } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { buildTmuxCommandString, capturePane, createSession, isPaneDead, killSessionSync, killSession, listPaneValuesSync, listPaneValues, listSessionNames, sessionExistsSync, sessionExists, sendKeys } from '../tmux.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import { checkStuckAgentRemediation } from './stuck-remediation.js';
import { captureTranscriptUserRecordSnapshot } from '../transcript-landing.js';
import { reconcileClosedIssueAgents } from './closed-issue-reaper.js';
import { reconcileOrphanProposedSpecs } from './orphan-proposed-reconciler.js';
import { reconcileTestStatusFromGreenCiWithDeps } from './test-status-green-ci-reconciler.js';
import { reapOrphanedDashboardServers } from './orphan-dashboard-server-reaper.js';
import { reconcileIdleWorkspaceStacks } from './idle-stack-reaper.js';
import { reapLeftoverPlaywrightBrowsers } from './playwright-mcp-reaper.js';
import { reapMergedStrikeWorkspaces } from './strike-workspace-reaper.js';
import { cleanupOrphanedInspectSessions } from './inspect-session-reaper.js';
import { isIssueClosed } from './issue-closed.js';
import { decideUnsignaledTestAction, readTestVerdictArtifact } from './test-verdict.js';
import { deliverReviewVerdictFeedback } from './review-verdict-feedback.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default parameters for stuck-session detection.
 * Per gastown: "Let agents decide thresholds. 'Stuck' is a judgment call."
 */
const DEFAULT_CONFIG: DeaconConfig = {
  pingTimeoutMs: 30_000,           // How long to wait for response
  consecutiveFailures: 3,          // Failures before force-kill
  cooldownMs: 5 * 60_000,          // 5 minutes between force-kills
  patrolIntervalMs: 60_000,        // Safety net — immediate processing happens via pipeline events
  massDeathThreshold: 2,           // Deaths within window triggers alert
  massDeathWindowMs: 60_000,       // 1 minute window for mass death detection
};

export interface DeaconConfig {
  pingTimeoutMs: number;
  consecutiveFailures: number;
  cooldownMs: number;
  patrolIntervalMs: number;
  massDeathThreshold: number;
  massDeathWindowMs: number;
}

// ============================================================================
// Health State Types
// ============================================================================

/**
 * Health check state for a single specialist
 */
export interface SpecialistHealthState {
  specialistName: SpecialistAgentName;
  lastPingTime?: string;         // ISO 8601
  lastResponseTime?: string;     // ISO 8601
  consecutiveFailures: number;
  lastForceKillTime?: string;    // ISO 8601
  forceKillCount: number;
}

/**
 * PAN-464: Tracks restart history for a workspace container.
 */
export interface ContainerRestartRecord {
  count: number;          // Total restart attempts
  firstRestart: string;   // ISO 8601 — when the first restart in the current burst happened
  lastRestart: string;    // ISO 8601 — when the most recent restart happened
  gaveUp?: boolean;       // True when max restarts exceeded — skip future auto-restarts
}

/**
 * Complete health check state for all specialists
 */
export interface DeaconState {
  specialists: Record<SpecialistAgentName, SpecialistHealthState>;
  lastPatrol?: string;           // ISO 8601
  patrolCycle: number;
  recentDeaths: string[];        // ISO timestamps of recent deaths
  lastMassDeathAlert?: string;   // ISO 8601
  mergeStuckAttempts?: Record<string, number>;  // circuit-breaker attempt counts (PAN-344)
  containerRestarts?: Record<string, ContainerRestartRecord>;  // PAN-464: restart backoff tracking
}

export type DeaconPatrolHealth = 'running' | 'starting' | 'stale' | 'stopped';

export interface DeaconPatrolFreshness {
  status: DeaconPatrolHealth;
  lastPatrol: string | null;
  secondsSinceLastPatrol: number | null;
  staleAfterSeconds: number;
}

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  specialistName: SpecialistAgentName;
  isResponsive: boolean;
  responseTimeMs?: number;
  consecutiveFailures: number;
  shouldForceKill: boolean;
  inCooldown: boolean;
  cooldownRemainingMs?: number;
  wasRunning: boolean;
  error?: string;
}

// ============================================================================
// State Management
// ============================================================================

const DEACON_DIR = join(OVERDECK_HOME, 'deacon');
const STATE_FILE = join(DEACON_DIR, 'health-state.json');
const CONFIG_FILE = join(DEACON_DIR, 'config.json');

let deaconInterval: NodeJS.Timeout | null = null;
let config: DeaconConfig = { ...DEFAULT_CONFIG };

/**
 * Load deacon configuration
 */
export function loadConfig(): DeaconConfig {
  config = { ...DEFAULT_CONFIG };

  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const loaded = JSON.parse(content);
      config = { ...config, ...loaded };
    }
  } catch (error) {
    console.error('[deacon] Failed to load config:', error);
  }

  return config;
}

/**
 * Save deacon configuration
 */
export function saveConfig(newConfig: Partial<DeaconConfig>): void {
  ensureDeaconDir();
  config = { ...config, ...newConfig };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Ensure deacon directory exists
 */
function ensureDeaconDir(): void {
  if (!existsSync(DEACON_DIR)) {
    mkdirSync(DEACON_DIR, { recursive: true });
  }
}

/**
 * Load health check state from disk
 */
export function loadState(): DeaconState {
  ensureDeaconDir();

  try {
    if (existsSync(STATE_FILE)) {
      const content = readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[deacon] Failed to load state:', error);
  }

  // Return empty state
  return {
    specialists: {} as Record<SpecialistAgentName, SpecialistHealthState>,
    patrolCycle: 0,
    recentDeaths: [],
  };
}

/**
 * Save health check state to disk
 */
export function saveState(state: DeaconState): void {
  ensureDeaconDir();

  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('[deacon] Failed to save state:', error);
  }
}

/**
 * Clear the persisted patrol heartbeat at dashboard startup so the supervisor
 * watchdog gives the first deacon patrol its normal startup grace window.
 */
export function resetPatrolHeartbeatForStartup(): void {
  try {
    if (!existsSync(STATE_FILE)) return;

    const state = loadState();
    delete state.lastPatrol;
    saveState(state);
  } catch {
    // Non-fatal: worst case the watchdog still sees the stale heartbeat.
  }
}

/**
 * Get health state for a specialist, creating if needed
 */
function getSpecialistState(
  state: DeaconState,
  name: SpecialistAgentName
): SpecialistHealthState {
  if (!state.specialists[name]) {
    state.specialists[name] = {
      specialistName: name,
      consecutiveFailures: 0,
      forceKillCount: 0,
    };
  }
  return state.specialists[name];
}

// ============================================================================
// Health Check Logic
// ============================================================================

/**
 * Check if a specialist is in cooldown period
 */
function isInCooldown(healthState: SpecialistHealthState): boolean {
  if (!healthState.lastForceKillTime) {
    return false;
  }

  const lastKill = new Date(healthState.lastForceKillTime).getTime();
  const cooldownEnd = lastKill + config.cooldownMs;
  return Date.now() < cooldownEnd;
}

/**
 * Get remaining cooldown time in ms
 */
function getCooldownRemaining(healthState: SpecialistHealthState): number {
  if (!healthState.lastForceKillTime) {
    return 0;
  }

  const lastKill = new Date(healthState.lastForceKillTime).getTime();
  const cooldownEnd = lastKill + config.cooldownMs;
  const remaining = cooldownEnd - Date.now();
  return Math.max(0, remaining);
}

/**
 * Check if a specialist is responsive by reading their heartbeat
 */
function checkHeartbeat(name: SpecialistAgentName): {
  isResponsive: boolean;
  lastActivity?: number;
  responseTimeMs?: number;
} {
  const tmuxSession = getTmuxSessionName(name);
  const heartbeatFile = join(OVERDECK_HOME, 'heartbeats', `${tmuxSession}.json`);

  try {
    if (!existsSync(heartbeatFile)) {
      return { isResponsive: false };
    }

    const content = readFileSync(heartbeatFile, 'utf-8');
    const heartbeat = JSON.parse(content);
    const lastActivity = new Date(heartbeat.timestamp).getTime();
    const age = Date.now() - lastActivity;

    // If heartbeat is less than pingTimeout old, specialist is responsive
    const isResponsive = age < config.pingTimeoutMs;

    return {
      isResponsive,
      lastActivity,
      responseTimeMs: age,
    };
  } catch {
    return { isResponsive: false };
  }
}

/**
 * Perform a health check on a specialist
 *
 * When called from runPatrol, pass the shared state object to avoid
 * independent load/save cycles that clobber each other (the original
 * bug that prevented consecutiveFailures from ever accumulating).
 *
 * When called standalone (no sharedState), loads and saves state itself.
 */
export async function checkSpecialistHealth(
  name: SpecialistAgentName,
  sharedState?: DeaconState,
): Promise<HealthCheckResult> {
  const state = sharedState ?? loadState();
  const healthState = getSpecialistState(state, name);
  const wasRunning = await isRunning(name);

  // Update ping time
  healthState.lastPingTime = new Date().toISOString();

  // If not running, it's not responsive
  if (!wasRunning) {
    if (!sharedState) saveState(state);
    return {
      specialistName: name,
      isResponsive: false,
      wasRunning: false,
      consecutiveFailures: healthState.consecutiveFailures,
      shouldForceKill: false, // Can't force-kill what's not running
      inCooldown: isInCooldown(healthState),
      cooldownRemainingMs: getCooldownRemaining(healthState),
      error: 'Specialist is not running',
    };
  }

  // Check heartbeat
  const heartbeatResult = checkHeartbeat(name);

  if (heartbeatResult.isResponsive) {
    // Reset failure counter on successful response
    healthState.consecutiveFailures = 0;
    healthState.lastResponseTime = new Date().toISOString();
    if (!sharedState) saveState(state);

    return {
      specialistName: name,
      isResponsive: true,
      responseTimeMs: heartbeatResult.responseTimeMs,
      wasRunning: true,
      consecutiveFailures: 0,
      shouldForceKill: false,
      inCooldown: isInCooldown(healthState),
    };
  }

  // Stale heartbeat — but an idle specialist is EXPECTED to have a stale heartbeat
  // (no tool calls = no hook-based heartbeat updates). Don't count idle specialists
  // as failures — only escalate when the specialist should be actively working.
  const tmuxSession = getTmuxSessionName(name);
  const runtimeState = getAgentRuntimeStateSync(tmuxSession);
  const isIdle = !runtimeState || runtimeState.state === 'idle';

  if (isIdle) {
    // Idle specialist with stale heartbeat is normal — treat as responsive
    if (!sharedState) saveState(state);
    return {
      specialistName: name,
      isResponsive: false,  // heartbeat IS stale
      wasRunning: true,
      consecutiveFailures: healthState.consecutiveFailures,  // don't increment
      shouldForceKill: false,  // never force-kill an idle specialist
      inCooldown: isInCooldown(healthState),
    };
  }

  // Active specialist with stale heartbeat — genuinely unresponsive
  healthState.consecutiveFailures++;
  if (!sharedState) saveState(state);

  const shouldForceKill =
    healthState.consecutiveFailures >= config.consecutiveFailures &&
    !isInCooldown(healthState);

  return {
    specialistName: name,
    isResponsive: false,
    wasRunning: true,
    consecutiveFailures: healthState.consecutiveFailures,
    shouldForceKill,
    inCooldown: isInCooldown(healthState),
    cooldownRemainingMs: getCooldownRemaining(healthState),
  };
}

/**
 * Force-kill a stuck specialist
 *
 * When called from runPatrol, pass the shared state object.
 * When called standalone, loads and saves state itself.
 */
export async function forceKillSpecialist(
  name: SpecialistAgentName,
  sharedState?: DeaconState,
): Promise<{
  success: boolean;
  message: string;
}> {
  const tmuxSession = getTmuxSessionName(name);
  const state = sharedState ?? loadState();
  const healthState = getSpecialistState(state, name);

  // Check cooldown
  if (isInCooldown(healthState)) {
    const remaining = getCooldownRemaining(healthState);
    return {
      success: false,
      message: `Specialist ${name} is in cooldown. ${Math.ceil(remaining / 1000)}s remaining.`,
    };
  }

  try {
    // Kill the tmux session (non-blocking)
    await Effect.runPromise(killSession(tmuxSession));

    // Update state
    healthState.lastForceKillTime = new Date().toISOString();
    healthState.forceKillCount++;
    healthState.consecutiveFailures = 0;

    // Record death for mass death detection
    state.recentDeaths.push(new Date().toISOString());
    // Prune old deaths outside the window
    const windowStart = Date.now() - config.massDeathWindowMs;
    state.recentDeaths = state.recentDeaths.filter(
      (d) => new Date(d).getTime() > windowStart
    );

    if (!sharedState) saveState(state);

    console.log(`[deacon] Force-killed specialist ${name}`);

    return {
      success: true,
      message: `Specialist ${name} force-killed after ${healthState.forceKillCount} total kills`,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to kill specialist ${name}: ${msg}`,
    };
  }
}

/**
 * Check for mass death condition
 *
 * When called from runPatrol, pass the shared state object.
 * When called standalone, loads and saves state itself.
 */
export function checkMassDeath(sharedState?: DeaconState): {
  isMassDeath: boolean;
  deathCount: number;
  message?: string;
} {
  const state = sharedState ?? loadState();

  // Prune old deaths
  const windowStart = Date.now() - config.massDeathWindowMs;
  state.recentDeaths = state.recentDeaths.filter(
    (d) => new Date(d).getTime() > windowStart
  );

  const deathCount = state.recentDeaths.length;

  if (deathCount >= config.massDeathThreshold) {
    // Check if we already alerted recently
    if (state.lastMassDeathAlert) {
      const lastAlert = new Date(state.lastMassDeathAlert).getTime();
      const alertCooldown = 5 * 60_000; // 5 minutes between alerts
      if (Date.now() - lastAlert < alertCooldown) {
        if (!sharedState) saveState(state);
        return {
          isMassDeath: true,
          deathCount,
          message: 'Mass death detected (already alerted)',
        };
      }
    }

    // Record alert
    state.lastMassDeathAlert = new Date().toISOString();
    if (!sharedState) saveState(state);

    return {
      isMassDeath: true,
      deathCount,
      message: `ALERT: ${deathCount} specialist deaths in ${config.massDeathWindowMs / 1000}s - possible infrastructure issue`,
    };
  }

  if (!sharedState) saveState(state);

  return {
    isMassDeath: false,
    deathCount,
  };
}

// ============================================================================
// Patrol Loop
// ============================================================================

/**
 * Patrol result for a single cycle
 */
export interface PatrolResult {
  cycle: number;
  timestamp: string;
  specialists: HealthCheckResult[];
  actionsToken: string[];
  massDeathDetected: boolean;
}

/**
 * Check and auto-suspend idle agents (PAN-80)
 *
 * Specialists: 5 minute idle timeout
 * Work agents: NEVER auto-suspend after completion (stay available for merge)
 */
// checkAndSuspendIdleAgents deleted in PAN-800 Phase 5.
// The old implementation read runtime.json + wrote 'suspended' state +
// tmux-regex-checked via isAgentActiveInTmux — all paths the new
// AgentStateService supersedes. Active intervention (auto-suspend) is
// out of scope for PAN-800 and tracked under PAN-188.
export async function checkAndSuspendIdleAgents(): Promise<string[]> {
  return [];
}

// ============================================================================
// Agent State Cleanup
// ============================================================================
//
// Lazy-agent detection (LAZY_PATTERNS regex catalog + checkLazyAgent +
// sendAntiLazyMessage + checkAndCorrectLazyAgents) was deleted in PAN-800
// Phase 5. It had already been disabled in the patrol because false positives
// burned API credits (PAN-133). The replacement predicate is typed:
//   activity === "idle" && !waiting && now - lastActivity > threshold
// Intervention itself is out of scope for PAN-800; PAN-188 tracks rebuilding
// it on top of the AgentRuntimeSnapshot stream.
// ============================================================================

// ACTIVE_STATUS_PATTERNS + isAgentActiveInTmux deleted in PAN-800 Phase 5.
// They pane-scraped Claude Code's status line to guess "is this agent active",
// including a parseThinkingDuration stuck heuristic. The hook-driven runtime
// mirror (getAgentRuntimeStateSync → activity 'working'/'thinking'/'idle') is
// the single source of truth now; capture-pane activity detection is gone.
// isAgentActiveInTmux had no remaining callers at deletion time.

// ============================================================================
// Stuck Work Agent Detection
// ============================================================================

/**
 * checkStuckWorkAgents gutted in PAN-800 Phase 5.
 *
 * The old implementation `capturePane`d every work agent and ran a
 * `parseThinkingDuration` regex over the tmux status line to decide an agent
 * was "stuck thinking", then escalated Escape → Ctrl-C → kill/respawn. That is
 * exactly the capture-pane scraping PAN-798/PAN-800 eliminate, and it was
 * brittle: it only recognised the "Thinking"/"Fermenting" spinner words (not
 * "Quantumizing" et al.) and could not parse hour-scale durations.
 *
 * Stuck detection is now hook-based and lives in `checkStuckAgentRemediation`
 * (stuck-remediation.ts), which reads the runtime mirror via
 * `isAgentIdleForNudge` + `getAgentRuntimeStateSync` and escalates
 * nudge → resume → troubled. PAN-1586 made `isAgentIdleForNudge` treat a stale
 * 'active' mirror (Stop hook never fired) as idle, so a genuinely-stalled agent
 * — regardless of spinner word or duration — is now caught there.
 *
 * The "exclude-from-context" dialog auto-dismiss that also lived here was a
 * pane-scrape active intervention; like auto-suspend and lazy-detection it is
 * out of scope for PAN-800 and tracked under PAN-188. The notification hook
 * already surfaces that dialog as `waiting-on-human`.
 *
 * Retained as a no-op stub so the patrol-cycle wiring stays stable.
 */
export async function checkStuckWorkAgents(): Promise<string[]> {
  return [];
}

// ============================================================================
// Inspect Agent Watchdog
// ============================================================================

/**
 * Inspect prompts state a 10-minute budget. Deacon gives the agent a small
 * grace window beyond that, then fails loud so the parent work agent never waits
 * forever for a verdict that will not arrive.
 */
export const INSPECT_TIMEOUT_MS = 12 * 60_000;

function inspectSessionName(issueId: string, beadId: string): string {
  const issueLower = issueId.toLowerCase();
  const beadSlug = beadId.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 24);
  return `inspect-${issueLower}-${beadSlug}`;
}

function formatInspectElapsed(elapsedMs: number): string {
  return `${Math.max(0, Math.round(elapsedMs / 60_000))}m`;
}

export async function checkInspectAgentTimeouts(now = new Date()): Promise<string[]> {
  const actions: string[] = [];
  const statuses = loadReviewStatuses();
  const nowMs = now.getTime();

  for (const [rawIssueId, status] of Object.entries(statuses)) {
    if (status.inspectStatus !== 'inspecting') continue;

    const issueId = rawIssueId.toUpperCase();
    const beadId = status.inspectBeadId;
    const startedMs = status.inspectStartedAt ? Date.parse(status.inspectStartedAt) : NaN;
    const hasStartedAt = Number.isFinite(startedMs);
    const elapsedMs = hasStartedAt ? nowMs - startedMs : Number.POSITIVE_INFINITY;
    const timedOut = elapsedMs > INSPECT_TIMEOUT_MS;
    const sessionName = beadId ? inspectSessionName(issueId, beadId) : undefined;
    const sessionAlive = sessionName
      ? await Effect.runPromise(sessionExists(sessionName)).catch(() => false)
      : false;
    const crashed = !!sessionName && !sessionAlive;

    if (!timedOut && !crashed) continue;

    const reason = !hasStartedAt
      ? 'missing inspectStartedAt metadata'
      : timedOut
        ? `timed out after ${formatInspectElapsed(elapsedMs)} (limit ${formatInspectElapsed(INSPECT_TIMEOUT_MS)})`
        : `tmux session ${sessionName} exited before producing a verdict`;
    const effectiveBeadId = beadId ?? 'unknown';
    const notes = `Inspection error for bead ${effectiveBeadId}: ${reason}. No verdict was produced.`;
    const verdict = `INSPECTION ERROR for bead ${effectiveBeadId}: inspection could not complete (${reason}) — no verdict was produced. Treat as infrastructure failure: do not silently proceed.`;

    // Mark terminal first so the next patrol cycle skips this inspection even if
    // kill or delivery fails; this is the idempotency guard.
    setReviewStatusSync(issueId, {
      inspectStatus: 'error',
      inspectNotes: notes,
    });

    if (sessionName && sessionAlive) {
      await Effect.runPromise(killSession(sessionName)).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[deacon] Failed to kill inspect session ${sessionName}: ${msg}`);
      });
    }

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(`agent-${issueId.toLowerCase()}`, verdict, 'deacon:inspect-watchdog');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[deacon] Failed to deliver inspect error verdict for ${issueId}: ${msg}`);
    }

    const action = `Inspection watchdog tripped for ${issueId} bead ${effectiveBeadId}: ${reason}`;
    actions.push(action);
    logDeaconEventSync(`checkInspectAgentTimeouts: ${action}`);
  }

  return actions;
}

// ============================================================================
// API Error Recovery
// ============================================================================

/**
 * API error patterns that indicate transient server failures.
 * When an agent stops with one of these in its tmux output, it should
 * be nudged to retry rather than left idle.
 */
const API_ERROR_PATTERNS = [
  'API Error: The server had an error while processing your request',
  'API Error: Overloaded',
  'API Error: Rate limit',
  'API Error: Request was aborted',
  'API Error: Timed out',
  '529 Overloaded',
  '502 Bad Gateway',
  '503 Service Unavailable',
];

/**
 * Cooldown between API-error recovery nudges per agent.
 * Prevents spamming agents that are hitting persistent errors.
 */
const API_ERROR_RECOVERY_COOLDOWN_MS = 5 * 60_000; // 5 minutes

/**
 * Track API-error recovery attempts per agent.
 */
const apiErrorRecoveryState: Map<string, { lastAttempt: number }> = new Map();

/**
 * Context-window overflow is NOT a transient error. It surfaces as e.g.
 * "API Error: 400 Your input exceeds the context window of this model." and
 * nudging "continue" only re-sends the same oversized context for the same
 * 400. Recovery shrinks the context: agent-* sessions are summarized
 * out-of-band and respawned fresh with the summary as their opening prompt
 * (PAN-1781); specialist/planning sessions get the harness /compact plus a
 * continue nudge once it settles.
 *
 * This matters most for non-Anthropic models routed through CLIProxy
 * (e.g. gpt-5.5): Claude Code's native auto-compact is keyed to a context
 * window it can't determine for the proxied model, so it never fires and the
 * backend's own limit produces a hard 400 instead.
 */
/** Continuation nudge sent after a successful harness /compact (specialist/planning sessions). */
const CONTEXT_OVERFLOW_CONTINUE_MSG =
  'Your context was compacted to recover from a context-window overflow. ' +
  'Continue from where you left off using the compacted summary and your ' +
  'beads / continue.json — do NOT start over.';

/**
 * Let a recovery attempt finish before judging the result. MUST exceed the
 * patrol interval (60s): at exactly one interval the guard expires on the very
 * next patrol regardless of timer drift, which is how a still-settling
 * respawn used to get re-judged (and escalated) one tick after its compaction.
 * Compact respawns also spend ~30-60s generating the summary before the fresh
 * session even launches.
 */
const CONTEXT_COMPACT_SETTLE_MS = 150_000;

export const CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT = 85;
const CONTEXT_PROACTIVE_COMPACT_COOLDOWN_MS = 30 * 60_000;
const CONTEXT_PROACTIVE_IDLE_STALE_MS = 5 * 60_000;
/**
 * PAN-1781: proactive-compact cooldown stamp, persisted in the agent dir so a
 * dashboard restart doesn't forget an in-flight /compact and double-fire.
 */
const PROACTIVE_COMPACT_STAMP_FILE = 'last-proactive-compact';

/** Bounded compact-respawn attempts per overflow incident before marking stuck. */
const MAX_CONTEXT_COMPACT_ATTEMPTS = 2;

type ContextOverflowRecovery = {
  lastAttempt: number;
  compactAttempts: number;
  /**
   * How the last attempt recovered: 'respawn' = PAN-1781 fresh-seeded respawn
   * (agent-* sessions; the seed is the opening prompt, no follow-up nudge
   * needed); 'harness-compact' = /compact keystroke (specialist/planning
   * sessions; needs a continue nudge once the compaction settles).
   */
  mechanism: 'respawn' | 'harness-compact';
};

/**
 * Per-session context-overflow recovery state. Present only while a recovery
 * tier is in flight; deleted once the overflow clears (so a later overflow is
 * a fresh incident) or on escalation. Kept separate from apiErrorRecoveryState
 * so the transient-error path is untouched.
 */
export const contextOverflowRecoveryState: Map<string, ContextOverflowRecovery> = new Map();
export const contextProactiveCompactState: Map<string, { lastAttempt: number }> = new Map();

/**
 * PAN-1675 (A2): bounded native-compaction recovery for agents already flagged
 * `stuck` with reason `context_overflow`. These got stuck under the OLD
 * /compact+/clear ladder (which predates Overdeck-side compaction), so they
 * never received a native-compaction attempt — and the `overflowBlocked` gate
 * would otherwise skip their recovery forever. We give them a small, bounded
 * number of out-of-band compaction attempts; if the agent keeps overflowing
 * after that, it stays stuck for a human.
 */
export const stuckOverflowNativeRecoveryState: Map<string, { attempts: number; lastAttempt: number }> = new Map();
const MAX_STUCK_NATIVE_RECOVERY = 2;
const STUCK_NATIVE_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;

async function maybeProactivelyCompactContext(sessionName: string, now: number): Promise<string | null> {
  if (!sessionName.startsWith('agent-')) return null;
  // Cooldown: in-memory fast path, with an on-disk stamp fallback so a
  // dashboard restart doesn't forget a just-fired /compact and double-fire
  // into the still-compacting session (PAN-1781).
  let lastAttempt = contextProactiveCompactState.get(sessionName)?.lastAttempt ?? 0;
  if (!lastAttempt) {
    try {
      const stamp = await readFile(join(getAgentDir(sessionName), PROACTIVE_COMPACT_STAMP_FILE), 'utf-8');
      const parsed = Date.parse(stamp.trim());
      if (!Number.isNaN(parsed)) lastAttempt = parsed;
    } catch { /* no stamp yet */ }
  }
  if (lastAttempt && (now - lastAttempt) < CONTEXT_PROACTIVE_COMPACT_COOLDOWN_MS) return null;
  if (!isAgentIdleForNudge(sessionName, CONTEXT_PROACTIVE_IDLE_STALE_MS, now)) return null;

  const agentState = getAgentStateSync(sessionName);
  const runtimeState = getAgentRuntimeStateSync(sessionName);
  const sessionId = agentState?.sessionId ?? runtimeState?.claudeSessionId;
  if (!agentState?.workspace || !sessionId || !agentState.model) return null;

  let usage: { percentUsed: number } | null = null;
  try {
    const { computeContextUsage } = await import('../../dashboard/server/services/conversation-service.js');
    usage = await computeContextUsage(sessionFilePath(agentState.workspace, sessionId), agentState.model);
  } catch {
    return null;
  }
  if (!usage || usage.percentUsed < CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) return null;

  await Effect.runPromise(sendKeys(sessionName, '/compact'));
  contextProactiveCompactState.set(sessionName, { lastAttempt: now });
  try {
    await writeFile(join(getAgentDir(sessionName), PROACTIVE_COMPACT_STAMP_FILE), new Date(now).toISOString(), 'utf-8');
  } catch { /* stamp is best-effort; in-memory cooldown still applies */ }
  emitActivityEntrySync({
    source: 'cloister',
    level: 'warn',
    message: `${sessionName} context window ${Math.round(usage.percentUsed)}% full — proactively compacting before the hard ceiling`,
    issueId: agentState.issueId,
  });
  return `Context high-water recovery: compacting ${sessionName} at ${Math.round(usage.percentUsed)}%`;
}

/**
 * Check for agents (work agents, specialists, planning) that stopped due
 * to transient API errors.
 *
 * Unlike stuck-thinking agents (which are actively processing), API-error
 * agents have stopped with the prompt showing. The tmux output contains
 * an error message from the provider. Recovery: send a "continue" nudge.
 */
export async function checkApiErrorAgents(): Promise<string[]> {
  const actions: string[] = [];
  const now = Date.now();

  // Check all tmux sessions — not just listRunningAgents() — because
  // specialist sessions aren't always in the agents registry.
  let sessionNames: readonly string[];
  try {
    sessionNames = await Effect.runPromise(listSessionNames());
  } catch {
    return actions;
  }

  const agentSessions = sessionNames.filter(
    name => name.startsWith('agent-') || name.startsWith('specialist-') || name.startsWith('planning-'),
  );
  // PAN-1818: convoy reviewer sub-role sessions (agent-<issue>-review-<subRole>)
  // are owned exclusively by monitorReviewConvoySignals(). checkApiErrorAgents
  // derives a garbage issueId from these names and would apply work-agent
  // compact-respawn, racing the monitor. Skip them here.
  const nonReviewerSessions = agentSessions.filter(
    name => !/^agent-.*-review-(?:security|correctness|performance|requirements)$/.test(name),
  );

  for (const sessionName of nonReviewerSessions) {
    const recovery = apiErrorRecoveryState.get(sessionName);
    if (recovery && (now - recovery.lastAttempt) < API_ERROR_RECOVERY_COOLDOWN_MS) {
      continue;
    }

    let tmuxOutput: string;
    try {
      tmuxOutput = await Effect.runPromise(capturePane(sessionName, 100));
    } catch {
      continue;
    }

    if (!tmuxOutput.trim()) continue;

    const hasPrompt = tmuxOutput.includes('❯');
    if (!hasPrompt) continue;

    // ── Context-window overflow recovery (distinct from transient errors) ──
    // A 400 "input exceeds the context window" cannot be retried by continuing.
    // Recover by compacting; once the compaction has settled and the overflow
    // is gone, nudge the agent to resume. A loop guard escalates to stuck if
    // /compact never clears the overflow.
    {
      const issueId = sessionName.startsWith('agent-')
        ? sessionName.replace('agent-', '').toUpperCase()
        : null;
      const overflowBlocked = (() => {
        if (!issueId) return false;
        const st = getReviewStatusSync(issueId);
        return Boolean(st?.stuck || st?.deaconIgnored);
      })();
      const ov = contextOverflowRecoveryState.get(sessionName);
      // Judge overflow from only the recent tail: the error sits adjacent to the
      // idle prompt when an agent stops, and after a /compact redraw the old
      // error scrolls past this window — so a settled /compact that cleared the
      // overflow won't be misread as "still overflowing" from stale scrollback.
      const hasOverflow = isContextOverflowTail(tmuxOutput);
      const runtimeState = getAgentRuntimeStateSync(sessionName);
      if (hasOverflow) {
        if (!runtimeState?.contextSaturatedAt) {
          await saveAgentRuntimeState(sessionName, { contextSaturatedAt: new Date(now).toISOString() });
          emitActivityEntrySync({
            source: 'cloister',
            level: 'warn',
            message: `${sessionName} marked wedged: context-window overflow detected`,
            issueId: issueId ?? undefined,
          });
        }
      } else if (runtimeState?.contextSaturatedAt) {
        await saveAgentRuntimeState(sessionName, { contextSaturatedAt: undefined });
      }

      // PAN-1675 (A2): rescue agents already flagged stuck=context_overflow.
      // The old /compact+/clear ladder set `stuck` and the `overflowBlocked`
      // gate below then skips their recovery permanently — but those agents
      // never got a Overdeck-side (out-of-band) compaction, which can recover
      // an overflow the harness /compact could not. Give them a bounded number
      // of native-compaction attempts BEFORE the overflowBlocked gate. A
      // successful resumeAgent({compact:true}) clears the stuck flag (in
      // resumeAgent), so a recovered agent re-enters the normal flow. deacon-
      // ignored issues are still left alone.
      {
        const stuckStatus = issueId ? getReviewStatusSync(issueId) : null;
        const isStuckOverflow = Boolean(
          stuckStatus?.stuck && stuckStatus.stuckReason === 'context_overflow' && !stuckStatus.deaconIgnored,
        );
        if (isStuckOverflow) {
          if (!hasOverflow) {
            // The tail no longer shows the overflow error — but that is a WEAK
            // signal: the 400 line can scroll out of the captured window while
            // the agent is still pinned near 100% context. Only clear the stuck
            // flag on a POSITIVE recovery signal — the agent's actual JSONL
            // context usage is back below the proactive high-water mark.
            // Otherwise leave it stuck: a genuinely-full agent must not be
            // returned to the pipeline on a tail-string miss only to re-overflow
            // on its next turn (the false-recovery flap).
            let recoveredPct: number | null = null;
            try {
              const st = getAgentStateSync(sessionName);
              const sid = st?.sessionId ?? runtimeState?.claudeSessionId;
              if (st?.workspace && sid && st.model) {
                const { computeContextUsage } = await import('../../dashboard/server/services/conversation-service.js');
                const usage = await computeContextUsage(sessionFilePath(st.workspace, sid), st.model);
                if (usage && usage.percentUsed < CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) {
                  recoveredPct = usage.percentUsed;
                }
              }
            } catch { /* treat as not-yet-recovered — leave it stuck */ }
            if (recoveredPct !== null) {
              const { clearWorkspaceStuck } = await import('../overdeck/review-status-sync.js');
              clearWorkspaceStuck(issueId!);
              stuckOverflowNativeRecoveryState.delete(sessionName);
              actions.push(`Context overflow recovery: cleared stuck flag for ${sessionName} (context back to ${Math.round(recoveredPct)}%)`);
            }
            continue;
          }
          const rec = stuckOverflowNativeRecoveryState.get(sessionName) ?? { attempts: 0, lastAttempt: 0 };
          if (rec.attempts >= MAX_STUCK_NATIVE_RECOVERY) {
            // Native compaction tried its budget and the agent keeps
            // overflowing — genuinely needs a human; leave it stuck.
            continue;
          }
          if (rec.lastAttempt && (now - rec.lastAttempt) < STUCK_NATIVE_RECOVERY_COOLDOWN_MS) {
            continue;
          }
          rec.attempts += 1;
          rec.lastAttempt = now;
          stuckOverflowNativeRecoveryState.set(sessionName, rec);
          const { resumeAgent } = await import('../agents.js');
          const recovered = await resumeAgent(sessionName, undefined, { compact: true });
          if (recovered.success) {
            stuckOverflowNativeRecoveryState.delete(sessionName);
            emitActivityEntrySync({
              source: 'cloister',
              level: 'warn',
              message: `${sessionName} recovered from a stuck context-overflow via Overdeck-side compaction (attempt ${rec.attempts})`,
              issueId: issueId ?? undefined,
            });
            console.log(`[deacon] Agent ${sessionName} recovered from stuck context-overflow via native compaction (attempt ${rec.attempts})`);
            actions.push(`Context overflow recovery: native-compacted previously-stuck ${sessionName} (attempt ${rec.attempts})`);
            continue;
          }
          // Respawn failed — a spawn-level error (seed generation never fails:
          // it degrades to a reseed-only seed inside resumeAgent). PAN-1781
          // removed the /clear keystroke tier; the bounded retry budget +
          // cooldown above covers transient spawn failures, and an exhausted
          // budget correctly leaves the agent stuck for a human.
          console.warn(`[deacon] Compact respawn failed for stuck ${sessionName} (${recovered.error ?? 'unknown'}; attempt ${rec.attempts}/${MAX_STUCK_NATIVE_RECOVERY})`);
          actions.push(`Context overflow recovery: compact respawn failed for stuck ${sessionName} (attempt ${rec.attempts})`);
          continue;
        }
      }

      if (!overflowBlocked) {
        if (ov && (now - ov.lastAttempt) < CONTEXT_COMPACT_SETTLE_MS) {
          // A recovery tier is in flight — give it time to finish before judging.
          continue;
        }

        if (ov && !hasOverflow) {
          // The previous tier cleared the overflow. A harness /compact leaves
          // the agent idle at the compacted summary, so nudge it to resume. A
          // PAN-1781 fresh-seeded respawn needs no nudge — its seed (summary +
          // reseed instructions) IS the opening prompt.
          if (ov.mechanism === 'harness-compact') {
            try {
              await Effect.runPromise(sendKeys(sessionName, CONTEXT_OVERFLOW_CONTINUE_MSG));
              console.log(`[deacon] Agent ${sessionName} resumed after context-overflow compaction`);
              actions.push(`Context overflow recovery: resumed ${sessionName} after compaction`);
            } catch (err) {
              console.error(`[deacon] Failed to resume ${sessionName} after compaction:`, err);
            }
          } else {
            actions.push(`Context overflow recovery: ${sessionName} recovered after compact respawn`);
          }
          contextOverflowRecoveryState.delete(sessionName);
          continue;
        }

        if (hasOverflow) {
          // Loop guard: a bounded number of compact attempts per incident, then
          // escalate to stuck for a human. PAN-1781 removed the /clear keystroke
          // tier — a respawn that still overflows means something is deeply
          // wrong (e.g. summarization producing oversized seeds), and blowing
          // away the context with /clear just hides it.
          if (ov && ov.compactAttempts >= MAX_CONTEXT_COMPACT_ATTEMPTS) {
            if (issueId) {
              markWorkspaceStuck(issueId, 'context_overflow', {
                compactAttempts: ov.compactAttempts,
              });
            }
            emitActivityEntrySync({
              source: 'cloister',
              level: 'error',
              message: `${sessionName} stuck: context-window overflow persisted after ${ov.compactAttempts} compact-recovery attempts`,
              issueId: issueId ?? undefined,
            });
            console.error(`[deacon] Agent ${sessionName} stuck after ${ov.compactAttempts} compact-recovery attempts — escalating`);
            contextOverflowRecoveryState.delete(sessionName);
            continue;
          }

          const compactAttempts = (ov?.compactAttempts ?? 0) + 1;

          // PAN-1781: agent-* sessions recover via summarize + fresh-seeded
          // respawn (resumeAgent({compact:true})): the wedged session is
          // summarized out-of-band and a FRESH session is spawned with that
          // summary as its opening prompt. Never the harness `/compact` (which
          // deadlocks past the ceiling) and never an in-place JSONL boundary +
          // --resume (which the harness's resume leaf selection bypassed ~half
          // the time, silently rebuilding the full overflowed context — the
          // root cause behind every "compaction didn't work → /clear" incident
          // up to PAN-1775). Attempts are counted on failure too, so a
          // persistently failing respawn exhausts the budget and escalates
          // instead of retrying forever.
          if (issueId !== null) {
            const { resumeAgent } = await import('../agents.js');
            const resumeResult = await resumeAgent(sessionName, undefined, { compact: true });
            contextOverflowRecoveryState.set(sessionName, {
              lastAttempt: now,
              compactAttempts,
              mechanism: 'respawn',
            });
            if (resumeResult.success) {
              emitActivityEntrySync({
                source: 'cloister',
                level: 'warn',
                message: `${sessionName} hit context-window overflow — respawned fresh with a compact-summary seed (attempt ${compactAttempts})`,
                issueId: issueId ?? undefined,
              });
              console.log(`[deacon] Agent ${sessionName} hit context-window overflow — compact-respawned (attempt ${compactAttempts})`);
              actions.push(`Context overflow recovery: compact-respawned ${sessionName} (attempt ${compactAttempts})`);
            } else {
              emitActivityEntrySync({
                source: 'cloister',
                level: 'warn',
                message: `${sessionName} compact respawn failed (${resumeResult.error ?? 'unknown'}) — will retry after settle (attempt ${compactAttempts}/${MAX_CONTEXT_COMPACT_ATTEMPTS})`,
                issueId: issueId ?? undefined,
              });
              console.warn(`[deacon] Compact respawn failed for ${sessionName} (${resumeResult.error ?? 'unknown'}; attempt ${compactAttempts}/${MAX_CONTEXT_COMPACT_ATTEMPTS})`);
              actions.push(`Context overflow recovery: compact respawn failed for ${sessionName} (attempt ${compactAttempts})`);
            }
            continue;
          }

          // Non-agent (specialist/planning) sessions are not registered agents,
          // so the respawn path doesn't apply — keep the harness /compact tier.
          try {
            await Effect.runPromise(sendKeys(sessionName, '/compact'));
            contextOverflowRecoveryState.set(sessionName, {
              lastAttempt: now,
              compactAttempts,
              mechanism: 'harness-compact',
            });
            emitActivityEntrySync({
              source: 'cloister',
              level: 'warn',
              message: `${sessionName} hit context-window overflow — compacting to recover (attempt ${compactAttempts})`,
              issueId: issueId ?? undefined,
            });
            console.log(`[deacon] Agent ${sessionName} hit context-window overflow — sent /compact (attempt ${compactAttempts})`);
            actions.push(`Context overflow recovery: compacting ${sessionName} (attempt ${compactAttempts})`);
          } catch (err) {
            console.error(`[deacon] Failed to send /compact to ${sessionName}:`, err);
          }
          continue;
        }

        if (!ov && !hasOverflow) {
          const proactiveAction = await maybeProactivelyCompactContext(sessionName, now);
          if (proactiveAction) {
            actions.push(proactiveAction);
            continue;
          }
        }
      }
    }

    const hasApiError = API_ERROR_PATTERNS.some(pattern => tmuxOutput.includes(pattern));
    if (!hasApiError) continue;

    // For work agents, respect stuck/deacon-ignored flags
    if (sessionName.startsWith('agent-')) {
      const agentIssueId = (sessionName.replace('agent-', '')).toUpperCase();
      const agentReviewStatus = getReviewStatusSync(agentIssueId);
      if (agentReviewStatus?.stuck || agentReviewStatus?.deaconIgnored) {
        continue;
      }
    }

    console.log(`[deacon] Agent ${sessionName} stopped with API error — nudging retry`);

    try {
      const continueMsg = 'You stopped due to a transient API error. This is a temporary server issue, not a problem with your work. Continue from where you left off. Do NOT start over — pick up exactly where you stopped.';
      await Effect.runPromise(sendKeys(sessionName, continueMsg));
      apiErrorRecoveryState.set(sessionName, { lastAttempt: now });
      actions.push(`API error recovery: nudged ${sessionName} to retry`);
    } catch (err) {
      console.error(`[deacon] Failed to nudge ${sessionName} for API error retry:`, err);
    }
  }

  return actions;
}

/**
 * Clean up stale agent state directories (PAN-154)
 *
 * Scans ~/.overdeck/agents/ for directories that:
 * - Have no active tmux session
 * - Are older than the configured retention threshold (default: 30 days)
 * - Don't have a recently processed completion marker
 *
 * Runs at low frequency (~once per day) via random trigger in patrol cycle.
 */
export async function cleanupStaleAgentState(): Promise<string[]> {
  const actions: string[] = [];
  const cloisterConfig = loadCloisterConfigSync();
  // Default retention for work / planning agent state. These are kept for a
  // short debugging window post-completion; event-driven cleanup in
  // postMergeLifecycle and executeCloseOut deletes them at the actual event
  // that renders them obsolete, so this retention is only a safety net.
  const retentionDays = cloisterConfig.retention?.agent_state_days ?? 7;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  // Reviewer state is ephemeral by design — it's deleted inside
  // runParallelReview Phase 6 as soon as the review posts. This 1-day
  // retention is a safety net for cases where Phase 6 didn't fire
  // (crash, process killed between post and cleanup).
  const reviewerRetentionDays = cloisterConfig.retention?.reviewer_state_days ?? 1;
  const reviewerRetentionMs = reviewerRetentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (!existsSync(AGENTS_DIR)) {
    return actions;
  }

  try {
    const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const agentDir = join(AGENTS_DIR, dir.name);
      const isReviewer = dir.name.startsWith('review-');
      const effectiveRetentionMs = isReviewer ? reviewerRetentionMs : retentionMs;

      try {
        // Check if tmux session is active — never clean up running agents
        try {
          const exists = await Effect.runPromise(sessionExists(dir.name));
          if (exists) {
            continue; // Session exists, skip
          }
        } catch {
          // No session — candidate for cleanup
        }

        // PAN-1908: for canonical agent-* directories, prefer the SQLite agents
        // table as the source of truth. If an entry exists, keep the directory
        // even if state.json is old — the registry (not the filesystem) owns
        // retention. Reviewer directories remain filesystem-ephemeral.
        if (dir.name.startsWith('agent-')) {
          const agent = await Effect.runPromise(
            getAgentState(dir.name).pipe(Effect.catch(() => Effect.succeed(null))),
          );
          if (agent != null) continue;
        }

        // Check directory age via directory mtime.
        const mtime = statSync(agentDir).mtimeMs;

        const ageMs = now - mtime;
        if (ageMs < effectiveRetentionMs) {
          continue; // Not old enough, skip
        }

        // Reviewers don't have a `completed` marker and don't warrant the
        // 7-day grace period — skip the completion check for them.
        if (!isReviewer) {
          const completedFile = join(agentDir, 'completed');
          if (existsSync(completedFile)) {
            const completedAge = now - statSync(completedFile).mtimeMs;
            // Keep completed work agents for at least 7 days regardless of retention
            if (completedAge < 7 * 24 * 60 * 60 * 1000) {
              continue;
            }
          }
        }

        // Safe to remove
        const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000));
        const tag = isReviewer ? 'reviewer' : 'agent';
        rmSync(agentDir, { recursive: true, force: true });
        actions.push(`Purged stale ${tag} state: ${dir.name} (${ageDays} days old)`);
        console.log(`[deacon] Purged stale ${tag} state: ${dir.name} (${ageDays} days old)`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Error cleaning up agent ${dir.name}:`, msg);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error during agent state cleanup:', msg);
  }

  if (actions.length > 0) {
    console.log(`[deacon] Cleanup complete: purged ${actions.length} stale agent directories`);
  }

  return actions;
}

/**
 * Clean up abandoned feedback directories.
 *
 * Event-driven cleanup handles the happy path (new review cycle → clear on
 * dispatch; merge → close-out removes workspace). This sweep is the safety net
 * for workspaces where those events never fired: work agent is no longer
 * running AND no review is in flight AND feedback files are still sitting in
 * `.pan/feedback/`.
 *
 * The feedback is useless once consumed, so we always delete — no archive, no
 * retention. See docs/REVIEW-AGENT-ARCHITECTURE.md.
 */
function listFeatureWorkspaces(): Array<{ issueId: string; workspacePath: string }> {
  const projects = listProjectsSync();
  const workspaces: Array<{ issueId: string; workspacePath: string }> = [];

  for (const { config: projectConfig } of projects) {
    const workspacesRoot = join(projectConfig.path, 'workspaces');
    if (!existsSync(workspacesRoot)) continue;

    let entries: string[];
    try {
      entries = readdirSync(workspacesRoot, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('feature-'))
        .map(e => e.name);
    } catch {
      continue;
    }

    for (const entry of entries) {
      workspaces.push({
        issueId: entry.replace(/^feature-/, '').toUpperCase(),
        workspacePath: join(workspacesRoot, entry),
      });
    }
  }

  return workspaces;
}

export async function cleanupAbandonedFeedback(): Promise<string[]> {
  const actions: string[] = [];

  const { getReviewStatusSync } = await import('../review-status.js');
  const { clearFeedbackFiles } = await import('./feedback-writer.js');

  for (const { issueId, workspacePath } of listFeatureWorkspaces()) {
    const panFeedbackDir = join(workspacePath, '.pan', 'feedback');
    if (!existsSync(panFeedbackDir)) continue;

    const issueLower = issueId.toLowerCase();

    // Gate 1: work agent tmux session active? If yes, feedback may be current.
    const agentSession = `agent-${issueLower}`;
    try {
      if (await Effect.runPromise(sessionExists(agentSession))) continue;
    } catch {
      // Treat lookup error as "session might exist" — skip out of caution.
      continue;
    }

    // Gate 2: review in flight? If yes, feedback is about to be consumed.
    try {
      const status = getReviewStatusSync(issueId);
      if (status?.reviewStatus === 'reviewing') continue;
    } catch {
      // No status entry → safe to clean.
    }

    // Both gates passed — feedback is abandoned, safe to delete.
    try {
      const countFeedbackFiles = (dir: string) => existsSync(dir)
        ? readdirSync(dir).filter(f => /^\d{3}-/.test(f) && f.endsWith('.md')).length
        : 0;
      const before = countFeedbackFiles(panFeedbackDir);
      if (before === 0) continue;
      await Effect.runPromise(clearFeedbackFiles(workspacePath));
      actions.push(
        `Cleared ${before} abandoned feedback file(s) in feature-${issueLower} (agent stopped, no in-flight review)`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[deacon] cleanupAbandonedFeedback failed for feature-${issueLower}:`, msg);
    }
  }

  if (actions.length > 0) {
    console.log(`[deacon] Feedback cleanup: ${actions.length} workspace(s) cleared`);
  }

  return actions;
}

const ORPHAN_REVIEWER_AGE_MS = 60 * 60 * 1000; // 1 hour

async function loadTmuxSessionsWithCreationTimes(): Promise<{ sessions: string[]; creationTimes: Map<string, number> } | null> {
  try {
    const { stdout } = await execAsync(
      `tmux -L overdeck -f ${join(OVERDECK_HOME, 'tmux', 'overdeck.tmux.conf')} list-sessions -F '#{session_name} #{session_created}'`,
      { encoding: 'utf-8' },
    );
    const lines = stdout.split('\n').filter(l => l.trim());
    const sessions: string[] = [];
    const creationTimes = new Map<string, number>();
    for (const line of lines) {
      const parts = line.split(' ');
      if (parts.length >= 2) {
        const name = parts.slice(0, -1).join(' ');
        const created = parseInt(parts[parts.length - 1], 10);
        if (!Number.isFinite(created)) continue;
        if (name) {
          sessions.push(name);
          creationTimes.set(name, created * 1000); // tmux returns seconds
        }
      }
    }
    return { sessions, creationTimes };
  } catch {
    // tmux server may not be running — nothing to clean
    return null;
  }
}

function issueIdFromReviewerSessionName(sessionName: string): string | null {
  // PAN-1059 convoy pattern: agent-<issueId>-review-<subRole>
  const convoyMatch = sessionName.match(/^agent-([a-z0-9]+-\d+)-review-(?:security|correctness|performance|requirements)$/);
  if (convoyMatch) {
    return convoyMatch[1].toUpperCase();
  }

  // Legacy specialist pattern: specialist-<project>-<issueId>-review-<role>
  const parsedReviewer = parseReviewerSessionName(sessionName);
  if (parsedReviewer) {
    return parsedReviewer.issueId.toUpperCase();
  }

  // Generic fallback
  const match = sessionName.match(/([A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function handleOrphanReviewerSession(
  sessionName: string,
  sessions: string[],
  creationTimes: Map<string, number>,
  now: number,
): Promise<string | null> {
  // PAN-1059: convoy sub-role sessions are agent-<id>-review-<subRole>.
  // Legacy specialist sessions matched specialist-*-review-*. Both contain -review-.
  if (!sessionName.includes('-review-')) return null;

  const createdMs = creationTimes.get(sessionName);
  if (!createdMs || now - createdMs < ORPHAN_REVIEWER_AGE_MS) return null;

  const issueId = issueIdFromReviewerSessionName(sessionName);
  if (!issueId) return null;

  // Gate 1: work agent running?
  const agentSession = `agent-${issueId.toLowerCase()}`;
  if (sessions.includes(agentSession)) return null;

  // Gate 2: review in flight for this issue?
  const { getReviewStatusSync } = await import('../review-status.js');
  try {
    const status = getReviewStatusSync(issueId);
    if (status?.reviewStatus === 'reviewing') return null;
  } catch {
    // No status entry → safe to clean
  }

  try {
    await Effect.runPromise(killSession(sessionName));
    const ageMin = Math.round((now - createdMs) / 60000);
    const msg = `Killed orphan reviewer session ${sessionName} (${ageMin}m old)`;
    console.log(`[deacon] ${msg}`);
    return msg;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[deacon] Failed to kill orphan session ${sessionName}:`, msg);
    return null;
  }
}

/**
 * PAN-1908: reactive orphan reviewer-session cleanup. When a work agent stops,
 * check whether any reviewer sessions for the same issue have outlived it and
 * kill them if they are old enough and no review is in flight.
 */
export async function handleAgentStoppedForOrphanReviewerSessions(agentId: string): Promise<string[]> {
  const match = agentId.match(/^agent-([a-z0-9]+-\d+)$/i);
  if (!match) return [];
  const issueId = match[1].toUpperCase();

  const loaded = await loadTmuxSessionsWithCreationTimes();
  if (!loaded) return [];
  const { sessions, creationTimes } = loaded;

  const actions: string[] = [];
  const now = Date.now();
  for (const sessionName of sessions) {
    const sessionIssueId = issueIdFromReviewerSessionName(sessionName);
    if (sessionIssueId !== issueId) continue;

    const result = await handleOrphanReviewerSession(sessionName, sessions, creationTimes, now);
    if (result) actions.push(result);
  }

  if (actions.length > 0) {
    console.log(`[deacon] Orphan session cleanup: killed ${actions.length} session(s)`);
  }
  return actions;
}

/**
 * Clean up orphan reviewer and specialist tmux sessions (PAN-846).
 *
 * PAN-1908: this is now a thin dropped-event safety net. The primary cleanup
 * path is reactive via handleAgentStoppedForOrphanReviewerSessions.
 */
export async function cleanupOrphanReviewerSessions(): Promise<string[]> {
  const loaded = await loadTmuxSessionsWithCreationTimes();
  if (!loaded) return [];
  const { sessions, creationTimes } = loaded;

  const actions: string[] = [];
  const now = Date.now();
  for (const sessionName of sessions) {
    const result = await handleOrphanReviewerSession(sessionName, sessions, creationTimes, now);
    if (result) actions.push(result);
  }

  if (actions.length > 0) {
    console.log(`[deacon] Orphan session cleanup: killed ${actions.length} session(s)`);
  }
  return actions;
}

// ============================================================================
// Orphaned Review Status Detection
// ============================================================================

/**
 * Check for orphaned review/test statuses (PAN-88 follow-up)
 *
 * Detects when an issue has reviewStatus='reviewing' or testStatus='testing'
 * but the corresponding specialist isn't actually running. This can happen if:
 * - The specialist crashed mid-review
 * - The specialist was killed
 * - The wake failed but status wasn't rolled back
 *
 * Resets orphaned statuses to 'pending' so the work can be retried.
 */
/**
 * PAN-794: Circuit-breaker threshold for consecutive parallel-review re-dispatches
 * within a recovery cycle. After this many resets of reviewing → pending by the
 * orphan sweep, the workspace is flagged stuck so it stops burning agent cycles.
 * A clean review outcome (pass/blocked/fail), new commits, or manual unstick
 * resets the counter (see review-agent.ts and checkPostReviewCommits below).
 */
const REVIEW_INFRA_BREAKER_THRESHOLD = 3;

/**
 * Orphan-test self-heal state. A test role cannot spawn while the workspace
 * docker stack is unhealthy — `assertWorkspaceStackHealthyForSpawn` throws and
 * the orphan-test patrol re-fails the identical dispatch every cycle forever
 * (observed: PAN-1190 looped `dispatch_failed` for ~18h after its server/dev
 * containers exited). The deacon now rebuilds the stack before re-dispatch,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const testStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean }> =
  new Map();
const TEST_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const TEST_STACK_REBUILD_MAX_ATTEMPTS = 3;

export const stalledReviewConvoyRecoveryState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean }> =
  new Map();
const STALLED_REVIEW_CONVOY_RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;
const STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS = 3;

export interface ReviewConvoyLiveness {
  anyLive: boolean;
  anyGated: boolean;
  agentIds: string[];
}

export function reviewConvoyLiveness(issueId: string): ReviewConvoyLiveness {
  const normalizedIssueId = issueId.toLowerCase();
  const agentIds = [
    `agent-${normalizedIssueId}`,
    `agent-${normalizedIssueId}-review`,
    ...REVIEW_SUB_ROLES.map((subRole) => `agent-${normalizedIssueId}-review-${subRole}`),
  ];

  let anyLive = false;
  let anyGated = false;

  for (const agentId of agentIds) {
    const agentState = getAgentStateSync(agentId);
    if (!agentState) {
      continue;
    }
    anyLive ||= agentState.status === 'running' || agentState.status === 'starting';
    anyGated ||= agentState.paused === true || agentState.troubled === true;
  }

  return { anyLive, anyGated, agentIds };
}

/**
 * Outcome of an orphan-test stack-health recovery attempt:
 * - `healthy`   — stack is already fine; dispatch can proceed.
 * - `rebuilt`   — stack was unhealthy, a rebuild ran successfully; dispatch can proceed.
 * - `cooldown`  — stack unhealthy, a rebuild was attempted recently; wait it out.
 * - `exhausted` — stack unhealthy, the rebuild cap is reached; escalate, stop retrying.
 */
type TestStackRecovery = 'healthy' | 'rebuilt' | 'cooldown' | 'exhausted';

/**
 * Ensure the workspace docker stack for a test re-dispatch is healthy,
 * rebuilding it once per cooldown window if not. Bounded by
 * TEST_STACK_REBUILD_MAX_ATTEMPTS so an unrebuildable stack escalates cleanly.
 */
async function recoverUnhealthyTestStack(
  issueId: string,
  workspacePath: string,
): Promise<TestStackRecovery> {
  const key = issueId.toUpperCase();
  const { getWorkspaceStackHealth } = await import('../workspace/stack-health.js');

  // PAN-1249: getWorkspaceStackHealth now returns an Effect — run it at this
  // Promise boundary. The Effect never fails (error channel: never), so
  // Effect.runPromise is safe and the result is the plain WorkspaceStackHealth.
  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    testStackRebuildState.delete(key);
    return 'healthy';
  }

  const record = testStackRebuildState.get(key) ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  if (record.attempts >= TEST_STACK_REBUILD_MAX_ATTEMPTS) {
    if (!record.escalated) {
      record.escalated = true;
      testStackRebuildState.set(key, record);
      emitActivityEntrySync({
        source: 'cloister',
        level: 'error',
        issueId: key,
        message: `test-stack-rebuild-exhausted: ${key}`,
        details: `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${health.reasons.join('; ')}. Manual 'pan workspace rebuild ${key}' or 'pan workspace reap' needed.`,
      });
      console.warn(
        `[deacon] Test stack for ${key} unhealthy after ${record.attempts} rebuilds — escalated; ` +
          `stop re-dispatching until a human intervenes`,
      );
    }
    return 'exhausted';
  }

  if (now - record.lastAttempt < TEST_STACK_REBUILD_COOLDOWN_MS) {
    return 'cooldown';
  }

  record.lastAttempt = now;
  record.attempts += 1;
  testStackRebuildState.set(key, record);
  console.log(
    `[deacon] Test stack for ${key} unhealthy (${health.reasons.join('; ')}) — rebuilding ` +
      `(attempt ${record.attempts}/${TEST_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('../workspace/rebuild-stack.js');
  // PAN-1249: rebuildWorkspaceStack returns Effect<RebuildWorkspaceStackResult>
  // with error channel `never` — the Effect captures any failure into
  // result.error. Run at this Promise boundary so the deacon's recovery loop
  // keeps its current Promise-based shape.
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[deacon]   ${key} stack rebuild: ${m}`),
    }),
  );
  if (!result.success) {
    console.warn(`[deacon] Test stack rebuild failed for ${key}: ${result.error}`);
    emitActivityEntrySync({
      source: 'cloister',
      level: 'error',
      issueId: key,
      message: `test-stack-rebuild-failed: ${key}`,
      details: result.error ?? 'unknown error',
    });
    return 'cooldown';
  }

  console.log(`[deacon] Test stack for ${key} rebuilt — proceeding with test dispatch`);
  return 'rebuilt';
}

// ─────────────────────────────────────────────────────────────────────────────
// PAN-1908: reactive review-status handlers (replace directory scans)
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewStatusLike {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  readyForMerge?: boolean;
  prUrl?: string | null;
  stuck?: boolean;
  deaconIgnored?: boolean;
  stuckReason?: string;
  reviewRetryCount?: number;
  recoveryStartedAt?: string;
  history?: Array<{ type: string; status: string; notes?: string }>;
  reviewNotes?: string;
  reviewedAtCommit?: string;
  stuckAt?: string;
  stuckDetails?: string;
}

function latestHistoryEntry(
  history: Array<{ type: string; status: string; notes?: string }> | undefined,
  type: 'review' | 'test',
  terminalStatuses: readonly string[],
): { status: string; notes?: string } | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.type === type && terminalStatuses.includes(entry.status)) {
      return { status: entry.status, notes: entry.notes };
    }
  }
  return null;
}

function latestHistoryByType(
  history: Array<{ type: string; status: string; notes?: string }> | undefined,
  type: 'review' | 'test',
): string | undefined {
  if (!history || history.length === 0) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === type) return history[i].status;
  }
  return undefined;
}

async function isReviewAgentActiveForIssue(issueId: string): Promise<boolean> {
  // PAN-1048 R5: role-primitive review/test runs (agent-<id>-review, agent-<id>-test).
  try {
    const agents = await Effect.runPromise(listRunningAgents());
    for (const agent of agents) {
      if (agent.status === 'stopped' || agent.status === 'error') continue;
      const id = (agent.issueId ?? '').trim().toUpperCase();
      if (!id || id !== issueId.toUpperCase()) continue;
      const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : agent.id.endsWith('-test') ? 'test' : null);
      if (role === 'review') return true;
    }
  } catch {
    // fall through
  }

  // Global specialists
  for (const type of ['review-agent'] as const) {
    const session = getTmuxSessionName(type);
    if (sessionExistsSync(session)) {
      const rState = getAgentRuntimeStateSync(session);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  }

  // Per-project ephemeral specialists
  try {
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning || projSpec.specialistType !== 'review-agent') continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  } catch {
    // fall through
  }

  return false;
}

async function isTestAgentActiveForIssue(issueId: string): Promise<boolean> {
  try {
    const agents = await Effect.runPromise(listRunningAgents());
    for (const agent of agents) {
      if (agent.status === 'stopped' || agent.status === 'error') continue;
      const id = (agent.issueId ?? '').trim().toUpperCase();
      if (!id || id !== issueId.toUpperCase()) continue;
      const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : agent.id.endsWith('-test') ? 'test' : null);
      if (role === 'test') return true;
    }
  } catch {
    // fall through
  }

  for (const type of ['test-agent'] as const) {
    const session = getTmuxSessionName(type);
    if (sessionExistsSync(session)) {
      const rState = getAgentRuntimeStateSync(session);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  }

  try {
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning || projSpec.specialistType !== 'test-agent') continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  } catch {
    // fall through
  }

  return false;
}

/**
 * PAN-1908: react to review.coordinator.died by resetting the issue to a
 * pending review state and re-dispatching the review role. No review-status
 * DB scan — operates on the single issue ID from the event.
 */
export async function handleReviewCoordinatorDied(
  issueId: string,
  _sessionName: string,
  _reason: string,
): Promise<string[]> {
  const actions: string[] = [];
  // PAN-1980: on a no-resume boot the operator's clean slate must hold — do NOT
  // auto-re-dispatch a review convoy (mirrors recoverOrphanedAgents). Review
  // dispatch is an auto-advance just like resume; the boot gate must cover it.
  if (getNoResumeMode().active) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped review re-dispatch — OVERDECK_NO_RESUME=1`);
    return actions;
  }
  const status = getReviewStatusSync(issueId);

  if (!status) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — no review-status row`);
    return actions;
  }

  if (status.stuck || status.deaconIgnored) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — stuck/deaconIgnored`);
    return actions;
  }

  if (await isIssueClosed(issueId)) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — issue closed`);
    return actions;
  }

  // Only reset from active/reviewing states; terminal/failed states should not
  // be overwritten by a coordinator death event.
  if (status.reviewStatus !== 'reviewing' && status.reviewStatus !== 'pending') {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — reviewStatus=${status.reviewStatus}`);
    return actions;
  }

  const nextRetry = (status.reviewRetryCount ?? 0) + 1;
  const recoveryStart = status.recoveryStartedAt ?? new Date().toISOString();
  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    reviewRetryCount: nextRetry,
    recoveryStartedAt: recoveryStart,
  });
  actions.push(`Reset review for ${issueId} after coordinator died (retry ${nextRetry})`);

  const resolved = resolveProjectFromIssueSync(issueId);
  const issueLower = issueId.toLowerCase();
  const workspace = findWorkspacePath(resolved?.projectPath ?? '', issueLower);

  if (!resolved || !workspace) {
    actions.push(`Skipped review re-dispatch for ${issueId}: workspace unavailable`);
    return actions;
  }

  if (!tryReserveAdvancingSlot()) {
    actions.push(`Deferred review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
    return actions;
  }

  try {
    const { spawnReviewRoleForIssue } = await import('./review-agent.js');
    const dispatchResult = await Effect.runPromise(
      spawnReviewRoleForIssue({ issueId, workspace, branch: `feature/${issueLower}` }),
    );
    if (dispatchResult.gated) {
      releaseAdvancingSlot();
      actions.push(`Deferred review re-dispatch for ${issueId} — ${dispatchResult.message}`);
    } else if (dispatchResult.success) {
      actions.push(`Re-dispatched review for ${issueId} after coordinator died`);
    } else {
      actions.push(`Failed to re-dispatch review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    actions.push(`Failed to re-dispatch review for ${issueId}: ${msg}`);
  }

  return actions;
}

/**
 * PAN-1908: react to work.completed by creating a review-status row if one is
 * missing. The reactive scheduler's issue-state change already dispatches the
 * review role; this handler ensures the row exists so downstream reads don't
 * fail.
 */
export async function handleWorkCompleted(issueId: string): Promise<string[]> {
  const actions: string[] = [];
  const status = getReviewStatusSync(issueId);
  if (status) {
    logDeaconEventSync(`handleWorkCompleted: ${issueId} already has review-status row`);
    return actions;
  }

  if (await isIssueClosed(issueId)) {
    logDeaconEventSync(`handleWorkCompleted: ${issueId} skipped — issue closed`);
    return actions;
  }

  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: new Date().toISOString(),
  });
  actions.push(`Created missing review-status row for ${issueId} (work completed)`);
  return actions;
}

/**
 * PAN-1908: per-issue orphan reconciler for a single review-status row. Used by
 * the legacy checkOrphanedReviewStatuses safety net and by reactive handlers.
 */
async function reconcileReviewStatusOrphan(issueId: string, status: ReviewStatusLike): Promise<string[]> {
  const actions: string[] = [];

  if (status.stuck) return actions;
  if (status.deaconIgnored) return actions;
  if (await isIssueClosed(issueId)) return actions;

  const hasPassedReview = latestHistoryByType(status.history, 'review') === 'passed';
  const hasPassedTest = latestHistoryByType(status.history, 'test') === 'passed';
  const latestTerminalReview = latestHistoryEntry(status.history, 'review', ['passed', 'failed', 'blocked']);
  const latestTerminalTest = latestHistoryEntry(status.history, 'test', ['passed', 'failed', 'skipped']);

  const reviewAgentActive = await isReviewAgentActiveForIssue(issueId);

  // Orphaned reviewing status
  if (status.reviewStatus === 'reviewing' && !reviewAgentActive) {
    if (latestTerminalReview && latestTerminalReview.status === 'passed') {
      const reviewUpdate: Record<string, unknown> = {
        reviewStatus: latestTerminalReview.status,
        reviewNotes: latestTerminalReview.notes,
      };
      try {
        const project = resolveProjectFromIssueSync(issueId);
        if (project) {
          const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
          if (existsSync(workspacePath)) {
            const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath });
            reviewUpdate['reviewedAtCommit'] = stdout.trim();
          }
        }
      } catch { /* non-fatal */ }
      if (status.stuckReason === 'review_infrastructure_failure') {
        reviewUpdate['stuck'] = false;
        reviewUpdate['stuckReason'] = undefined;
        reviewUpdate['stuckAt'] = undefined;
        reviewUpdate['stuckDetails'] = undefined;
      }
      if (latestTerminalTest) {
        reviewUpdate['testStatus'] = latestTerminalTest.status;
        reviewUpdate['testNotes'] = latestTerminalTest.notes;
      }
      if (status.mergeStatus === 'failed') {
        const isCiFailure = typeof status.reviewNotes === 'string' && status.reviewNotes.includes('failing required checks');
        if (!isCiFailure) {
          reviewUpdate['mergeStatus'] = 'pending';
        }
      }
      setReviewStatusSync(issueId, reviewUpdate);
      actions.push(
        `Restored orphaned review snapshot for ${issueId} to ${latestTerminalReview.status}` +
        (latestTerminalTest ? ` / test ${latestTerminalTest.status}` : ''),
      );
      return actions;
    }
    if (!hasPassedReview) {
      const nextRetry = (status.reviewRetryCount ?? 0) + 1;
      const recoveryStart = status.recoveryStartedAt ?? new Date().toISOString();
      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        reviewRetryCount: nextRetry,
        recoveryStartedAt: recoveryStart,
      });
      actions.push(
        `Reset orphaned review for ${issueId} (no review-agent active; retry ${nextRetry}/${REVIEW_INFRA_BREAKER_THRESHOLD})`,
      );
    }
  }

  // Re-dispatch pending reviews
  const reviewQueuedOrActive = reviewAgentActive;
  if (
    status.reviewStatus === 'pending' &&
    !reviewQueuedOrActive &&
    !hasPassedReview &&
    status.prUrl
  ) {
    if ((status.reviewRetryCount ?? 0) >= REVIEW_INFRA_BREAKER_THRESHOLD) {
      try {
        markWorkspaceStuck(issueId, 'review_infrastructure_failure', {
          reviewRetryCount: status.reviewRetryCount ?? 0,
          recoveryStartedAt: status.recoveryStartedAt,
          lastReviewNotes: status.reviewNotes,
        });
        actions.push(
          `Tripped review-infra breaker for ${issueId} after ${status.reviewRetryCount} retries — marked stuck`,
        );
      } catch (err) {
        console.error(`[deacon] Failed to mark ${issueId} stuck after breaker trip:`, err);
      }
      return actions;
    }

    const agentIdForCheck = `agent-${issueId.toLowerCase()}`;
    const completedProcessedFile = join(AGENTS_DIR, agentIdForCheck, 'completed.processed');
    if (!existsSync(completedProcessedFile)) return actions;

    const agentState = getAgentStateSync(agentIdForCheck);
    const resolved = resolveProjectFromIssueSync(issueId);
    const issueLower = issueId.toLowerCase();
    const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

    if (getNoResumeMode().active) {
      // PAN-1980: no-resume boot — skip re-dispatching the review convoy so the
      // operator's clean slate holds. Other reconciliation above still runs.
      logDeaconEventSync(`reconcileReviewStatusOrphan: ${issueId} skipped review re-dispatch — OVERDECK_NO_RESUME=1`);
      actions.push(`Skipped review re-dispatch for ${issueId} — no-resume mode active`);
    } else if (workspace && resolved && !tryReserveAdvancingSlot()) {
      actions.push(`Deferred review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
    } else if (workspace && resolved) {
      try {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        const dispatchResult = await Effect.runPromise(
          spawnReviewRoleForIssue({ issueId, workspace, branch: `feature/${issueLower}` }),
        );
        if (dispatchResult.gated) {
          releaseAdvancingSlot();
          actions.push(`Deferred review re-dispatch for ${issueId} — ${dispatchResult.message}`);
        } else if (dispatchResult.success) {
          actions.push(`Re-dispatched pending review for ${issueId} (deacon-orphan-recovery)`);
        } else {
          actions.push(`Failed to re-dispatch pending review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
        }
      } catch (err) {
        actions.push(`Failed to re-dispatch pending review for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (!resolved) {
      actions.push(`Skipped pending review re-dispatch for ${issueId}: no project configured`);
    } else {
      actions.push(`Skipped pending review re-dispatch for ${issueId}: workspace unavailable`);
    }
  }

  // Orphaned testing status
  const testAgentActive = await isTestAgentActiveForIssue(issueId);
  if (
    (status.testStatus === 'testing' || status.testStatus === 'dispatch_failed') &&
    !testAgentActive &&
    !hasPassedTest &&
    !status.readyForMerge
  ) {
    const agentId = `agent-${issueId.toLowerCase()}`;
    const agentState = getAgentStateSync(agentId);
    const resolved = resolveProjectFromIssueSync(issueId);
    const issueLower = issueId.toLowerCase();
    const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

    if (workspace && resolved) {
      const branch = `feature/${issueLower}`;
      const { spawnRun } = await import('../agents.js');
      const { buildTestRolePrompt } = await import('./test-agent-queue.js');

      const stackRecovery = await recoverUnhealthyTestStack(issueId, workspace);
      if (stackRecovery === 'cooldown' || stackRecovery === 'exhausted') {
        setReviewStatusSync(issueId, { testStatus: 'dispatch_failed' });
        actions.push(
          stackRecovery === 'exhausted'
            ? `Orphaned test for ${issueId}: workspace docker stack unhealthy, rebuild cap reached — escalated to human`
            : `Orphaned test for ${issueId}: workspace docker stack rebuilding — deferring re-dispatch`,
        );
      } else if (!tryReserveAdvancingSlot()) {
        actions.push(`Deferred test re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
      } else {
        try {
          const run = await spawnRun(issueId, 'test', {
            workspace,
            prompt: buildTestRolePrompt({ issueId, workspace, branch }),
          });
          testStackRebuildState.delete(issueId.toUpperCase());
          setReviewStatusSync(issueId, { testStatus: 'testing' });
          actions.push(`Re-dispatched orphaned test for ${issueId} via test role ${run.id} (deacon-orphan-recovery)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already running')) {
            setReviewStatusSync(issueId, { testStatus: 'testing' });
            actions.push(`Orphaned test for ${issueId}: test role already running`);
          } else {
            setReviewStatusSync(issueId, { testStatus: 'dispatch_failed' });
            actions.push(`Orphaned test role dispatch failed for ${issueId}: ${msg}`);
          }
        }
      }
    } else {
      setReviewStatusSync(issueId, { testStatus: 'pending' });
      actions.push(
        !resolved
          ? `Reset orphaned test for ${issueId}: no project configured`
          : `Reset orphaned test for ${issueId}: workspace unavailable`,
      );
    }
  }

  return actions;
}

export async function checkOrphanedReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    // PAN-1908: the primary orphan recovery path is now reactive
    // (review.coordinator.died / work.completed events). This function is kept
    // as a thin SQLite-only safety net for dropped events.
    const statuses = loadReviewStatuses();
    for (const [issueId, status] of Object.entries(statuses)) {
      const result = await reconcileReviewStatusOrphan(issueId, status as ReviewStatusLike);
      actions.push(...result);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking orphaned review statuses:', msg);
  }

  return actions;
}

export async function recoverStalledReviewConvoys(
  getCanonicalState: (issueId: string) => Promise<string | null> = getAutoCloseOutCanonicalState,
): Promise<string[]> {
  const actions: string[] = [];

  let statuses: Record<string, ReviewStatus>;
  try {
    statuses = loadReviewStatuses();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error loading review statuses for stalled convoy recovery:', message);
    return actions;
  }

  for (const [issueId, status] of Object.entries(statuses)) {
    try {
      if (status.reviewStatus !== 'reviewing' && status.reviewStatus !== 'pending') continue;
      if (status.stuck || status.deaconIgnored) continue;

      const canonicalState = await getCanonicalState(issueId);
      if (canonicalState !== 'in_review') continue;

      const liveness = reviewConvoyLiveness(issueId);
      if (liveness.anyLive || liveness.anyGated) continue;

      const issueLower = issueId.toLowerCase();
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) {
        actions.push(`Skipped stalled review convoy recovery for ${issueId}: no project configured`);
        continue;
      }

      const workspace = findWorkspacePath(resolved.projectPath, issueLower);
      if (!workspace) {
        actions.push(`Skipped stalled review convoy recovery for ${issueId}: workspace unavailable`);
        continue;
      }

      const key = issueId.toUpperCase();
      let record = stalledReviewConvoyRecoveryState.get(key) ?? { lastAttempt: 0, attempts: 0, escalated: false };
      const now = Date.now();

      // If a human un-stuck the issue, grant a fresh recovery budget.
      if (record.escalated && !status.stuck) {
        stalledReviewConvoyRecoveryState.delete(key);
        record = { lastAttempt: 0, attempts: 0, escalated: false };
      }

      if (record.attempts >= STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS) {
        if (!record.escalated) {
          record.escalated = true;
          stalledReviewConvoyRecoveryState.set(key, record);
          const stuckDetails = JSON.stringify({
            attempts: record.attempts,
            agentIds: liveness.agentIds,
            canonicalState,
          });
          setReviewStatusSync(issueId, {
            stuck: true,
            stuckReason: 'review_convoy_unrecoverable',
            stuckAt: new Date(now).toISOString(),
            stuckDetails,
          });
          status.stuck = true;
          status.stuckReason = 'review_convoy_unrecoverable';
          status.stuckAt = new Date(now).toISOString();
          status.stuckDetails = stuckDetails;
          emitActivityEntrySync({
            source: 'cloister',
            level: 'error',
            issueId: key,
            message: `stalled-review-convoy-unrecoverable: ${key}`,
            details: `Review convoy fully stopped after ${record.attempts} recovery attempts; marked stuck for human intervention. Agents: ${liveness.agentIds.join(', ')}`,
          });
          actions.push(
            `Stalled review convoy for ${issueId}: recovery cap reached after ${record.attempts} attempts — marked stuck`,
          );
        } else {
          actions.push(
            `Stalled review convoy for ${issueId}: recovery cap already escalated after ${record.attempts} attempts`,
          );
        }
        continue;
      }

      if (now - record.lastAttempt < STALLED_REVIEW_CONVOY_RECOVERY_COOLDOWN_MS) {
        actions.push(
          `Stalled review convoy for ${issueId}: deferring — cooldown active after attempt ${record.attempts}/${STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS}`,
        );
        continue;
      }

      // PAN-1665: honor advancing-role concurrency budget before dispatch.
      if (!tryReserveAdvancingSlot()) {
        actions.push(
          `Stalled review convoy for ${issueId}: deferring — advancing-role concurrency ceiling reached`,
        );
        continue;
      }

      record.lastAttempt = now;
      record.attempts += 1;
      stalledReviewConvoyRecoveryState.set(key, record);

      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      try {
        const result = await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace,
          branch: `feature/${issueLower}`,
          force: true,
        }));
        if (!result.success) {
          throw new Error(result.error ?? result.message);
        }
        stalledReviewConvoyRecoveryState.delete(key);
        status.reviewStatus = 'reviewing';
        actions.push(
          `Re-dispatched stalled review convoy for ${issueId} (attempt ${record.attempts}/${STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS})`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push(`Failed to re-dispatch stalled review convoy for ${issueId}: ${message}`);
        console.error(`[deacon] Failed to re-dispatch stalled review convoy for ${issueId}:`, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.push(`Failed stalled review convoy recovery for ${issueId}: ${message}`);
      console.error(`[deacon] Failed stalled review convoy recovery for ${issueId}:`, message);
    }
  }

  return actions;
}

// ============================================================================
// PAN-699: Missing review status detection
// ============================================================================

/**
 * Check for completed work agents that have no review status entry at all.
 *
 * This catches the gap where `pan done` wrote the completion marker but the
 * HTTP trigger to the dashboard never arrived (dashboard down, network failure,
 * etc). Deacon scans the agent directories and auto-triggers review dispatch.
 */
export async function checkMissingReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    // PAN-1908: primary missing-status creation is now reactive (work.completed
    // event). This function is kept as a thin safety net that queries the
    // agents table instead of scanning directories.
    const statuses = loadReviewStatuses();
    const agents = listAllAgents();

    for (const agent of agents) {
      if (!agent.id.startsWith('agent-')) continue;
      const issueId = agent.id.replace('agent-', '').toUpperCase();
      if (statuses[issueId]) continue;

      const completedFile = join(AGENTS_DIR, agent.id, 'completed');
      const processedFile = join(AGENTS_DIR, agent.id, 'completed.processed');
      if (!existsSync(completedFile) && !existsSync(processedFile)) continue;

      const rowCreated = await handleWorkCompleted(issueId);
      actions.push(...rowCreated);

      // PAN-1496: if the issue is closed, reap the stale markers.
      try {
        if (await isIssueClosed(issueId)) {
          try { if (existsSync(completedFile)) rmSync(completedFile); } catch { /* best-effort */ }
          try { if (existsSync(processedFile)) rmSync(processedFile); } catch { /* best-effort */ }
          actions.push(`Reaped stale completion markers for CLOSED ${issueId} (no review re-dispatch)`);
          continue;
        }
      } catch (closedErr) {
        console.warn(`[deacon] checkMissingReviewStatuses closed-check failed for ${issueId}:`, closedErr);
      }

      const resolved = resolveProjectFromIssueSync(issueId);
      const issueLower = issueId.toLowerCase();
      const workspace = findWorkspacePath(resolved?.projectPath ?? '', issueLower);
      if (!resolved || !workspace) {
        actions.push(`Skipped missing-status review for ${issueId}: ${!resolved ? 'no project configured' : 'workspace unavailable'}`);
        continue;
      }

      if (!tryReserveAdvancingSlot()) {
        actions.push(`Deferred missing-status review for ${issueId} — advancing-role concurrency ceiling reached`);
        continue;
      }

      try {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace,
          branch: `feature/${issueLower}`,
        }));
        recordDeaconNudge({
          patrol: 'checkMissingReviewStatuses',
          issueId,
          action: 'auto-triggered review (missing status entry)',
          reason: 'work agent has a completion marker but no review was dispatched — the reactive work→review handoff (work.completed → in_review) never created/dispatched review',
        });
        actions.push(`Auto-triggered review for ${issueId} (missing status entry)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(`Failed to auto-trigger review for ${issueId}: ${msg}`);
        console.error(`[deacon] Failed to auto-trigger review for ${issueId}:`, msg);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking missing review statuses:', msg);
  }

  return actions;
}

// ============================================================================
// PAN-699: Pending test dispatch retry
// ============================================================================

/**
 * Retry test-agent dispatch for issues where review passed but the test-agent
 * never started or failed to dispatch.
 *
 * Conditions:
 * - reviewStatus === 'passed' AND (testStatus === 'pending' for >5min OR testStatus === 'dispatch_failed')
 * - Retries up to 3 times with exponential backoff tracked per-issue.
 */
export async function checkPendingTestDispatch(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const { loadReviewStatuses, setReviewStatusSync } = await import('../review-status.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'passed') continue;
      if (status.testStatus !== 'pending' && status.testStatus !== 'dispatch_failed') continue;

      // PAN-1681: a live test session (idle or working) is the failsafe's job,
      // not a re-dispatch target. Re-dispatching a fresh agent here is what burnt
      // the 3-retry budget on idle agents that simply never signaled. Skip
      // entirely — checkCompletedButUnsignaledTests (run just before this) nudges
      // /auto-completes the existing agent. Only re-dispatch when NO live session.
      const testSession = `agent-${issueId.toLowerCase()}-test`;
      if (sessionExistsSync(testSession)) {
        const testPaneDead = await Effect.runPromise(isPaneDead(testSession)).catch(() => true);
        if (!testPaneDead) continue;
      }

      const retryCount = status.testRetryCount ?? 0;
      if (retryCount >= 3) {
        // PAN-1681: stop silently capping. With no live session to recover from
        // (we'd have continued above) and the verdict failsafe unable to recover,
        // the issue is genuinely stranded. Surface a one-time visible stuck marker
        // so the operator can see it instead of it sitting at test=pending forever.
        // Set only once — don't re-stamp every patrol.
        if (status.stuckReason !== 'test_signal_strand') {
          setReviewStatusSync(issueId, {
            stuck: true,
            stuckReason: 'test_signal_strand',
            stuckAt: new Date().toISOString(),
            testNotes: `Test stranded at ${status.testStatus} after ${retryCount} re-dispatches — the test agent never signaled and no verdict artifact was recovered. Inspect agent-${issueId.toLowerCase()}-test, or run: pan admin specialists done test ${issueId} --status passed|failed.`,
          });
          const msg = `Surfaced test strand for ${issueId}: stuck after ${retryCount} re-dispatches (test_signal_strand)`;
          actions.push(msg);
          console.warn(`[deacon] ${msg}`);
        }
        continue;
      }

      // For pending, only retry if it's been >5 minutes since review passed
      if (status.testStatus === 'pending') {
        const reviewPassedAt = status.history
          ?.filter(h => h.type === 'review' && h.status === 'passed')
          .pop()?.timestamp;
        if (reviewPassedAt && now - new Date(reviewPassedAt).getTime() < 5 * 60 * 1000) {
          continue;
        }
      }

      // PAN-1496/PAN-1613: never re-dispatch test for an issue closed on the
      // tracker or shadow-state. The check is reached only by the small set of
      // issues that pass all status filters above, and the shared helper is
      // TTL-cached — so this cannot storm the API.
      if (await isIssueClosed(issueId)) {
        console.log(`[deacon] ${issueId}: skipping test re-dispatch — issue is closed`);
        continue;
      }

      const { resolveProjectFromIssueSync } = await import('../projects.js');
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) continue;

      const issueLower = issueId.toLowerCase();
      const workAgentId = `agent-${issueLower}`;
      const agentState = getAgentStateSync(workAgentId);
      const workspace = agentState?.workspace || findWorkspacePath(resolved.projectPath, issueLower);
      const branch = `feature/${issueLower}`;

      if (!workspace) {
        actions.push(`Skipped test retry for ${issueId}: workspace unavailable`);
        continue;
      }

      // PAN-1665: defer at the advancing-role concurrency ceiling; status stays
      // pending/dispatch_failed so a later patrol retries once a slot frees.
      if (!tryReserveAdvancingSlot()) {
        actions.push(`Deferred test retry for ${issueId} — advancing-role concurrency ceiling reached`);
        logDeaconEventSync(`checkPendingTestDispatch: deferred test for ${issueId} — advancing ceiling reached (PAN-1665) — ${describeRunningAgents()}`);
        continue;
      }

      const { spawnRun } = await import('../agents.js');
      const { buildTestRolePrompt } = await import('./test-agent-queue.js');
      try {
        const run = await spawnRun(issueId, 'test', {
          workspace,
          prompt: buildTestRolePrompt({ issueId, workspace, branch }),
        });
        setReviewStatusSync(issueId, { testStatus: 'testing', testRetryCount: retryCount + 1 });
        recordDeaconNudge({
          patrol: 'checkPendingTestDispatch',
          issueId,
          action: `dispatched test role ${run.id} (retry ${retryCount + 1})`,
          reason: 'review=passed + test=pending, but the reactive review→test handoff (review.approved → testing) never fired — the deacon had to dispatch test',
          state: {
            reviewStatus: status.reviewStatus,
            testStatus: status.testStatus,
            retryCount,
            reviewedAtCommit: status.reviewedAtCommit,
            lastVerifiedCommit: status.lastVerifiedCommit,
          },
        });
        actions.push(`Dispatched test role ${run.id} for ${issueId} (retry ${retryCount + 1})`);
        console.log(`[deacon] Dispatched test role for ${issueId} (retry ${retryCount + 1})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already running')) {
          setReviewStatusSync(issueId, { testStatus: 'testing', testRetryCount: retryCount + 1 });
          actions.push(`Test role already running for ${issueId} (retry ${retryCount + 1})`);
        } else {
          setReviewStatusSync(issueId, {
            testStatus: 'dispatch_failed',
            testNotes: msg,
            testRetryCount: retryCount + 1,
          });
          actions.push(`Test role dispatch error for ${issueId}: ${msg}`);
          console.error(`[deacon] Test role dispatch error for ${issueId}:`, msg);
        }
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking pending test dispatch:', msg);
  }

  return actions;
}

// ============================================================================
// Stuck review detection (PAN-733)
// ============================================================================

/**
 * Detect issues stuck in `reviewing` status with no active review session.
 *
 * When `spawnReviewRoleForIssue` sets `reviewing` + `reviewSpawnedAt` but the
 * spawn crashes or the review agent exits without updating status, the issue
 * can remain in `reviewing` forever. This check uses `reviewSpawnedAt` as a
 * heartbeat: if it's >30 minutes old and no review session is active, reset
 * to `pending` so deacon can retry dispatch on the next patrol.
 *
 * Guards:
 *   - Only fires when reviewStatus === 'reviewing' AND reviewSpawnedAt is set
 *   - Only resets if no active review session exists for the issue
 *   - 30-minute threshold avoids resetting legitimate long-running reviews
 */
export async function checkStuckReviewing(): Promise<string[]> {
  const actions: string[] = [];
  const REVIEW_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  try {
    const { loadReviewStatuses, setReviewStatusSync } = await import('../review-status.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();

    // Build set of issues with active review sessions
    const activeReviewIssues = new Set<string>();
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning) continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue && projSpec.specialistType === 'review-agent') {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Also check global review-agent
    const globalReviewSession = getTmuxSessionName('review-agent');
    if (sessionExistsSync(globalReviewSession)) {
      const rState = getAgentRuntimeStateSync(globalReviewSession);
      if (rState?.state === 'active' && rState.currentIssue) {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Detect active review runs: agent-<id>-review (synthesis) and
    // agent-<id>-review-<subRole> (PAN-1059 convoy).
    try {
      const { listRunningAgents } = await import('../agents.js');
      const agents = await Effect.runPromise(listRunningAgents());
      for (const agent of agents) {
        if (agent.status === 'stopped' || agent.status === 'error') continue;
        const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : null);
        if (role !== 'review') continue;
        const issueId = (agent.issueId ?? '').trim().toUpperCase();
        if (issueId) activeReviewIssues.add(issueId);
      }
    } catch {
      // Non-fatal: fall back to specialist-only detection
    }

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'reviewing') continue;
      if (!status.reviewSpawnedAt) continue;
      if (activeReviewIssues.has(issueId.toUpperCase())) continue;

      const spawnedAt = new Date(status.reviewSpawnedAt).getTime();
      if (now - spawnedAt < REVIEW_STUCK_THRESHOLD_MS) continue;

      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        reviewNotes: `Review reset by deacon: no active review session after ${Math.round((now - spawnedAt) / 60000)}min`,
      });
      const msg = `Reset stuck reviewing status for ${issueId} (no active session for ${Math.round((now - spawnedAt) / 60000)}min)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking stuck reviewing statuses:', msg);
  }

  return actions;
}

// ============================================================================
// Completed-but-unsignaled review detection
// ============================================================================

/**
 * Detect review specialists that wrote synthesis.md but never called
 * `pan specialists done review`. The review role prompt instructs the agent
 * to signal completion after writing the synthesis, but agents occasionally
 * forget (idle at prompt with reports already on disk). This leaves the
 * issue stuck in `reviewing` status forever.
 *
 * Recovery: read the synthesis verdict and nudge the review agent to signal
 * completion. If the agent session is dead, we auto-complete by updating the
 * review status directly so the pipeline isn't permanently blocked.
 *
 * Guards:
 *   - Only fires when reviewStatus === 'reviewing'
 *   - synthesis.md must exist and be >5 min old (gives the agent time to signal)
 *   - Only nudges once per review cycle (tracked by runId in the review dir)
 */
const unsignaledReviewNudges = new Map<string, number>();

type ReviewRunContext = {
  generatedAt?: string;
  headSha?: string;
};

export function isSynthesisForActiveReviewRun(
  dirPath: string,
  status: Pick<ReviewStatus, 'reviewSpawnedAt' | 'lastVerifiedCommit'>,
  synthesisMtimeMs: number,
): boolean {
  if (!status.reviewSpawnedAt) return true;

  const spawnedAtMs = Date.parse(status.reviewSpawnedAt);
  if (!Number.isFinite(spawnedAtMs)) return true;
  if (synthesisMtimeMs < spawnedAtMs) return false;

  const contextPath = join(dirPath, 'context.json');
  if (!existsSync(contextPath)) return false;

  let context: ReviewRunContext;
  try {
    context = JSON.parse(readFileSync(contextPath, 'utf8')) as ReviewRunContext;
  } catch {
    return false;
  }

  if (context.generatedAt) {
    const generatedAtMs = Date.parse(context.generatedAt);
    if (Number.isFinite(generatedAtMs) && generatedAtMs < spawnedAtMs) return false;
  }

  if (status.lastVerifiedCommit && context.headSha && context.headSha !== status.lastVerifiedCommit) {
    return false;
  }

  return true;
}

export async function checkCompletedButUnsignaledReviews(): Promise<string[]> {
  const actions: string[] = [];
  const SYNTHESIS_SETTLE_MS = 5 * 60 * 1000; // 5 minutes

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'reviewing') continue;

      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) continue;
      const wsPath = findWorkspacePath(resolved.projectPath, issueId.toLowerCase());
      if (!wsPath) continue;

      const reviewBaseDir = join(wsPath, '.pan', 'review');
      if (!existsSync(reviewBaseDir)) continue;

      // Find the most recently modified review run directory
      let latestDir: string | null = null;
      let latestMtime = 0;
      for (const entry of readdirSync(reviewBaseDir)) {
        if (!entry.startsWith(`agent-${issueId.toLowerCase()}-review`)) continue;
        const dirPath = join(reviewBaseDir, entry);
        const synthPath = join(dirPath, 'synthesis.md');
        if (!existsSync(synthPath)) continue;
        const mtime = statSync(synthPath).mtimeMs;
        if (!isSynthesisForActiveReviewRun(dirPath, status, mtime)) continue;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestDir = dirPath;
        }
      }
      if (!latestDir) continue;

      // Wait for synthesis to settle before intervening
      if (now - latestMtime < SYNTHESIS_SETTLE_MS) continue;

      // Deduplicate: only nudge once per directory (one review cycle)
      const lastNudged = unsignaledReviewNudges.get(latestDir);
      if (lastNudged && now - lastNudged < 30 * 60 * 1000) continue;

      const reviewSession = `agent-${issueId.toLowerCase()}-review`;
      const sessionAlive = sessionExistsSync(reviewSession);
      const paneDead = sessionAlive ? await Effect.runPromise(isPaneDead(reviewSession)).catch(() => true) : true;
      const activeReviewState = sessionAlive && !paneDead ? getAgentStateSync(reviewSession) : null;
      if (activeReviewState?.reviewRunId && latestDir !== join(reviewBaseDir, activeReviewState.reviewRunId)) {
        continue;
      }

      const synthesisPath = join(latestDir, 'synthesis.md');
      let verdict: 'passed' | 'blocked' | 'failed' | null = null;
      let topBlocker = '';
      try {
        const content = readFileSync(synthesisPath, 'utf8');
        const verdictLine = content.match(/## Verdict:\s*(.+)/i);
        if (verdictLine) {
          const v = verdictLine[1].trim().toUpperCase();
          if (v === 'PASSED') verdict = 'passed';
          else if (v === 'CHANGES REQUESTED') verdict = 'blocked';
          else if (v === 'FAILED') verdict = 'failed';
        }
        const blockerMatch = content.match(/## Blocking Findings\s*\n\s*###\s*\[[^\]]+\]\s*(.+)/);
        if (blockerMatch) topBlocker = blockerMatch[1].slice(0, 120);
      } catch {
        continue;
      }
      if (!verdict) continue;

      if (sessionAlive && !paneDead) {
        // If we already nudged once and 30+ min have passed with no signal,
        // the agent is unresponsive — auto-complete so the pipeline isn't blocked.
        if (lastNudged) {
          setReviewStatusSync(issueId, {
            reviewStatus: verdict,
            reviewNotes: topBlocker || `Review auto-completed by deacon: ${verdict} (agent alive but unresponsive after nudge, synthesis exists)`,
          });
          actions.push(`Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge, synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge)`);
          continue;
        }

        // Agent is alive but idle — nudge it to signal completion
        const cmd = `pan admin specialists done review ${issueId} --status ${verdict}${verdict === 'blocked' || verdict === 'failed' ? ` --notes "${topBlocker || 'See synthesis.md'}"` : ''}`;
        const nudge = `Your review synthesis is already written and saved. Your ONLY remaining task is to execute this Bash command immediately — do not analyze, do not summarize, do not ask questions, just run it:\n\n${cmd}\n\nRun this command NOW. Do not write any other response before executing it.`;
        try {
          const { messageAgent } = await import('../agents.js');
          await messageAgent(reviewSession, nudge);
          unsignaledReviewNudges.set(latestDir, now);
          actions.push(`Nudged ${reviewSession} to signal ${verdict} (synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Nudged ${reviewSession} to signal ${verdict}`);
        } catch (err: any) {
          console.error(`[deacon] Failed to nudge ${reviewSession}:`, err.message);
        }
      } else {
        // Session is dead — auto-complete so the pipeline isn't blocked
        setReviewStatusSync(issueId, {
          reviewStatus: verdict,
          reviewNotes: topBlocker || `Review auto-completed by deacon: ${verdict} (agent dead, synthesis exists)`,
        });
        actions.push(`Auto-completed review for ${issueId}: ${verdict} (dead agent, synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
        console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (dead agent)`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking completed-but-unsignaled reviews:', msg);
  }

  return actions;
}

// ============================================================================
// Completed-but-unsignaled test detection (PAN-1681)
// ============================================================================

/**
 * Detect test agents that finished but never persisted their verdict — the test
 * twin of {@link checkCompletedButUnsignaledReviews}. The test role narrates
 * "tests pass" but the agent (often Haiku 4.5) sometimes never POSTs testStatus,
 * stranding the issue at test=pending/testing with a live-but-idle session.
 *
 * Recovery is symmetric with the review failsafe: the test role writes a
 * deterministic verdict artifact (.pan/test/result.json) BEFORE it POSTs, and
 * this patrol reads it back to recover the verdict. It NEVER guesses pass/fail
 * (continue.json D6) — auto-complete fires only from a written artifact; with no
 * artifact it nudges once to prompt write+POST, then defers to the
 * strand-surfacing path in checkPendingTestDispatch.
 *
 * Guards (hazard H4):
 *   - Only fires when reviewStatus === 'passed' && testStatus ∈ {testing,pending}
 *   - Skips closed issues (isIssueClosed) and stuck/ignored issues
 *   - Gates a live session on isAgentIdleForNudge + a 5-min settle window
 *   - Nudges at most once per test cycle (deduped by session) before completing
 *   - Only honors an artifact newer than the current test dispatch (H3)
 */
const unsignaledTestNudges = new Map<string, number>();

export async function checkCompletedButUnsignaledTests(): Promise<string[]> {
  const actions: string[] = [];
  const TEST_SETTLE_MS = 5 * 60 * 1000; // 5 minutes — mirror SYNTHESIS_SETTLE_MS
  const NUDGE_DEDUP_MS = 30 * 60 * 1000;

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'passed') continue;
      if (status.testStatus !== 'testing' && status.testStatus !== 'pending') continue;
      if (status.stuck || status.deaconIgnored) continue;
      if (await isIssueClosed(issueId)) continue;

      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) continue;
      const issueLower = issueId.toLowerCase();
      const wsPath = findWorkspacePath(resolved.projectPath, issueLower);
      if (!wsPath) continue;

      const testSession = `agent-${issueLower}-test`;
      const sessionAlive = sessionExistsSync(testSession);
      const paneDead = sessionAlive ? await Effect.runPromise(isPaneDead(testSession)).catch(() => true) : true;
      const sessionLive = sessionAlive && !paneDead;
      const idle = sessionLive ? isAgentIdleForNudge(testSession, TEST_SETTLE_MS, now) : false;

      const lastNudged = unsignaledTestNudges.get(testSession);
      const alreadyNudged = !!(lastNudged && now - lastNudged < NUDGE_DEDUP_MS);

      // Only honor an artifact newer than the current test dispatch so a previous
      // cycle's verdict is never read after a re-dispatch (H3). The latest
      // test→'testing' history entry is the dispatch time.
      const lastDispatchAt = status.history
        ?.filter(h => h.type === 'test' && h.status === 'testing')
        .pop()?.timestamp;
      const minMtimeMs = lastDispatchAt ? new Date(lastDispatchAt).getTime() : undefined;
      const artifact = readTestVerdictArtifact(wsPath, minMtimeMs);

      const decision = decideUnsignaledTestAction({ sessionLive, idle, alreadyNudged, artifact });

      switch (decision.action) {
        case 'auto-complete': {
          const fallbackNote = `Test auto-completed by deacon: ${decision.status} (verdict artifact present, agent ${sessionLive ? 'alive but unresponsive after nudge' : 'dead'})`;
          setReviewStatusSync(issueId, {
            testStatus: decision.status,
            testNotes: decision.notes || fallbackNote,
          });
          const msg = `Auto-completed test for ${issueId}: ${decision.status} (${sessionLive ? 'alive but unresponsive after nudge' : 'dead agent'}, verdict artifact)`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
          break;
        }
        case 'nudge-verdict': {
          const noteArg =
            decision.status === 'failed'
              ? ` --notes "${(decision.notes || 'See .pan/test/result.json').replace(/"/g, "'").slice(0, 120)}"`
              : '';
          const cmd = `pan admin specialists done test ${issueId} --status ${decision.status}${noteArg}`;
          const nudge = `Your test verdict (${decision.status}) is already written to .pan/test/result.json. Your ONLY remaining task is to execute this Bash command immediately — do not analyze, do not summarize, do not ask questions, just run it:\n\n${cmd}\n\nRun this command NOW. Do not write any other response before executing it.`;
          try {
            const { messageAgent } = await import('../agents.js');
            await messageAgent(testSession, nudge);
            unsignaledTestNudges.set(testSession, now);
            const msg = `Nudged ${testSession} to signal ${decision.status} (verdict artifact present)`;
            actions.push(msg);
            console.log(`[deacon] ${msg}`);
          } catch (err: any) {
            console.error(`[deacon] Failed to nudge ${testSession}:`, err.message);
          }
          break;
        }
        case 'nudge-write': {
          const nudge = `Your test run for ${issueId} looks finished but no verdict was recorded. Decide the verdict from the gates/UAT you ran, then do BOTH of these now: (1) write the workspace file .pan/test/result.json as {"status":"passed"|"failed","notes":"<evidence>"}, and (2) run: pan admin specialists done test ${issueId} --status passed|failed. Do this immediately — do not summarize or ask questions, just write the file and run the command.`;
          try {
            const { messageAgent } = await import('../agents.js');
            await messageAgent(testSession, nudge);
            unsignaledTestNudges.set(testSession, now);
            const msg = `Nudged ${testSession} to write+signal a test verdict (no artifact yet)`;
            actions.push(msg);
            console.log(`[deacon] ${msg}`);
          } catch (err: any) {
            console.error(`[deacon] Failed to nudge ${testSession}:`, err.message);
          }
          break;
        }
        case 'wait':
        case 'none':
        default:
          break;
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking completed-but-unsignaled tests:', msg);
  }

  return actions;
}

// ============================================================================
// Verification/review contradiction (PAN-796)
// ============================================================================

export async function checkVerificationReviewContradiction(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { loadReviewStatuses, setReviewStatusSync } = await import('../review-status.js');
    const { resolveProjectFromIssueSync } = await import('../projects.js');
    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (
        status.verificationStatus === 'passed' &&
        status.reviewStatus === 'reviewing' &&
        status.stuckReason === 'review_infrastructure_failure'
      ) {
        // Snapshot the workspace HEAD so reviewedAtCommit is populated — without
        // it, checkPostReviewCommits can never confirm the review is current and
        // the canSkipTests fast-path in setReviewStatus never fires, leaving the
        // issue jammed at passed-but-stuck forever (PAN-977).
        let reviewedAtCommit: string | undefined;
        try {
          const project = resolveProjectFromIssueSync(issueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${issueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath });
              reviewedAtCommit = stdout.trim();
            }
          }
        } catch { /* non-fatal — leave reviewedAtCommit undefined */ }

        // Clearing the stuck marker is mandatory: the bypass *resolves* the
        // review-infra failure, so the issue must no longer be skipped by the
        // deacon's stuck-issue guards or it deadlocks at passed+stuck.
        setReviewStatusSync(issueId, {
          reviewStatus: 'passed',
          reviewNotes: 'Review bypassed: verification passed but review infrastructure repeatedly failed.',
          ...(reviewedAtCommit ? { reviewedAtCommit } : {}),
          stuck: false,
          stuckReason: undefined,
          stuckAt: undefined,
          stuckDetails: undefined,
        });
        const msg = `Bypassed review for ${issueId}: verification passed, review infra failed`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);
      }
    }
  } catch (error: unknown) {
    console.error('[deacon] Error checking verification/review contradiction:', error);
  }
  return actions;
}

// ============================================================================
// CI transient retry tracking (shared by checkPostReviewCommits + checkFailedMergeRetry)
// ============================================================================

// In-memory CI failure retry tracking — separate from mergeRetryCount because
// CI failures are transient and should not permanently block merge attempts.
// Declared here so checkPostReviewCommits can clear it when new commits arrive.
export const ciRetryMap = new Map<string, { count: number; lastAttempt: number }>();

// ============================================================================
// Post-review commit detection
// ============================================================================

/**
 * Detect issues where the agent pushed new commits AFTER review passed.
 *
 * When review passes, specialists.ts snapshots the HEAD commit SHA into
 * `reviewedAtCommit`. On each patrol, we check all passed/readyForMerge
 * issues: if the workspace HEAD has moved past that snapshot, the review
 * is stale and must be re-run.
 *
 * Guards:
 *   - Only fires when reviewedAtCommit is populated (set since the review passed)
 *   - Skips issues already merged (mergeStatus === 'merged')
 *   - Skips issues whose workspace directory doesn't exist
 */
export async function checkPostReviewCommits(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();
    const { resolveProjectFromIssueSync } = await import('../projects.js');

    for (const [issueId, status] of Object.entries(statuses)) {
      // Only check passed reviews not yet merged
      if (status.mergeStatus === 'merged') continue;
      if (!status.reviewedAtCommit) continue;
      if (status.reviewStatus !== 'passed' && !status.readyForMerge) continue;
      if (await isIssueClosed(issueId)) {
        console.log(`[deacon] ${issueId}: skipping review re-dispatch — issue is closed`);
        continue;
      }

      // Resolve workspace path
      const project = resolveProjectFromIssueSync(issueId);
      if (!project) continue;
      const workspacePath = join(
        project.projectPath,
        'workspaces',
        `feature-${issueId.toLowerCase()}`,
      );
      if (!existsSync(workspacePath)) continue;

      // Get current HEAD
      let currentHead: string;
      try {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath });
        currentHead = stdout.trim();
      } catch {
        continue; // not a git repo or git unavailable
      }

      if (currentHead === status.reviewedAtCommit) continue;

      // PAN-1213: A tree-identical rebase (ship agent rebasing onto fresh main
      // for a clean merge, or any pure history rewrite) moves HEAD but leaves
      // the reviewed tree unchanged. Resetting review/test in this case wipes
      // a passed verification for no reason and strands the PR at pending forever
      // (the deacon does not auto-redispatch). Compare tree SHAs — if equal,
      // there is nothing new to review.
      try {
        const [oldTree, newTree] = await Promise.all([
          execAsync(`git rev-parse ${status.reviewedAtCommit}^{tree}`, { cwd: workspacePath }),
          execAsync(`git rev-parse ${currentHead}^{tree}`, { cwd: workspacePath }),
        ]);
        if (oldTree.stdout.trim() === newTree.stdout.trim()) {
          // Tree-identical rebase: advance reviewedAtCommit to the new HEAD so
          // we stop comparing against a SHA the workspace no longer carries,
          // but preserve review/test/readyForMerge.
          setReviewStatusSync(issueId, { reviewedAtCommit: currentHead });
          console.log(
            `[deacon] Tree-identical rebase for ${issueId}: ` +
            `${status.reviewedAtCommit.substring(0, 8)} → ${currentHead.substring(0, 8)} ` +
            `(same tree) — review/test preserved`,
          );
          continue;
        }
      } catch {
        // Fall through to reset if we can't read tree SHAs — safer than skipping
      }

      // HEAD moved with a real tree change — new commits since review. Reset review pipeline.
      console.log(
        `[deacon] Post-review commit detected for ${issueId}: ` +
        `was ${status.reviewedAtCommit.substring(0, 8)}, now ${currentHead.substring(0, 8)} — resetting review`,
      );
      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        reviewedAtCommit: undefined,
        reviewNotes: undefined,
        testNotes: undefined,
        // Reset merge retry counter so checkFailedMergeRetry can retry again after
        // the work agent pushes a fix (e.g. to address a CI check failure).
        mergeRetryCount: 0,
        // PAN-794: new commits open a fresh recovery cycle — stale infra
        // failures from the previous cycle must not poison the breaker budget.
        reviewRetryCount: 0,
        recoveryStartedAt: undefined,
      });
      // Also clear the CI transient retry counter so the next merge attempt
      // starts fresh. Without this, ciRetryMap retains count=6 from the previous
      // CI failure cycle, permanently blocking transient retries for this issue.
      ciRetryMap.delete(issueId);
      actions.push(
        `Reset review for ${issueId}: new commits after review passed ` +
        `(${status.reviewedAtCommit.substring(0, 8)} → ${currentHead.substring(0, 8)})`,
      );

      // Redispatch a fresh review convoy. Re-read status to guard against races
      // with other dispatch paths (HTTP request-review, manual CLI) that may have
      // already picked up the work between the reset above and now.
      const freshStatus = getReviewStatusSync(issueId);
      if (freshStatus?.reviewStatus === 'pending' && !tryReserveAdvancingSlot()) {
        // PAN-1665: at the ceiling — status is already reset to pending above, so
        // the orphan-review path will re-dispatch on a later patrol once a slot frees.
        actions.push(`Deferred post-review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
        logDeaconEventSync(`checkPostReviewCommits: deferred review for ${issueId} — advancing ceiling reached (PAN-1665) — ${describeRunningAgents()}`);
      } else if (freshStatus?.reviewStatus === 'pending') {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        const branch = `feature/${issueId.toLowerCase()}`;
        const dispatchResult = await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace: workspacePath,
          branch,
          force: true,
        }));
        if (dispatchResult.gated) {
          releaseAdvancingSlot();
          actions.push(`Deferred post-review re-dispatch for ${issueId} — ${dispatchResult.message}`);
          console.log(`[deacon] Deferred post-review re-dispatch for ${issueId}: ${dispatchResult.message}`);
        } else if (dispatchResult.success) {
          actions.push(`Re-dispatched review for ${issueId}`);
          console.log(`[deacon] Re-dispatched review convoy for ${issueId} after post-review commit reset`);
        } else {
          actions.push(`Failed to re-dispatch review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
          console.error(`[deacon] Failed to re-dispatch review for ${issueId}:`, dispatchResult.error || dispatchResult.message);
        }
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkPostReviewCommits:', msg);
  }

  return actions;
}

// ============================================================================
// Ready-for-merge stuck detection (PAN-344)
// ============================================================================

// Minimum age (ms) of a readyForMerge status before deacon sends a merge-ready reminder.
// This is NOT a stuck detection — it's a courtesy notification that a merge is waiting
// for the human to click MERGE. One hour is reasonable; the human may be reviewing,
// working on other things, or intentionally waiting.
const MERGE_READY_REMINDER_MS = 60 * 60 * 1000; // 1 hour
// Minimum wait (ms) between successive merge-ready reminders for the same issue
const MERGE_READY_REMINDER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// Circuit breaker: stop reminding after this many times (per server lifetime)
const MERGE_READY_REMINDER_MAX = 3;

// In-memory cooldowns for stuck-merge detection (reset on server restart is acceptable —
// cooldowns are a performance optimisation, not critical state)
const mergeStuckCooldowns = new Map<string, number>();

// Callback set by the server layer to emit domain events when agents are stopped.
// Deacon is a library module and does not own the event store directly.
let agentStoppedNotifier: ((agentId: string) => void) | null = null;
let agentStatusChangedNotifier: ((state: AgentState, previousStatus?: AgentState['status'], hasLiveTmuxSession?: boolean) => void) | null = null;
const orphanFailureRecordedForAutoResume = new Set<string>();

/**
 * Register a callback that deacon will call when it detects an orphaned agent
 * and resets it to stopped. The server layer uses this to emit an agent.stopped
 * domain event so the read model and frontend update in real-time.
 */
export function setAgentStoppedNotifier(fn: (agentId: string) => void): void {
  agentStoppedNotifier = fn;
}

/** Register a callback for Deacon-owned AgentState changes that must reach live clients. */
export function setAgentStatusChangedNotifier(fn: (state: AgentState, previousStatus?: AgentState['status'], hasLiveTmuxSession?: boolean) => void): void {
  agentStatusChangedNotifier = fn;
}

function notifyAgentStatusChanged(state: AgentState, previousStatus?: AgentState['status'], hasLiveTmuxSession?: boolean): void {
  if (!agentStatusChangedNotifier) return;
  try { agentStatusChangedNotifier(state, previousStatus, hasLiveTmuxSession); } catch { /* non-fatal */ }
}

// Callback set by the server layer to emit Socket.io merge:ready notifications.
// Deacon is a library module and does not own the Socket.io instance directly.
let mergeReadyNotifier: ((issueId: string) => void) | null = null;

/**
 * Register a callback that deacon will call when it detects an issue stuck in
 * readyForMerge state. The server layer uses this to emit a Socket.io event
 * so the dashboard can alert the user to click MERGE.
 */
export function setMergeReadyNotifier(fn: (issueId: string) => void): void {
  mergeReadyNotifier = fn;
}

/**
 * Safety-net patrol: find issues that are readyForMerge but not yet merging/merged
 * and whose readyForMerge status is older than MERGE_STUCK_STALENESS_MS.
 *
 * Previously this auto-triggered the merge API. Now it is notify-only: it emits
 * a merge:ready Socket.io event so the dashboard can prompt the user to click
 * the MERGE button. The MERGE button is the sole merge trigger (PAN-354).
 *
 * Guards:
 *   - Staleness: status must be at least 2 min old (avoids racing with primary trigger)
 *   - Per-issue cooldown: 10 min between successive attempts
 *   - Circuit breaker: max 3 attempts per issue per process lifetime
 */
export async function checkReadyForMergeStuck(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();

    const now = Date.now();
    const state = loadState();
    const attemptCounts = state.mergeStuckAttempts ?? {};
    let stateModified = false;

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on issues that are ready but not yet merging/merged/failed
      if (!status.readyForMerge) continue;
      if (status.mergeStatus === 'merging' || status.mergeStatus === 'merged' || status.mergeStatus === 'failed') continue;

      // Wait at least 1 hour before sending a merge-ready reminder.
      // The human controls when to merge — this is just a courtesy notification.
      if (!status.updatedAt) continue;
      const statusAge = now - new Date(status.updatedAt).getTime();
      if (statusAge < MERGE_READY_REMINDER_MS) continue;

      // Per-issue cooldown (in-memory — reset on restart is acceptable for a rate-limiter)
      const lastAttempt = mergeStuckCooldowns.get(key);
      if (lastAttempt && (now - lastAttempt) < MERGE_READY_REMINDER_COOLDOWN_MS) continue;

      // Circuit breaker (persisted to deacon state so restart doesn't reset the count)
      const attempts = attemptCounts[key] ?? 0;
      if (attempts >= MERGE_READY_REMINDER_MAX) continue;

      const ageHours = Math.round((now - new Date(status.updatedAt).getTime()) / 3600000 * 10) / 10;
      console.log(`[deacon] Merge-ready reminder for ${key} (ready for ${ageHours}h, reminder ${attempts + 1}/${MERGE_READY_REMINDER_MAX})`);

      // Record attempt before notifying so a crash doesn't leave us in a retry loop
      mergeStuckCooldowns.set(key, now);
      attemptCounts[key] = attempts + 1;
      stateModified = true;

      // Notify the dashboard via Socket.io so the user knows to click MERGE.
      // Auto-triggering merge was removed in PAN-354; the MERGE button is the sole trigger.
      const msg = `Merge ready: ${key} has been waiting for merge for ${ageHours}h — click MERGE when ready`;
      if (mergeReadyNotifier) {
        mergeReadyNotifier(status.issueId ?? key);
        actions.push(msg);
        console.log(`[deacon] merge:ready notification sent for ${key}`);
      } else {
        actions.push(msg);
        console.warn(`[deacon] No mergeReadyNotifier registered — dashboard will not be notified for ${key}`);
      }
    }

    // Persist updated attempt counts so circuit breaker survives server restarts
    if (stateModified) {
      state.mergeStuckAttempts = attemptCounts;
      saveState(state);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkReadyForMergeStuck:', msg);
  }

  return actions;
}


/**
 * Detect issues whose feature branch is merged to main but mergeStatus is stale.
 * Happens when a merge bypasses the dashboard (manual git merge, direct push, or
 * deploy script crash). Sets mergeStatus='merged' so the dashboard shows the
 * correct state and close-out can proceed.
 */
const staleMergeReconciled = new Set<string>();

export async function reconcileStaleMergeStatus(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus === 'merged') continue;
      if (staleMergeReconciled.has(issueId)) continue;

      const project = resolveProjectFromIssueSync(issueId);
      if (!project) continue;

      // Closed-out issues are TERMINAL: close-out flips the spec to
      // completed/cancelled and clears review status. Treating the cleared/
      // resurrected row as "stale" here re-fires the post-merge handoff,
      // which REOPENS the closed tracker issue (PAN-1190, 2026-06-11).
      try {
        const { findSpecByIssue } = await import('../pan-dir/specs.js');
        const spec = await Effect.runPromise(findSpecByIssue(project.projectPath, issueId));
        if (spec && (spec.status === 'completed' || spec.status === 'cancelled')) {
          staleMergeReconciled.add(issueId);
          continue;
        }
      } catch {
        // Spec unreadable — fall through to the normal checks.
      }

      const branch = `feature/${issueId.toLowerCase()}`;
      let isMerged = false;

      // Check 1: diagnostic only. Branch topology alone is not proof of a
      // completed pipeline merge: a branch created at main with no
      // implementation commits also satisfies merge-base --is-ancestor. Keep
      // the stale-merge reconciler PR-backed so re-planning cannot
      // phantom-merge an already planned issue.
      try {
        const [branchTip, mainTip] = await Promise.all([
          execFileAsync('git', ['rev-parse', branch], { cwd: project.projectPath }),
          execFileAsync('git', ['rev-parse', 'main'], { cwd: project.projectPath }),
        ]);
        if (branchTip.stdout.trim() === mainTip.stdout.trim()) {
          console.log(`[deacon] ${issueId}: branch ${branch} points at main; not treating zero-commit branch as merged`);
        }
      } catch {
        // Branch is absent/unreadable — leave merge detection to the PR API.
      }

      // Check 2: query GitHub for PR mergedAt/mergeCommit. The
      // old regex-based detection (`\(PAN-XXXX[ )]` against `git log --pretty=%s`)
      // matched ANY commit that mentioned the issue in a trailer, not just
      // genuine squash merges. That's how PAN-977/945/913/544/457 got
      // mergeStatus=merged and rolled into close-out without an actual merge:
      // unrelated commits landed on main with `(PAN-977)` references and the
      // deacon trusted them. GitHub's API is the only authoritative source.
      if (!isMerged) {
        const { resolveGitHubIssueSync: _resolveGitHubIssue } = await import('../tracker-utils.js');
        const ghResolved = _resolveGitHubIssue(issueId);
        if (ghResolved.isGitHub) {
          try {
            const repoArg = `${ghResolved.owner}/${ghResolved.repo}`;
            const { stdout } = await execFileAsync(
              'gh', ['pr', 'list', '--repo', repoArg, '--head', branch, '--state', 'all', '--json', 'number,mergedAt,mergeCommit', '--limit', '5'],
              { cwd: project.projectPath },
            );
            const prs = JSON.parse(stdout || '[]') as Array<{ number: number; mergedAt: string | null; mergeCommit: unknown | null }>;
            if (prs.some((pr) => pr.mergedAt || pr.mergeCommit)) {
              isMerged = true;
            }
          } catch {
            // gh query failed — leave isMerged as false rather than guess.
          }
        }
      }

      if (isMerged) {
        // PAN-1994: Skip the entire reconcile (including setReviewStatusSync) if
        // a planning or work agent is actively running. Setting mergeStatus=merged
        // while a fresh re-plan is in progress would contaminate the new pipeline
        // cycle with stale prior-merge state. Leave staleMergeReconciled unset so
        // the next patrol re-evaluates once the active agent has finished.
        const issueLower = issueId.toLowerCase();
        const planState = getAgentStateSync(`planning-${issueLower}`);
        const workState = getAgentStateSync(`agent-${issueLower}`);
        const hasActiveAgent =
          planState?.status === 'running' || planState?.status === 'starting' ||
          workState?.status === 'running' || workState?.status === 'starting';

        if (hasActiveAgent) {
          console.log(`[deacon] ${issueId}: active agent in progress — deferring stale-merge reconcile (PAN-1994)`);
          continue;
        }

        setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false });
        staleMergeReconciled.add(issueId);
        const msg = `Reconciled stale mergeStatus for ${issueId} — branch ${branch} is merged to main`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);

        // PAN-1027: also run the post-merge handoff so labels get cleaned, work
        // agent tmux session is killed, beads compacted, etc. Without this the
        // dashboard knows the issue is merged but GitHub labels stay stale
        // ("in-progress"/"in-review") and orphaned tmux sessions leak memory.
        // skipDeploy avoids respawning the server — best-effort reconciliation.
        try {
          const { postMergeLifecycle } = await import('./merge-agent.js');
          postMergeLifecycle(issueId, project.projectPath, branch, { skipDeploy: true }).catch(err =>
            console.warn(`[deacon] postMergeLifecycle (reconcile) failed for ${issueId}: ${err}`)
          );
        } catch (err) {
          console.warn(`[deacon] Could not import postMergeLifecycle: ${err}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Error in reconcileStaleMergeStatus: ${err.message}`);
  }
  return actions;
}

/**
 * PAN-1027 reverse direction: detect issues whose internal mergeStatus='merged' but
 * whose GitHub PR is NOT merged (open, closed-without-merge, or reverted). When the
 * dashboard previously detected a merge that later got reverted (or the deacon's
 * forward-direction reconciler matched a squash-commit grep that wasn't actually a
 * merge), the issue gets stuck because every gate that checks `mergeStatus !== 'merged'`
 * skips it. This sweep resets the stale merged status so the issue can flow through
 * the pipeline again.
 */
const falseMergedReset = new Set<string>();

export async function reconcileFalseMerged(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
    if (!isGitHubAppConfigured()) return actions;

    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus !== 'merged') continue;
      if (!status.prUrl) continue;
      if (falseMergedReset.has(issueId)) continue;

      const prRef = status.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!prRef) continue;

      try {
        const prState = await Effect.runPromise(getPullRequestState(prRef[1], prRef[2], Number.parseInt(prRef[3], 10)));
        if (!prState.merged) {
          // GitHub says not merged but our DB says merged — reset internal state.
          // Leave reviewStatus alone (it may legitimately be passed/failed/blocked from
          // the prior cycle); the issue can proceed through the pipeline once mergeStatus
          // is no longer blocking.
          setReviewStatusSync(issueId, { mergeStatus: 'pending' });
          falseMergedReset.add(issueId);
          const msg = `Reset stale mergeStatus=merged for ${issueId} — PR ${status.prUrl} is not merged on GitHub`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        }
      } catch (err: any) {
        // Non-fatal: GitHub API hiccup. Try again next patrol.
        console.warn(`[deacon] Failed false-merged check for ${issueId}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Error in reconcileFalseMerged: ${err.message}`);
  }
  return actions;
}

/**
 * Detect issues whose merge_status='merged' but review_status is still in a
 * non-terminal state (reviewing, pending, etc.). If the merge actually
 * happened, the review must have passed at some point even if the dashboard
 * missed the transition (e.g. coordinator crashed mid-run, dashboard restart
 * dropped an in-flight update). Reconciling to review_status='passed' clears
 * the "running reviewers with no data" UI state PAN-1028 reproduced.
 */
const mergedReviewingReconciled = new Set<string>();

/**
 * Per-issue throttle for the closed-PR readyForMerge reconciler so a transient
 * GitHub API failure doesn't burn the rate budget on the same issues every
 * patrol. Cleared when the issue's state changes.
 */
const closedPrReadyReconcileCooldowns = new Map<string, number>();
const CLOSED_PR_RECONCILE_COOLDOWN_MS = 10 * 60 * 1000;
const testStatusGreenCiReconcileCooldowns = new Map<string, number>();
const TEST_STATUS_GREEN_CI_RECONCILE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Reconciler: issues with readyForMerge=true whose PR is no longer OPEN.
 *
 * The "Awaiting Merge" view filters on readyForMerge=true, so an issue whose
 * PR was closed without merging (cancel-flow, manual `gh pr close`, branch
 * deleted) stays in that list forever — the merge button points at a dead PR
 * and would only get cleared the next time the user clicks it (PAN-509-style
 * defensive check in `/api/issues/:id/merge`). That UX is bad: the page
 * actively lies to the human about what's ready to ship.
 *
 * This patrol catches it proactively: for every readyForMerge=true issue with
 * a GitHub PR URL, ask the forge for the current PR state. If MERGED, flip
 * mergeStatus to 'merged' (post-merge lifecycle catches up elsewhere). If
 * CLOSED-without-merge, reset readyForMerge=false and surface why on
 * mergeNotes so the human sees what happened instead of a missing button.
 */
export async function reconcileClosedPrReadyForMerge(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
    if (!isGitHubAppConfigured()) return actions;

    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (!status.readyForMerge) continue;
      if (!status.prUrl) continue;

      const cooledUntil = closedPrReadyReconcileCooldowns.get(issueId);
      if (cooledUntil && now < cooledUntil) continue;

      const match = status.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) continue;
      const [, owner, repo, numberStr] = match;
      const prNumber = parseInt(numberStr, 10);
      if (!Number.isFinite(prNumber)) continue;

      try {
        const prState = await Effect.runPromise(getPullRequestState(owner, repo, prNumber));
        if (prState.state === 'OPEN' && !prState.merged) continue;

        if (prState.merged) {
          setReviewStatusSync(issueId, {
            readyForMerge: false,
            mergeStatus: 'merged',
            mergeNotes: undefined,
          });
          const msg = `Reset readyForMerge for ${issueId} — PR #${prNumber} is already merged`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        } else {
          setReviewStatusSync(issueId, {
            readyForMerge: false,
            mergeStatus: 'failed',
            mergeNotes: `PR #${prNumber} was closed without merging — reopen the PR or reset review state to re-queue this issue`,
          });
          const msg = `Reset readyForMerge for ${issueId} — PR #${prNumber} is ${prState.state} (not OPEN)`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        }
        // Don't re-check for 10 min even if state somehow gets re-set.
        closedPrReadyReconcileCooldowns.set(issueId, now + CLOSED_PR_RECONCILE_COOLDOWN_MS);
      } catch (prErr: any) {
        // Throttle on API failure so we don't hammer GitHub.
        closedPrReadyReconcileCooldowns.set(issueId, now + CLOSED_PR_RECONCILE_COOLDOWN_MS);
        console.warn(`[deacon] reconcileClosedPrReadyForMerge: ${issueId} PR state lookup failed: ${prErr.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Error in reconcileClosedPrReadyForMerge: ${err.message}`);
  }
  return actions;
}

export async function reconcileTestStatusFromGreenCi(): Promise<string[]> {
  const { getCiCheckRunsState, getPullRequestHeadState, isGitHubAppConfigured } = await import('../github-app.js');
  return reconcileTestStatusFromGreenCiWithDeps({
    isGitHubAppConfigured,
    loadReviewStatuses,
    getPullRequestHeadState,
    getCiCheckRunsState,
    setReviewStatusSync,
    cooldowns: testStatusGreenCiReconcileCooldowns,
    cooldownMs: TEST_STATUS_GREEN_CI_RECONCILE_COOLDOWN_MS,
    now: () => Date.now(),
    log: (message) => console.log(`[deacon] ${message}`),
    warn: (message) => console.warn(`[deacon] ${message}`),
  });
}

export async function reconcileMergedButReviewing(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const statuses = loadReviewStatuses();
    const nonTerminal = new Set(['reviewing', 'pending', undefined, null]);

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus !== 'merged') continue;
      const reviewNonTerminal = nonTerminal.has(status.reviewStatus as string | undefined);
      const testNonTerminal = nonTerminal.has(status.testStatus as string | undefined);
      if (!reviewNonTerminal && !testNonTerminal) continue;
      if (mergedReviewingReconciled.has(issueId)) continue;

      // Set BOTH review and test to 'passed' atomically. Setting only review='passed'
      // trips the canSkipTests dispatch path in setReviewStatus and spawns a test-agent
      // for an already-merged issue — pure waste. The merge is terminal, no test needed.
      setReviewStatusSync(issueId, {
        reviewStatus: 'passed',
        testStatus: 'passed',
        testNotes: status.testNotes ?? 'Skipped: issue is already merged',
      });
      mergedReviewingReconciled.add(issueId);
      const msg = `Reconciled review_status=${status.reviewStatus ?? 'null'}, test_status=${status.testStatus ?? 'null'} → passed for ${issueId} (merge_status=merged is terminal)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    }
  } catch (err: any) {
    console.warn(`[deacon] Error in reconcileMergedButReviewing: ${err.message}`);
  }
  return actions;
}

// Track per-issue cooldowns for failed-merge retry to avoid rapid re-queuing
const failedMergeRetryCooldowns = new Map<string, number>();
// Track per-issue cooldowns for timeout nudges to avoid spamming the work agent
const timeoutNudgeCooldowns = new Map<string, number>();

// Minimum time (ms) after merge failure before attempting a retry
const FAILED_MERGE_RETRY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
// Minimum time (ms) between timeout nudges to the same work agent
const TIMEOUT_NUDGE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
// Shorter cooldown for CI-transient failures (pending checks that resolve quickly)
const CI_TRANSIENT_RETRY_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
// Max number of automatic retries before requiring manual intervention
const FAILED_MERGE_MAX_RETRIES = 3;

/**
 * Auto-retry issues whose mergeStatus='failed' due to transient post-rebase
 * verification failures (e.g. flaky tests or tests fixed on main after failure).
 *
 * CI check failures (pending/failing) are handled differently from real merge
 * failures: they may resolve without any code change (e.g. CI queue clears,
 * GitHub status updates). These get a separate retry mechanism with a shorter
 * cooldown (2 min) and their own counter — they do NOT saturate mergeRetryCount.
 *
 * When review+test both passed but the post-rebase gate failed, the issue is
 * stuck: the deacon's merge-ready loop skips mergeStatus='failed' entries and
 * there is no other retry mechanism. After a 30-min cooldown, this patrol resets
 * the issue to readyForMerge=true so it reappears on the Awaiting Merge page.
 *
 * Guards:
 *   - Review + test must both be 'passed' (don't retry if code quality failed)
 *   - 30-min per-issue cooldown for non-CI failures, 2-min for CI transient
 *   - Circuit breaker: max 3 retries (mergeRetryCount) for non-CI
 *   - CI transient failures: max 5 retries with flat 2-minute cooldown
 */
export async function checkFailedMergeRetry(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();

    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on issues where merge failed but review+test both passed
      if (status.mergeStatus !== 'failed') continue;
      if (status.reviewStatus !== 'passed' || status.testStatus !== 'passed') continue;

      const isCiCheckFailure = typeof status.mergeNotes === 'string' &&
        status.mergeNotes.includes('failing required checks');
      const issueId = status.issueId || key;

      if (isCiCheckFailure) {
        // CI failures may be transient (pending checks, GitHub status lag).
        // Use a separate retry counter that does NOT saturate mergeRetryCount.
        const ciEntry = ciRetryMap.get(issueId) ?? { count: 0, lastAttempt: 0 };
        const timeSinceLastCi = now - ciEntry.lastAttempt;

        if (ciEntry.count >= 5) {
          // After 5 CI retries, back off to avoid hammering GitHub API.
          // Notify the work agent exactly once (when count first reaches 5) so it
          // can investigate rather than silently dead-ending the issue.
          if (ciEntry.count === 5) {
            console.log(`[deacon] CI check failure for ${issueId} — retries exhausted, notifying work agent`);
            const ciNotes = status.mergeNotes || 'CI checks are failing on the PR';
            const { writeFeedbackFile } = await import('./feedback-writer.js');
            const ciFileResult = await Effect.runPromise(writeFeedbackFile({
              issueId,
              specialist: 'merge-agent',
              outcome: 'ci-failure',
              summary: 'CI checks still failing after 5 transient retries — merge blocked',
              markdownBody: `## CI Check Failure — Merge Blocked\n\n${ciNotes}\n\n### Action Required\n\nFix the failing CI checks, commit, and push. Overdeck will detect the new commits and re-run the review pipeline automatically.\n\nAlternatively:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
            }).pipe(Effect.catch((err) => {
              console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message);
              return Effect.succeed({ success: false, error: err.message });
            })));
            const agentSession = `agent-${issueId.toLowerCase()}`;
            if (sessionExistsSync(agentSession)) {
              const ciPath = (ciFileResult as any)?.filePath;
              const ciMsg = ciPath
                ? `CI checks are failing on the PR after 5 retries.\n\nMUST READ: ${ciPath}\n\nFix the failures, commit, then run: pan done ${issueId}`
                : `CI checks are failing on the PR after 5 retries. Fix the failures, commit, then run: pan done ${issueId}`;
              await Effect.runPromise(sendKeys(agentSession, ciMsg));
            }
            ciEntry.count++; // increment past 5 so this block only fires once
            ciRetryMap.set(issueId, ciEntry);
            actions.push(`CI retry exhausted for ${issueId} — wrote feedback, notified agent`);
          } else {
            console.log(`[deacon] CI check failure for ${issueId} — max retries (5) exhausted, awaiting agent fix`);
          }
          continue;
        }
        if (timeSinceLastCi < CI_TRANSIENT_RETRY_COOLDOWN_MS) {
          continue; // still in cooldown
        }

        ciEntry.count++;
        ciEntry.lastAttempt = now;
        ciRetryMap.set(issueId, ciEntry);

        // Notify the work agent to re-submit via pan done, which re-enters the merge
        // queue from scratch. Merge is user-triggered (PAN-354) — deacon cannot
        // auto-retry; the agent must run pan done to create a fresh merge attempt.
        console.log(`[deacon] CI check failure for ${issueId} — notifying agent to re-submit (attempt ${ciEntry.count}/5)`);
        const ciNotes = status.mergeNotes || 'CI checks are failing on the PR';
        const { writeFeedbackFile } = await import('./feedback-writer.js');
        const ciFileResult2 = await Effect.runPromise(writeFeedbackFile({
          issueId,
          specialist: 'merge-agent',
          outcome: 'ci-failure',
          summary: 'CI checks failed at merge — re-submit to re-enter merge queue',
          markdownBody: `## CI Check Failure\n\n${ciNotes}\n\nCI checks failed at merge time. This may be transient (pending checks, GitHub status lag). Re-submit to re-enter the merge queue:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
        }).pipe(Effect.catch((err) => {
          console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message);
          return Effect.succeed({ success: false, error: err.message });
        })));
        const agentSessionCi = `agent-${issueId.toLowerCase()}`;
        if (sessionExistsSync(agentSessionCi)) {
          const ciPath2 = (ciFileResult2 as any)?.filePath;
          const ciMsg2 = ciPath2
            ? `CI checks failed on the PR for ${issueId}. This may be transient.\n\nMUST READ: ${ciPath2}\n\nFix any failures, commit, then run: pan done ${issueId}`
            : `CI checks failed on the PR for ${issueId}. This may be transient. Fix any failures, commit, then run: pan done ${issueId}`;
          await Effect.runPromise(sendKeys(agentSessionCi, ciMsg2));
        }
        actions.push(`CI failure notification for ${issueId} (attempt ${ciEntry.count}/5)`);
        continue;
      }

      // Timeout failures: the work agent didn't finish the rebase in time.
      // Write feedback and nudge the agent so it knows to continue/finish the rebase.
      // Then retry so the merge can proceed once the agent pushes.
      const isTimeoutFailure = typeof status.mergeNotes === 'string' &&
        (status.mergeNotes.includes('did not push') || status.mergeNotes.includes('stopped before completing'));
      if (isTimeoutFailure) {
        const issueIdForFb = status.issueId || key;
        const lastNudge = timeoutNudgeCooldowns.get(issueIdForFb);
        if (!lastNudge || (now - lastNudge) >= TIMEOUT_NUDGE_COOLDOWN_MS) {
          const timeoutNotes = status.mergeNotes!;
          const { writeFeedbackFile } = await import('./feedback-writer.js');
          await Effect.runPromise(writeFeedbackFile({
            issueId: issueIdForFb,
            specialist: 'merge-agent',
            outcome: 'timeout',
            summary: 'Merge timed out waiting for rebase — please rebase and push',
            markdownBody: `## Merge Timed Out — Rebase Required\n\n${timeoutNotes}\n\n### Action Required\n\nThe merge was requested but the rebased branch was not pushed in time. Please:\n\n1. Run \`git fetch origin\` and \`git rebase origin/main\` (or the target branch)\n2. Resolve any conflicts\n3. Run \`git push --force-with-lease\`\n4. Run \`pan done ${issueIdForFb}\`\n\nAfter pushing, the merge will be retried automatically.`,
          }).pipe(Effect.catch((err) => {
            console.error(`[deacon] Failed to write timeout feedback for ${issueIdForFb}:`, err.message);
            return Effect.void;
          })));
          const agentSession = `agent-${issueIdForFb.toLowerCase()}`;
          if (sessionExistsSync(agentSession)) {
            await Effect.runPromise(sendKeys(agentSession,
              `Merge timed out — the rebased branch was not pushed in time. Please rebase onto the target branch, resolve any conflicts, push with --force-with-lease, then run "pan done ${issueIdForFb}". After pushing, the merge will proceed automatically.`
            ));
          }
          timeoutNudgeCooldowns.set(issueIdForFb, now);
          actions.push(`Timeout failure for ${issueIdForFb} — wrote feedback, nudged work agent`);
        } else {
          actions.push(`Timeout failure for ${issueIdForFb} — nudge on cooldown (${Math.round((now - lastNudge) / 60000)}m ago)`);
        }
      }

      // Circuit breaker: max retries to avoid infinite loop on permanent failures
      const retryCount = status.mergeRetryCount || 0;
      if (retryCount >= FAILED_MERGE_MAX_RETRIES) {
        console.log(`[deacon] Failed-merge circuit breaker for ${key} (${retryCount}/${FAILED_MERGE_MAX_RETRIES} retries used)`);
        continue;
      }

      // Cooldown: wait at least 30 min after the merge failure before retrying
      if (status.updatedAt) {
        const statusAge = now - new Date(status.updatedAt).getTime();
        if (statusAge < FAILED_MERGE_RETRY_COOLDOWN_MS) continue;
      }

      // Per-issue in-memory cooldown to avoid re-triggering on the same patrol cycle
      const lastRetry = failedMergeRetryCooldowns.get(key);
      if (lastRetry && (now - lastRetry) < FAILED_MERGE_RETRY_COOLDOWN_MS) continue;

      failedMergeRetryCooldowns.set(key, now);

      const nextRetry = retryCount + 1;
      console.log(`[deacon] Auto-retrying failed merge for ${issueId} (attempt ${nextRetry}/${FAILED_MERGE_MAX_RETRIES})`);

      setReviewStatusSync(issueId, {
        mergeStatus: 'pending',
        readyForMerge: true,
        mergeRetryCount: nextRetry,
      });

      actions.push(`Reset failed merge for ${issueId} — retry ${nextRetry}/${FAILED_MERGE_MAX_RETRIES} (readyForMerge restored)`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkFailedMergeRetry:', msg);
  }

  return actions;
}

// ============================================================================
// Stale feedback cleanup (PAN-705 flywheel fix)
// ============================================================================

/**
 * Remove stale CI-failure feedback files from a workspace's .pan/feedback/ dir.
 * These accumulate when the merge-agent retries CI-blocked merges, and cause
 * the work agent to incorrectly believe CI is still failing on resume.
 */
async function clearStaleCiFeedback(issueId: string): Promise<void> {
  const { readdir, rm } = await import('fs/promises');
  const { resolveProjectFromIssueSync } = await import('../projects.js');
  const projectConfig = resolveProjectFromIssueSync(issueId);
  if (!projectConfig) return;

  const repoDir = projectConfig.projectPath;
  if (!repoDir) return;

  // Find the workspace directory: workspaces/feature-<issueLower> under the repo
  const issueLower = issueId.toLowerCase();
  const feedbackDir = join(repoDir, 'workspaces', `feature-${issueLower}`, '.pan', 'feedback');

  try {
    if (!existsSync(feedbackDir)) return;
    const files = await readdir(feedbackDir);
    for (const file of files) {
      if (file.includes('merge-agent') && file.includes('ci-failure') && file.endsWith('.md')) {
        await rm(join(feedbackDir, file));
        console.log(`[deacon] Cleared stale CI feedback: ${file} for ${issueId}`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[deacon] Could not clear stale CI feedback for ${issueId}: ${message}`);
  }
}

// Track per-issue cooldowns for dead-end recovery to avoid spamming
const deadEndCooldowns = new Map<string, number>();

// Minimum time (ms) after status update before dead-end detection intervenes
const DEAD_END_STALENESS_MS = 5 * 60 * 1000; // 5 minutes
// Cooldown between successive dead-end recovery attempts for the same issue
const DEAD_END_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Detect dead-end agents: review blocked, tests failed, or merge failed (CI)
 * but work agent is idle.
 *
 * This happens when:
 * - Review feedback was delivered with a wrong URL (now fixed, but old feedback persists)
 * - Agent forgot how to resubmit (context compaction lost instructions)
 * - Feedback delivery to tmux failed silently
 * - Merge failed due to CI checks (now handled in checkFailedMergeRetry by routing
 *   to the work agent with feedback; dead-end catches cases where the agent is idle)
 *
 * Recovery: re-queue the review via the request-review API endpoint and
 * send the agent a nudge message with the correct resubmit command.
 * For CI-blocked merges: clear the stale merge failure and feedback files.
 */
export async function checkDeadEndAgents(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();

    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on blocked/failed reviews, failed tests, or CI-blocked merges.
      // 'failed' covers verification gate errors (e.g. JSON parse error in `.pan/spec.vbrief.json`)
      // that prevent the review specialist from running at all.
      const isReviewBlocked = status.reviewStatus === 'blocked' || status.reviewStatus === 'failed';
      const isVerificationFailed = status.verificationStatus === 'failed';
      const isTestFailed = status.testStatus === 'failed';
      const isMergeCiFailed = status.mergeStatus === 'failed' &&
        typeof status.mergeNotes === 'string' &&
        status.mergeNotes.includes('failing required checks');
      if (!isReviewBlocked && !isVerificationFailed && !isTestFailed && !isMergeCiFailed) continue;

      // Skip merged/completed issues
      if (status.mergeStatus === 'merged' || status.readyForMerge) continue;

      // Check staleness: status must have been set at least 5 min ago
      if (status.updatedAt) {
        const statusAge = now - new Date(status.updatedAt).getTime();
        if (statusAge < DEAD_END_STALENESS_MS) continue;
      }

      // Check per-issue cooldown
      const lastRecovery = deadEndCooldowns.get(key);
      if (lastRecovery && (now - lastRecovery) < DEAD_END_COOLDOWN_MS) continue;

      // Circuit breaker: don't intervene if already at max requeues
      const autoRequeueCount = status.autoRequeueCount || 0;
      if (autoRequeueCount >= 25) {
        console.log(`[deacon] Dead-end detected for ${key} but circuit breaker active (${autoRequeueCount}/25 requeues used)`);
        continue;
      }

      // CI-blocked merges have their own retry circuit breaker in checkFailedMergeRetry().
      // Once that counter is saturated, only a new commit should reset the merge path.
      if (isMergeCiFailed && (status.mergeRetryCount || 0) >= FAILED_MERGE_MAX_RETRIES) {
        console.log(`[deacon] Dead-end detected for ${key} but merge retry ceiling is saturated (${status.mergeRetryCount}/${FAILED_MERGE_MAX_RETRIES})`);
        continue;
      }

      // The review-status map key is the authoritative issue identifier.
      // Persisted payloads can carry stale/mismatched status.issueId values after
      // retries or manual edits; using the key keeps recovery actions targeted to
      // the actual status entry being processed.
      const issueId = key;
      const agentSessionName = `agent-${issueId.toLowerCase()}`;

      if (!sessionExistsSync(agentSessionName)) {
        // No agent session — nothing to recover
        continue;
      }

      // Check if agent is idle via Stop hook state (authoritative idle signal)
      if (!isAgentIdleForNudge(agentSessionName)) {
        // Agent is still working or has no hook state — let it finish
        continue;
      }

      // Agent is idle with a blocked/failed status — this is a dead end
      let statusType: string;
      if (isReviewBlocked) {
        statusType = status.reviewStatus === 'failed' ? 'review failed' : 'review blocked';
      } else if (isVerificationFailed) {
        statusType = status.reviewStatus === 'pending'
          ? 'verification failed while review pending'
          : 'verification failed';
      } else if (isTestFailed) {
        statusType = 'tests failed';
      } else {
        statusType = 'merge CI blocked';
      }
      console.log(`[deacon] Dead-end detected: ${key} (${statusType}) with idle agent ${agentSessionName}`);

      // Record cooldown before taking action
      deadEndCooldowns.set(key, now);

      // For merge CI-blocked: clear the stale merge failure, clean up stale
      // CI-failure feedback files, and set readyForMerge so the merge flow can re-enter.
      if (isMergeCiFailed) {
        setReviewStatusSync(issueId, {
          mergeStatus: 'pending',
          readyForMerge: true,
        });
        // Reset CI retry counter so the next CI failure re-enters at attempt 1/5
        // instead of silently dead-ending due to the exhausted retry count.
        ciRetryMap.delete(issueId);
        // Clean up accumulated stale feedback so the work agent doesn't read them
        await clearStaleCiFeedback(issueId).catch(() => {});
        console.log(`[deacon] Cleared stale CI-blocked merge for ${issueId} — reset to readyForMerge`);
        actions.push(`Dead-end recovery: cleared CI-blocked merge for ${issueId} (${statusType}, idle for ${Math.round((now - new Date(status.updatedAt || '').getTime()) / 60000)}m)`);
        continue;
      }

      // Resolve latest feedback file for targeted nudge
      let latestFeedbackPath: string | undefined;
      try {
        const resolved = resolveProjectFromIssueSync(issueId);
        if (resolved) {
          const wsPath = findWorkspacePath(resolved.projectPath, issueId.toLowerCase());
          if (wsPath) {
            const feedbackDir = join(wsPath, '.pan', 'feedback');
            if (existsSync(feedbackDir)) {
              const files = (await readdir(feedbackDir)).filter(f => f.endsWith('.md')).sort();
              if (files.length > 0) {
                latestFeedbackPath = join(feedbackDir, files[files.length - 1]);
              }
            }
          }
        }
      } catch {
        // ignore resolution errors
      }

      // Send the agent a nudge message with the correct resubmit command
      try {
        const feedbackPart = latestFeedbackPath
          ? `\n\nMUST READ: ${latestFeedbackPath}\n\nUse your Read tool to open this file, read every line, then fix the issues.`
          : '';
        const nudgeMessage = status.reviewStatus === 'failed'
          ? `Review verification failed for ${issueId}.${feedbackPart}\n\nCommon cause: merge conflict markers in .pan/spec.vbrief.json — fix by resolving conflicts in that file, then run: pan review request ${issueId} -m "Fixed verification error"`
          : isReviewBlocked
            ? `The review agent found issues in your code.${feedbackPart}\n\nFix every issue listed, commit all changes, then run: pan review request ${issueId} -m "Fixed review issues". Do NOT stop until pan review request completes successfully.`
            : isVerificationFailed
              ? `Verification failed for ${issueId} while review is pending.${feedbackPart}\n\nFix the failing verification check, commit every change, push your branch, then request a new review with: pan review request ${issueId} -m "Fixed verification failure". Do NOT stop until pan review request completes successfully.`
              : `Tests failed for your changes.${feedbackPart}\n\nFix the failures, commit, then run: pan review request ${issueId} -m "Fixed test failures". Do NOT stop until pan review request completes successfully.`;

        await Effect.runPromise(sendKeys(agentSessionName, nudgeMessage));
        actions.push(`Dead-end recovery: nudged ${agentSessionName} (${statusType}, idle for ${Math.round((now - new Date(status.updatedAt || '').getTime()) / 60000)}m)`);
        console.log(`[deacon] Sent dead-end recovery nudge to ${agentSessionName}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Failed to send dead-end nudge to ${agentSessionName}:`, msg);
        actions.push(`Dead-end recovery failed for ${agentSessionName}: ${msg}`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in dead-end detection:', msg);
  }

  return actions;
}

async function reconcileAndCheckIfMerged(
  issueId: string,
  cycleCache?: Map<string, boolean>,
): Promise<boolean> {
  const cacheKey = issueId.toUpperCase();
  const cached = cycleCache?.get(cacheKey);
  if (cached !== undefined) return cached;
  const remember = (result: boolean): boolean => {
    cycleCache?.set(cacheKey, result);
    return result;
  };

  const reviewStatus = getReviewStatusSync(issueId);
  if (reviewStatus?.mergeStatus === 'merged') {
    return remember(true);
  }

  if (reviewStatus?.prUrl) {
    const prRef = reviewStatus.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (prRef) {
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
        if (isGitHubAppConfigured()) {
          const prState = await Effect.runPromise(getPullRequestState(prRef[1], prRef[2], Number.parseInt(prRef[3], 10)));
          if (prState.merged) {
            setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false, mergeNotes: undefined });
            // PAN-1027: also run the post-merge handoff so labels get cleaned and the
            // work-agent tmux session is killed. Without this, GitHub-detected merges
            // leave stale "in-progress" / "in-review" labels and leaked tmux sessions.
            try {
              const resolved = resolveProjectFromIssueSync(issueId);
              if (resolved) {
                const branch = `feature/${issueId.toLowerCase()}`;
                const { postMergeLifecycle } = await import('./merge-agent.js');
                postMergeLifecycle(issueId, resolved.projectPath, branch, { skipDeploy: true }).catch(err =>
                  console.warn(`[deacon] postMergeLifecycle (gh-reconcile) failed for ${issueId}: ${err}`)
                );
              }
            } catch (err) {
              console.warn(`[deacon] Could not run post-merge handoff for ${issueId}: ${err}`);
            }
            return remember(true);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[deacon] Failed GitHub merge reconciliation for ${issueId}: ${message}`);
      }
    }
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    return remember(false);
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project?.tracker) {
    return remember(false);
  }

  try {
    const { createTracker } = await import('../tracker/factory.js');
    const overdeckConfig = await import('../config.js');
    const globalTrackerConfig = overdeckConfig.loadConfigSync().trackers;

    let trackerConfig: TrackerConfig | null = null;
    if (project.tracker === 'github' && project.github_repo) {
      const [owner, repo] = project.github_repo.split('/');
      if (!owner || !repo) {
        console.warn(`[deacon] Cannot reconcile ${issueId}: invalid GitHub repo config for ${resolved.projectKey}`);
        return remember(false);
      }
      trackerConfig = {
        type: 'github',
        owner,
        repo,
        tokenEnv: globalTrackerConfig.github?.token_env,
      };
    } else if (project.tracker === 'gitlab' && project.gitlab_repo) {
      trackerConfig = {
        type: 'gitlab',
        projectId: project.gitlab_repo,
        tokenEnv: globalTrackerConfig.gitlab?.token_env,
      };
    } else if (project.tracker === 'linear') {
      trackerConfig = {
        type: 'linear',
        apiKeyEnv: globalTrackerConfig.linear?.api_key_env,
        team: resolved.linearTeam,
      };
    } else if (project.tracker === 'rally') {
      trackerConfig = {
        type: 'rally',
        apiKeyEnv: globalTrackerConfig.rally?.api_key_env,
        server: globalTrackerConfig.rally?.server,
        workspace: globalTrackerConfig.rally?.workspace,
        project: project.rally_project ?? globalTrackerConfig.rally?.project,
      };
    }

    if (!trackerConfig) {
      console.warn(`[deacon] Cannot reconcile ${issueId}: incomplete tracker config for ${resolved.projectKey}`);
      return remember(false);
    }

    if (project.tracker === 'github') {
      return remember(false);
    }

    const tracker = createTracker(trackerConfig);
    await Effect.runPromise(tracker.getIssue(issueId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[deacon] Failed tracker merge reconciliation for ${issueId}: ${message}`);
  }

  return remember(false);
}

// Track per-agent cooldowns for first-completion nudges
const firstCompletionCooldowns = new Map<string, number>();
const FIRST_COMPLETION_IDLE_MS = 10 * 60 * 1000; // 10 minutes idle before nudging
const FIRST_COMPLETION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between nudges

function isVerifyPausedAgentState(state: Pick<AgentState, 'issueId' | 'paused'>): boolean {
  if (state.paused !== true || !state.issueId) return false;
  return getReviewStatusSync(state.issueId)?.mergeStatus === 'merged';
}

function reviewArtifactExistsForRun(path: string | undefined, startedAt: string | undefined): boolean {
  if (!path || !existsSync(path)) return false;
  const startedMs = Date.parse(startedAt ?? '');
  if (!Number.isFinite(startedMs)) return true;
  try {
    return statSync(path).mtimeMs >= startedMs;
  } catch {
    return false;
  }
}

function hasCompletedReviewArtifact(state: AgentState): boolean {
  if (state.role !== 'review') return false;
  if (state.reviewSubRole) {
    return reviewArtifactExistsForRun(state.reviewOutputPath, state.startedAt);
  }
  if (!state.workspace || !state.reviewRunId) return false;
  return reviewArtifactExistsForRun(join(state.workspace, '.pan', 'review', state.reviewRunId, 'synthesis.md'), state.startedAt);
}

// Cache for auto-close-out canonical state queries to avoid N+1 shell execs on patrol
const autoCloseOutCache = new Map<string, { state: string | null; timestamp: number }>();
const AUTO_CLOSE_OUT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sweepAutoCloseOutCache(): void {
  const now = Date.now();
  for (const [issueId, entry] of autoCloseOutCache.entries()) {
    if (now - entry.timestamp > AUTO_CLOSE_OUT_CACHE_TTL_MS) {
      autoCloseOutCache.delete(issueId);
    }
  }
}

async function getAutoCloseOutCanonicalState(issueId: string): Promise<string | null> {
  const cached = autoCloseOutCache.get(issueId);
  if (cached && Date.now() - cached.timestamp < AUTO_CLOSE_OUT_CACHE_TTL_MS) {
    return cached.state;
  }

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    autoCloseOutCache.set(issueId, { state: null, timestamp: Date.now() });
    return null;
  }

  try {
    const { stdout } = await execFileAsync('gh', [
      'issue',
      'view',
      String(ghResolved.number),
      '--repo',
      `${ghResolved.owner}/${ghResolved.repo}`,
      '--json',
      'state,labels',
    ], { encoding: 'utf-8' });
    const parsed = JSON.parse(stdout) as { state?: string; labels?: Array<string | { name?: string }> };
    const labels = (parsed.labels ?? [])
      .map(label => typeof label === 'string' ? label : label.name)
      .filter((label): label is string => typeof label === 'string');
    const result = mapGitHubStateToCanonical(parsed.state ?? 'open', labels);
    autoCloseOutCache.set(issueId, { state: result, timestamp: Date.now() });
    return result;
  } catch {
    autoCloseOutCache.set(issueId, { state: null, timestamp: Date.now() });
    return null;
  }
}

function recordAutoCloseOutFailure(issueId: string, message: string): void {
  console.warn(`[deacon] Auto close-out failed for ${issueId}: ${message}`);
  setReviewStatusSync(issueId, {
    mergeNotes: `Auto close-out failed: ${message}`,
    updatedAt: new Date().toISOString(),
  });
  emitActivityEntrySync({
    source: 'cloister',
    level: 'warn',
    issueId,
    message: `Auto close-out failed for ${issueId}: ${message}`,
  });
}

export async function autoCloseOut(now = new Date()): Promise<string[]> {
  const closeOutConfig = (await Effect.runPromise(loadCloisterConfig())).close_out;
  if (closeOutConfig?.auto !== true) return [];

  // Evict stale cache entries before each patrol cycle
  sweepAutoCloseOutCache();

  const delayMinutes = Math.max(0, closeOutConfig.auto_delay_minutes ?? 60);
  const cutoff = now.getTime() - delayMinutes * 60 * 1000;
  const actions: string[] = [];
  const statuses = loadReviewStatuses();

  const candidates: Array<{ issueId: string }> = [];
  for (const [key, status] of Object.entries(statuses)) {
    const issueId = (status.issueId || key).toUpperCase();
    if (status.mergeStatus !== 'merged') continue;
    if (status.stuck || status.deaconIgnored) continue;

    const updatedAt = Date.parse(status.updatedAt || '');
    if (!Number.isFinite(updatedAt) || updatedAt > cutoff) continue;

    candidates.push({ issueId });
  }

  const tasks = candidates.map(({ issueId }) => Effect.tryPromise({
    try: async () => {
    let canonicalState: string | null;
    try {
      canonicalState = await getAutoCloseOutCanonicalState(issueId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }
    if (canonicalState !== 'verifying_on_main') return null;

    const resolvedProject = resolveProjectFromIssueSync(issueId);
    if (!resolvedProject) {
      const message = 'no project configured';
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }

    const ghResolved = resolveGitHubIssueSync(issueId);
    const ctx = {
      issueId,
      projectPath: resolvedProject.projectPath,
      auto: true,
      ...(ghResolved.isGitHub
        ? { github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
        : {}),
    };

    try {
      const { closeOut } = await import('../lifecycle/workflows.js');
      // PAN-1249: closeOut returns Effect<WorkflowResult>; bridge to Promise.
      const result = await Effect.runPromise(closeOut(ctx));
      if (!result.success) {
        const failed = result.steps.find(step => !step.success && !step.skipped);
        throw new Error(failed?.error ?? 'closeOut workflow failed');
      }
      const message = `Auto close-out completed for ${issueId}`;
      console.log(`[deacon] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', issueId, message });
      return message;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }
    },
    catch: (cause) => cause,
  }));

  const results = await Effect.runPromise(withConcurrencyLimit(tasks, 5));
  for (const result of results) {
    if (result !== null) actions.push(result);
  }

  return actions;
}

/**
 * Detect work agents that finished implementation but never called `pan done`.
 *
 * This is the Layer 3 safety net. Layer 2 (work-agent-stop-hook) should catch most
 * cases within seconds of the agent going idle. This catches agents where the stop-hook
 * failed, was skipped, or where the AI analysis was inconclusive.
 *
 * Heuristics: agent is idle for >10 minutes, no completion marker exists, no review
 * status exists (meaning it never entered the specialist pipeline), and the agent
 * has committed code (git log shows commits on the feature branch).
 */
export async function checkFirstCompletionAgents(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgentsSync();
    const now = Date.now();

    for (const agent of agents) {
      // Only check work agents (agent-min-XXX, agent-pan-XXX)
      // Guard against agents with undefined id (planning agents, test artifacts, etc.)
      const agentId = agent.id;
      if (!agentId || !agentId.startsWith('agent-') || !agent.tmuxActive) continue;
      if (agentId.startsWith('specialist-')) continue;

      // Skip if completion marker already exists (or was already processed by cloister)
      const completedFile = join(AGENTS_DIR, agent.id, 'completed');
      const processedMarker = join(AGENTS_DIR, agent.id, 'completed.processed');
      if (existsSync(completedFile) || existsSync(processedMarker)) continue;

      // Check idle duration and idle state via Stop hook
      // isAgentIdleForNudge uses FIRST_COMPLETION_IDLE_MS as the stale-active threshold:
      // if the agent's heartbeat is older than the idle minimum, it's safe to treat as idle.
      if (!isAgentIdleForNudge(agent.id, FIRST_COMPLETION_IDLE_MS)) continue;

      const runtimeState = getAgentRuntimeStateSync(agent.id)!;
      const lastActivity = new Date(runtimeState.lastActivity);
      const idleMs = now - lastActivity.getTime();
      if (idleMs < FIRST_COMPLETION_IDLE_MS) continue;

      // Check cooldown
      const lastNudge = firstCompletionCooldowns.get(agent.id);
      if (lastNudge && (now - lastNudge) < FIRST_COMPLETION_COOLDOWN_MS) continue;

      // HARD GATE: Never nudge agents that have been through the review pipeline.
      // Check review-status.json — if ANY entry exists for this issue, the agent
      // has entered the specialist pipeline and must NOT receive a "pan done" nudge.
      // (Dead-end detection handles agents stuck in review/test cycles.)
      const issueId = agent.issueId || agent.id.replace('agent-', '').toUpperCase();
      const issueKey = issueId.toLowerCase();
      try {
        const statuses = loadReviewStatuses();
        // Keys are stored in original case (e.g., "MIN-727") — check all case variants
        const hasStatus = statuses[issueKey] || statuses[issueId] || statuses[issueId.toUpperCase()];
        if (hasStatus) {
          console.log(`[deacon] First-completion gate: skipping ${agent.id} — has review status entry (readyForMerge=${hasStatus.readyForMerge ?? false})`);
          continue;
        }
      } catch { /* load error, proceed with check */ }

      // HARD GATE: Also check for review feedback files in the workspace.
      // If a feedback directory exists and is non-empty, a review agent has already
      // processed this workspace — never send a "pan done" nudge.
      const agentStateForGate = getAgentStateSync(agent.id);
      if (agentStateForGate?.workspace) {
        const feedbackDir = join(agentStateForGate.workspace, '.pan', 'feedback');
        if (existsSync(feedbackDir)) {
          try {
            const feedbackFiles = readdirSync(feedbackDir);
            if (feedbackFiles.length > 0) {
              console.log(`[deacon] First-completion gate: skipping ${agent.id} — has ${feedbackFiles.length} review feedback file(s) in .pan/feedback/`);
              continue;
            }
          } catch { /* can't read feedback dir */ }
        }
      }

      // PAN-1185: SWARM slot agents must NOT receive issue-level `pan done`
      // nudges. They work on a single plan item; the issue-level done flow opens
      // a premature feature → main PR. Detect slots by workspace path suffix
      // `-slot-N/` — the workspace dir convention is stable across PAN-1176.
      if (agentStateForGate?.workspace && /-slot-\d+\/?$/.test(agentStateForGate.workspace)) {
        console.log(`[deacon] First-completion gate: skipping ${agent.id} — SWARM slot agent (workspace: ${agentStateForGate.workspace})`);
        continue;
      }

      // Check if the agent has commits (sign that work was done)
      const agentState = getAgentStateSync(agent.id);
      if (!agentState?.workspace || !existsSync(agentState.workspace)) continue;

      // For polyrepo workspaces, check inside sub-repos (fe/, api/, etc.)
      // For monorepo workspaces, check the workspace root directly
      let hasCommits = false;
      try {
        const { stdout: gitLog } = await execAsync(
          'git log --oneline -3 2>/dev/null',
          { cwd: agentState.workspace }
        );
        hasCommits = gitLog.trim().length > 0;
      } catch {
        // Workspace root may not be a git repo (polyrepo) — check subdirectories
        try {
          const subdirs = readdirSync(agentState.workspace, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));
          for (const sub of subdirs) {
            try {
              const { stdout: subLog } = await execAsync(
                'git log --oneline -3 2>/dev/null',
                { cwd: join(agentState.workspace, sub.name) }
              );
              if (subLog.trim().length > 0) {
                hasCommits = true;
                break;
              }
            } catch { /* not a git repo */ }
          }
        } catch { /* can't read workspace dir */ }
      }
      if (!hasCommits) continue; // No commits — agent may not have started yet

      // All heuristics passed: agent likely forgot pan done
      const idleMinutes = Math.round(idleMs / 60000);
      console.log(`[deacon] First-completion gap detected: ${agent.id} (${issueId}) idle for ${idleMinutes}m with commits but no completion marker`);

      firstCompletionCooldowns.set(agent.id, now);

      try {
        const nudgeMessage = `You appear to have stopped working without calling \`pan done\`. If your implementation is complete, run this now:\n\npan done ${issueId} -c "Implementation complete"\n\nIf you still have remaining tasks, continue working on them.`;
        await Effect.runPromise(sendKeys(agent.id, nudgeMessage));
        actions.push(`First-completion nudge: ${agent.id} (idle ${idleMinutes}m)`);
        console.log(`[deacon] Sent first-completion nudge to ${agent.id}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Failed to send first-completion nudge to ${agent.id}:`, msg);
      }
    }
  } catch (error: unknown) {
    console.error('[deacon] Error in first-completion detection:', error);
  }

  return actions;
}

// PAN-650: Bounded poking for stuck agents.
// Without these limits, the patrol fires every 60s and re-sends the same poke
// forever, eating tokens overnight. Cap pokes and require cooldown between them;
// after the cap, transition resolution → 'abandoned' so the agent falls out of
// the patrol filter and surfaces in the dashboard for human attention.
const STUCK_POKE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between pokes
const STUCK_POKE_MAX = 3;                       // Max pokes before abandoning
const stuckPokeState: Map<string, { lastPoke: number; pokes: number }> = new Map();

/**
 * Patrol work agent resolution fields (PAN-309).
 *
 * For each running work agent:
 * - resolution === 'done' && count >= 2: auto-complete via pan done
 * - resolution === 'stuck' && count >= 3: send a poke (rate-limited, capped — PAN-650)
 */
export async function patrolWorkAgentResolutions(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgentsSync();
    // Specialist sessions (global or per-project) use the specialist tmux prefix.
    const isSpecialistSession = (id: string) => id.startsWith('specialist-');

    for (const agent of agents) {
      if (!agent.id.startsWith('agent-') || isSpecialistSession(agent.id)) continue;

      const runtimeState = getAgentRuntimeStateSync(agent.id);
      if (!runtimeState?.resolution || runtimeState.resolution === 'working' || runtimeState.resolution === 'completed' || runtimeState.resolution === 'abandoned') continue;

      const resolution = runtimeState.resolution;
      const count = runtimeState.resolutionCount || 0;
      const issueId = (agent.issueId || agent.id.replace('agent-', '')).toUpperCase();

      // PAN-653: Skip workspaces marked stuck — Deacon must not poke/respawn them.
      // Keyed by issueId (not agentId) so respawned agents with new IDs still match.
      const resolutionReviewStatus = getReviewStatusSync(issueId);
      if (resolutionReviewStatus?.stuck) {
        console.log(`[deacon] Skipping stuck workspace ${issueId} in patrolWorkAgentResolutions`);
        continue;
      }
      if (resolutionReviewStatus?.deaconIgnored) {
        console.log(`[deacon] Skipping deacon-ignored workspace ${issueId} in patrolWorkAgentResolutions`);
        continue;
      }

      if (resolution === 'done' && count >= 1) {
        // PAN-534: lowered from >= 2 to >= 1. A single done signal is sufficient
        // evidence. The old threshold deadlocked when review failed and reset to
        // pending — the agent never re-signaled done, so count stayed at 1 forever.
        console.log(`[deacon] Auto-completing ${agent.id} (${issueId}): resolution=done, count=${count}`);

        try {
          // Find pan binary
          const panBin = join(OVERDECK_HOME, 'bin', 'pan');
          const binExists = existsSync(panBin);
          const bin = binExists ? panBin : 'pan';

          await execFileAsync(bin, ['work', 'done', issueId, '-c', 'Auto-completed by Deacon: evidence showed work complete after 2 nudges'], {
            timeout: 30000,
          });

          // Mark as completed in runtime.json
          saveAgentRuntimeState(agent.id, {
            resolution: 'completed',
            resolutionCount: count + 1,
            resolutionUpdatedAt: new Date().toISOString(),
          });

          actions.push(`Deacon auto-completed ${issueId} (${agent.id}) after ${count} failed nudges`);
          addLog('action', `Auto-completed ${issueId}: evidence-complete, ${count} nudges exhausted`, undefined);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[deacon] Failed to auto-complete ${agent.id}:`, msg);
          actions.push(`Deacon auto-complete failed for ${agent.id}: ${msg}`);
        }

      } else if (resolution === 'stuck' && count >= 3) {
        // Agent is stuck — send a poke to unstick it.
        // Rate-limit to STUCK_POKE_COOLDOWN_MS and cap at STUCK_POKE_MAX (PAN-650).
        const now = Date.now();
        const pokeState = stuckPokeState.get(agent.id) ?? { lastPoke: 0, pokes: 0 };

        if (now - pokeState.lastPoke < STUCK_POKE_COOLDOWN_MS) continue;

        if (pokeState.pokes >= STUCK_POKE_MAX) {
          // Exhausted poke budget — abandon the agent so it stops being patrolled
          // and surfaces in the dashboard for human intervention.
          console.log(`[deacon] Abandoning stuck agent ${agent.id} (${issueId}) after ${pokeState.pokes} pokes`);
          saveAgentRuntimeState(agent.id, {
            resolution: 'abandoned',
            resolutionCount: count,
            resolutionUpdatedAt: new Date().toISOString(),
          });
          stuckPokeState.delete(agent.id);
          actions.push(`Deacon abandoned stuck agent ${agent.id} (${issueId}) after ${STUCK_POKE_MAX} pokes`);
          addLog('warn', `Abandoned stuck agent ${issueId} after ${STUCK_POKE_MAX} pokes — needs human attention`, undefined);
          continue;
        }

        console.log(`[deacon] Poking stuck agent ${agent.id} (${issueId}): poke ${pokeState.pokes + 1}/${STUCK_POKE_MAX}`);

        try {
          const pokeMsg = `Deacon health check (${pokeState.pokes + 1}/${STUCK_POKE_MAX}): you appear stuck. Please check your current task status, review any errors, and continue working. If work is complete, run: pan done ${issueId} -c "Implementation complete"`;
          await Effect.runPromise(sendKeys(agent.id, pokeMsg));
          stuckPokeState.set(agent.id, { lastPoke: now, pokes: pokeState.pokes + 1 });
          actions.push(`Deacon poked stuck agent ${agent.id} (${issueId}) [${pokeState.pokes + 1}/${STUCK_POKE_MAX}]`);
          addLog('action', `Poked stuck agent ${issueId} (poke ${pokeState.pokes + 1}/${STUCK_POKE_MAX})`, undefined);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[deacon] Failed to poke ${agent.id}:`, msg);
        }
      }
    }
  } catch (error: unknown) {
    console.error('[deacon] Error in patrolWorkAgentResolutions:', error);
  }

  return actions;
}

// PAN-464: Container restart backoff configuration
const CONTAINER_RESTART_BACKOFF_MS = 60_000;   // Minimum 60s between restart attempts
const CONTAINER_RESTART_MAX_COUNT = 5;          // Give up after 5 restarts
const CONTAINER_RESTART_WINDOW_MS = 30 * 60_000; // Reset burst count after 30 min of quiet

/**
 * PAN-464: Compute exponential backoff delay for a container given its restart history.
 * Returns delay in ms. Delay doubles each attempt: 60s, 120s, 240s, 480s, max 5 min.
 */
export function containerRestartBackoffMs(count: number): number {
  const base = CONTAINER_RESTART_BACKOFF_MS;
  const max = 5 * 60_000; // 5 minutes cap
  return Math.min(base * Math.pow(2, count - 1), max);
}

/**
 * PAN-464: Kill orphaned host processes (e.g., Vite, node) for a workspace path.
 * Orphaned Vite watchers exhaust inotify handles, causing ENOSPC in containers.
 * Runs before restarting the container so the root cause is cleared.
 *
 * CRITICAL: Must not kill the active work agent's process tree. The agent's tmux
 * pane runs bash+claude with cwd=workspace, so lsof +D returns it. We collect the
 * tmux pane PIDs for agent and planning sessions matching this workspace and exclude
 * them + all descendants from the kill list.
 */
async function killOrphanedWorkspaceProcesses(workspacePath: string): Promise<void> {
  try {
    // 1. Collect tmux pane PIDs for agent sessions in this workspace
    const protectedPids = new Set<string>([String(process.pid)]);
    try {
      const sessions = await Effect.runPromise(listSessionNames());
      const agentSessions = sessions.filter(s => s.startsWith('agent-') || s.startsWith('planning-'));
      for (const session of agentSessions) {
        try {
          const pid = (await Effect.runPromise(listPaneValues(session, '#{pane_pid}')))[0]?.trim();
          if (pid && /^\d+$/.test(pid)) {
            // Add the pane PID and all its descendants to protected list
            protectedPids.add(pid);
            try {
              const { stdout: descendants } = await execAsync(
                `pgrep -P ${pid} 2>/dev/null; ps -o pid= --ppid ${pid} 2>/dev/null | xargs -I{} pgrep -P {} 2>/dev/null`,
                { encoding: 'utf-8', timeout: 3000 },
              );
              for (const d of descendants.trim().split(/\s+/)) {
                if (d && /^\d+$/.test(d)) protectedPids.add(d);
              }
              // Also walk the full descendant tree
              const { stdout: allDesc } = await execAsync(
                `pstree -p ${pid} 2>/dev/null | grep -oE '\\([0-9]+\\)' | tr -d '()' || true`,
                { encoding: 'utf-8', timeout: 3000 },
              );
              for (const d of allDesc.trim().split('\n')) {
                if (d && /^\d+$/.test(d.trim())) protectedPids.add(d.trim());
              }
            } catch { /* non-fatal */ }
          }
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }

    // 2. Find processes with files open in the workspace
    const { stdout } = await execAsync(
      `lsof +D "${workspacePath}" -t 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 },
    );
    const pids = stdout.trim().split('\n').filter(Boolean).map(p => p.trim()).filter(p => /^\d+$/.test(p));

    // 3. Filter out protected PIDs (agent tmux panes and descendants)
    //    AND Docker container processes — they have files open via volume mounts
    //    but are legitimate; killing them causes container exit → restart loop.
    const { readFile } = await import('fs/promises');
    const isDockerContainerProcess = async (pid: string): Promise<boolean> => {
      try {
        const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf-8');
        return cgroup.includes('/docker-') || cgroup.includes('/docker/');
      } catch {
        return false;
      }
    };
    const safePids: string[] = [];
    for (const pid of pids) {
      if (protectedPids.has(pid)) continue;
      if (await isDockerContainerProcess(pid)) continue;
      safePids.push(pid);
    }

    if (safePids.length > 0) {
      await execAsync(`kill ${safePids.join(' ')} 2>/dev/null || true`, { encoding: 'utf-8', timeout: 5000 });
      console.log(`[deacon] Killed ${safePids.length} orphaned process(es) in ${workspacePath} before container restart (protected ${protectedPids.size - 1} agent PIDs)`);
    }
  } catch {
    // Non-fatal — proceed with restart even if cleanup fails
  }
}

/**
 * PAN-464: Check Docker container health for active workspaces.
 * Crashed containers (e.g., Vite ENOSPC) break the UAT environment.
 * Auto-restarts them with exponential backoff (60s → 120s → 240s → 5 min cap).
 * Gives up after 5 restarts within 30 minutes to avoid restart loops.
 * Kills orphaned host processes before restarting to fix the inotify root cause.
 */
export async function checkWorkspaceContainerHealth(sharedState?: DeaconState): Promise<string[]> {
  const actions: string[] = [];
  try {
    // Find all workspace-related containers that are exited (crashed)
    const { stdout } = await execAsync(
      'docker ps -a --filter "status=exited" --filter "name=overdeck-feature-" --format "{{.Names}}|{{.Status}}" 2>/dev/null || true',
      { encoding: 'utf-8', timeout: 10000 },
    );
    const crashed = stdout.trim().split('\n').filter(Boolean);
    if (crashed.length === 0) return actions;

    const state = sharedState ?? loadState();
    if (!state.containerRestarts) state.containerRestarts = {};
    let stateDirty = false;

    const now = Date.now();

    for (const line of crashed) {
      const [name, status] = line.split('|');
      if (!name) continue;

      // Init containers are one-shot by design — they run setup, exit, and stay exited.
      // Restarting them is meaningless and floods agents with bogus "container crashed" alerts.
      // Match service containers only (frontend/server), not init.
      const match = name.match(/overdeck-feature-([\w-]+?)-(frontend|server)-/);
      if (!match) continue;

      // Skip clean shutdowns (exit code 0). Status format: "Exited (N) X minutes ago".
      // A service container exiting 0 is intentional (e.g., post-merge teardown), not a crash.
      const exitMatch = status?.match(/Exited \((\d+)\)/);
      if (exitMatch && exitMatch[1] === '0') continue;

      const issueLower = match[1];
      const containerType = match[2];

      // Init containers are one-shot setup jobs — a clean exit (code 0) is not a crash.
      // Restarting them causes an infinite loop: they complete, exit 0, get restarted, repeat.
      if (containerType === 'init') continue;

      const agentId = `agent-${issueLower}`;

      // Only restart if the agent is active (has a tmux session)
      const agentRunning = await Effect.runPromise(sessionExists(agentId));
      if (!agentRunning) {
        // Agent not running — skip restart
        continue;
      }

      // PAN-464: Backoff / give-up logic
      const record = state.containerRestarts[name];
      if (record) {
        const windowStart = now - CONTAINER_RESTART_WINDOW_MS;
        const firstRestartMs = new Date(record.firstRestart).getTime();

        // Reset burst counter if the last restart was > 30 min ago (container ran stably for a while)
        if (firstRestartMs < windowStart) {
          delete state.containerRestarts[name];
          stateDirty = true;
        } else {
          // Still within the burst window
          if (record.gaveUp) {
            console.log(`[deacon] Container ${name} exceeded max restarts — skipping (gave up)`);
            continue;
          }
          // Check max count BEFORE backoff — if we've hit the limit, give up regardless of timing
          if (record.count >= CONTAINER_RESTART_MAX_COUNT) {
            record.gaveUp = true;
            stateDirty = true;
            const msg = `[deacon] Container ${name} exceeded max restarts (${CONTAINER_RESTART_MAX_COUNT}) — giving up`;
            console.warn(msg);
            actions.push(msg);
            // PAN-464: Alert agent that the container gave up — manual intervention required
            try {
              await Effect.runPromise(sendKeys(
                agentId,
                `⚠️  Deacon alert: container "${name}" has crashed ${CONTAINER_RESTART_MAX_COUNT} times and auto-restart gave up. The UAT environment at feature-${issueLower}.pan.localhost may be broken. Manual intervention required — check docker logs or re-containerize.`,
                'deacon:container-gave-up',
              ));
            } catch {
              // Agent may not be interactive (e.g., waiting for input) — non-fatal
            }
            continue;
          }
          const backoffMs = containerRestartBackoffMs(record.count);
          const msSinceLast = now - new Date(record.lastRestart).getTime();
          if (msSinceLast < backoffMs) {
            console.log(`[deacon] Container ${name} in backoff (${Math.round((backoffMs - msSinceLast) / 1000)}s remaining)`);
            continue;
          }
        }
      }

      // Kill orphaned host processes (Vite, node) before restarting to fix inotify root cause
      try {
        const { resolveProjectFromIssueSync } = await import('../projects.js');
        const issueUpper = issueLower.toUpperCase();
        const resolved = resolveProjectFromIssueSync(issueUpper);
        if (resolved) {
          const workspacePath = `${resolved.projectPath}/workspaces/feature-${issueLower}`;
          await killOrphanedWorkspaceProcesses(workspacePath);
        }
      } catch {
        // Project not resolvable — skip orphan cleanup, still attempt restart
      }

      // Restart the container
      try {
        await execAsync(`docker restart ${name}`, { encoding: 'utf-8', timeout: 30000 });
        const existing = state.containerRestarts[name];
        state.containerRestarts[name] = {
          count: (existing?.count ?? 0) + 1,
          firstRestart: existing?.firstRestart ?? new Date().toISOString(),
          lastRestart: new Date().toISOString(),
        };
        stateDirty = true;
        const count = state.containerRestarts[name].count;
        const msg = `[deacon] Auto-restarted crashed container ${name} (attempt ${count}/${CONTAINER_RESTART_MAX_COUNT})`;
        console.log(msg);
        actions.push(msg);
        // PAN-464: Alert agent that its container crashed and was restarted
        try {
          await Effect.runPromise(sendKeys(
            agentId,
            `ℹ️  Deacon: container "${name}" crashed and was auto-restarted (attempt ${count}/${CONTAINER_RESTART_MAX_COUNT}). The UAT environment should recover in ~30s. No action needed unless this keeps happening.`,
            'deacon:container-restarted',
          ));
        } catch {
          // Agent may not be interactive — non-fatal
        }
      } catch (restartErr: any) {
        console.warn(`[deacon] Failed to restart ${name}: ${restartErr.message}`);
        // PAN-464: Alert agent that restart failed
        try {
          await Effect.runPromise(sendKeys(
            agentId,
            `⚠️  Deacon alert: container "${name}" crashed and restart failed (${(restartErr as Error).message}). The UAT environment at feature-${issueLower}.pan.localhost is likely broken.`,
            'deacon:container-restart-failed',
          ));
        } catch {
          // Non-fatal
        }
      }
    }

    // When called with sharedState, the caller is responsible for persisting.
    // Saving here would race with runPatrol's later saveState() and clobber records.
    if (stateDirty && !sharedState) saveState(state);
  } catch {
    // Docker not available or other error — skip silently
  }
  return actions;
}

/**
 * PAN-1716: Defense-in-depth reaper for completed advancing-role sessions.
 *
 * Every review/test/ship session whose phase verdict is already terminal but is
 * still tmux-alive is a zombie: Claude sits idle at its prompt forever, yet
 * `countRunningAgents()` keeps counting it against the PAN-1665 advancing
 * ceiling. Enough of them starve every new dispatch and livelock the pipeline.
 *
 * The completion paths (`pan specialists done`, the HTTP route) kill the session
 * directly; this janitor catches any they miss so a single dropped kill can't
 * accumulate into a livelock. Runs early in the patrol so freed ceiling slots
 * benefit this same cycle's dispatchers.
 */
export async function checkTerminalAdvancingSessions(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { selectTerminalAdvancingSessions, KEEP_SPECIALIST_SESSIONS_ALIVE } = await import('./reap-terminal-sessions.js');
    // PAN-2007: operator-requested temporary keep-alive — do not reap specialist
    // sessions so they stay visible through the pipeline until close-out.
    if (KEEP_SPECIALIST_SESSIONS_ALIVE) return actions;
    const statuses = loadReviewStatuses();
    const aliveSessions = await Effect.runPromise(listSessionNames());
    const toKill = selectTerminalAdvancingSessions(statuses, [...aliveSessions]);
    for (const session of toKill) {
      try {
        await Effect.runPromise(killSession(session));
        actions.push(`Reaped terminal advancing session ${session} (verdict recorded, session idle)`);
        console.log(`[deacon] Reaped terminal advancing session ${session} (PAN-1716)`);
        logDeaconEventSync(`checkTerminalAdvancingSessions: reaped ${session} — phase verdict terminal but session alive (PAN-1716)`);
      } catch (err) {
        console.warn(`[deacon] Failed to reap terminal session ${session}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error reaping terminal advancing sessions:', msg);
  }
  return actions;
}

/**
 * PAN-1726: Defense-in-depth reaper for the WORK session of a merged issue.
 *
 * `postMergeLifecycle` pauses + kills `agent-<id>` at merge time, but a server
 * restart mid-lifecycle (the PAN-1723 deploy re-runs the lifecycle from
 * pending-post-merge.json) or a deacon read-modify-write race on state.json can
 * leave the work session alive with `paused: null`. An idle merged work agent
 * sits at its prompt yet still counts against the PAN-1665 work ceiling,
 * throttling test/work dispatch for every live issue — the work-role sibling of
 * the PAN-1716 advancing reaper. We re-pause (so auto-resume can't resurrect it)
 * THEN kill the session; state.json is preserved so reopen still works.
 */
export async function checkMergedWorkSessions(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { selectMergedWorkSessions } = await import('./reap-terminal-sessions.js');
    const { setAgentPaused } = await import('../agents.js');
    const statuses = loadReviewStatuses();
    const aliveSessions = await Effect.runPromise(listSessionNames());
    const toKill = selectMergedWorkSessions(statuses, [...aliveSessions]);
    for (const session of toKill) {
      try {
        // The work session name is the agent id (`agent-<id>`). Re-assert the
        // pause gate before killing so the next patrol's auto-resume won't bring
        // it back; killing alone would just churn it stopped→running forever.
        await Effect.runPromise(setAgentPaused(session, 'merged — awaiting close-out (verify on main)', true));
        await Effect.runPromise(killSession(session));
        actions.push(`Reaped merged work session ${session} (issue merged, session idle)`);
        console.log(`[deacon] Reaped merged work session ${session} (PAN-1726)`);
        logDeaconEventSync(`checkMergedWorkSessions: paused + reaped ${session} — issue merged but work session alive (PAN-1726)`);
      } catch (err) {
        console.warn(`[deacon] Failed to reap merged work session ${session}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error reaping merged work sessions:', msg);
  }
  return actions;
}

/** Pane must be idle at least this long before the awaiting-test reaper kills it. */
const AWAITING_TEST_IDLE_REAP_MS = 10 * 60 * 1000;

/**
 * PAN-1730: Reap the WORK session of an issue that's idle awaiting its test
 * verdict (review passed, test pending).
 *
 * Such a work agent has handed off via `pan done` and sits idle at its prompt,
 * yet `countRunningAgents()` keeps counting it against the PAN-1665 work
 * ceiling. When the work pool alone meets the total ceiling (work=7/9 observed)
 * `tryReserveAdvancingSlot()` can never admit the test that would release these
 * agents — a livelock that zeroed pipeline throughput for hours. Killing the
 * idle work session frees the work slot (and RAM).
 *
 * Unlike the PAN-1726 merged reaper this does NOT pause the agent: if the test
 * later FAILS, the deacon's auto-resume `needsFix` gate must be free to bring it
 * back to fix the feedback. While test stays `pending` the auto-resume
 * "pipeline mid-flight" gate already prevents churn, so killing-without-pausing
 * neither resurrects a still-pending agent nor strands a failed one. Runs before
 * the dispatchers so the freed slot benefits this same cycle's test dispatch.
 */
export async function checkAwaitingTestWorkSessions(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { selectAwaitingTestWorkSessions } = await import('./reap-terminal-sessions.js');
    const statuses = loadReviewStatuses();
    const aliveSessions = await Effect.runPromise(listSessionNames());
    const candidates = selectAwaitingTestWorkSessions(statuses, [...aliveSessions]);
    const now = Date.now();
    for (const session of candidates) {
      // Only reap a genuinely idle pane — a work agent still finalizing right
      // after handoff must be left alone. The work session name IS the agent id.
      const runtime = getAgentRuntimeStateSync(session);
      if (runtime?.state !== 'idle') continue;
      const idleSince = Date.parse(runtime.lastActivity ?? '');
      if (!Number.isFinite(idleSince) || now - idleSince < AWAITING_TEST_IDLE_REAP_MS) continue;
      try {
        // No pause: auto-resume's mid-flight gate keeps it down while test is
        // pending, and its needsFix gate must stay free to resume it on failure.
        await Effect.runPromise(killSession(session));
        actions.push(`Reaped idle awaiting-test work session ${session} (review passed, test pending, idle ≥10m)`);
        console.log(`[deacon] Reaped idle awaiting-test work session ${session} (PAN-1730)`);
        logDeaconEventSync(`checkAwaitingTestWorkSessions: reaped ${session} — review passed, test pending, idle ≥10m (PAN-1730)`);
      } catch (err) {
        console.warn(`[deacon] Failed to reap awaiting-test work session ${session}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error reaping awaiting-test work sessions:', msg);
  }
  return actions;
}

/**
 * Run a single patrol cycle
 */
export async function runPatrol(): Promise<PatrolResult> {
  const state = loadState();
  state.patrolCycle++;
  state.lastPatrol = new Date().toISOString();

  // PAN-378: Global specialists removed. All work done by per-project ephemeral specialists.
  const results: HealthCheckResult[] = [];
  const actions: string[] = [];

  // Global pause: skip the entire cycle when the operator has frozen Deacon.
  // Persisted in app_settings; survives restarts. Per-cycle check so flipping
  // the toggle at runtime takes effect on the next tick without restarting.
  if (isDeaconGloballyPaused()) {
    state.lastPatrol = new Date().toISOString();
    saveState(state);
    if (!hasLoggedGlobalPauseSkip) {
      console.log(`[deacon] Patrol cycle ${state.patrolCycle} SKIPPED — globally paused`);
      addLog('info', `Patrol cycle ${state.patrolCycle} skipped — deacon globally paused`, state.patrolCycle);
      hasLoggedGlobalPauseSkip = true;
    }
    const skipped: PatrolResult = {
      cycle: state.patrolCycle,
      timestamp: state.lastPatrol,
      specialists: [],
      actionsToken: ['skipped: globally_paused'],
      massDeathDetected: false,
    };
    lastPatrolResult = skipped;
    return skipped;
  }

  // PAN-1665: reset the per-patrol advancing-dispatch budget. Every review/test/
  // ship re-dispatch below reserves a slot via tryReserveAdvancingSlot() so the
  // patrol's combined spawns stay under the concurrency ceiling.
  resetPatrolDispatchBudget();

  hasLoggedGlobalPauseSkip = false;
  addLog('info', `Patrol cycle ${state.patrolCycle} — checking per-project specialists`, state.patrolCycle);
  console.log(`[deacon] Patrol cycle ${state.patrolCycle} - checking per-project specialists`);

  // Process any pending post-merge lifecycle that wasn't consumed on startup (PAN-626).
  // In dev mode, the deploy script may fail to restart cleanly, leaving the pending file.
  try {
    const pendingFile = join(OVERDECK_HOME, 'pending-post-merge.json');
    if (existsSync(pendingFile)) {
      const content = readFileSync(pendingFile, 'utf-8');
      const pending = JSON.parse(content);
      const age = Date.now() - (pending.timestamp ?? 0);
      if (age < 60 * 60 * 1000) { // Less than 1 hour old
        console.log(`[deacon] Processing pending post-merge lifecycle for ${pending.issueId} (age: ${Math.round(age / 1000)}s)`);
        // Import and run lifecycle with skipDeploy to avoid infinite restart loop
        const { postMergeLifecycle } = await import('./merge-agent.js');
        // Delete file first to prevent re-processing
        const { unlinkSync } = await import('fs');
        unlinkSync(pendingFile);
        await postMergeLifecycle(pending.issueId, pending.projectPath, pending.sourceBranch, { skipDeploy: true });
        actions.push(`Processed pending post-merge lifecycle for ${pending.issueId}`);
      } else {
        // Stale — delete it
        const { unlinkSync } = await import('fs');
        unlinkSync(pendingFile);
        console.log(`[deacon] Deleted stale pending-post-merge.json (age: ${Math.round(age / 60000)}m)`);
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Failed to process pending lifecycle: ${err.message}`);
  }

  /* PAN-378: Global specialist patrol removed. All specialist work now goes through
   * per-project ephemeral specialists via spawnEphemeralSpecialist(). The global
   * merge-agent, review-agent, and test-agent singletons are no longer used.
   * The patrol below handles per-project ephemeral specialist cleanup. */

  // PAN-378: Global specialist patrol removed. All specialist work is handled by
  // per-project ephemeral specialists via spawnEphemeralSpecialist().
  // Per-project ephemeral specialist patrol is below (dead session + stuck detection).

  // PAN-1908: primary liveness recovery is now reactive (agent.stopped /
  // agent.heartbeat_dead events handled by the Cloister domain-event scheduler).
  // Keep a thin table-query safety net on the patrol for dropped events.
  const livenessActions = await reconcileAgentLiveness();
  actions.push(...livenessActions);
  for (const a of livenessActions) addLog('action', a, state.patrolCycle);

  const orphanProposedActions = await reconcileOrphanProposedSpecs();
  actions.push(...orphanProposedActions);
  for (const a of orphanProposedActions) addLog('action', a, state.patrolCycle);

  const closedIssueAgentActions = await reconcileClosedIssueAgents();
  actions.push(...closedIssueAgentActions);
  for (const a of closedIssueAgentActions) addLog('action', a, state.patrolCycle);

  // PAN-1882: strikes bypass close-out, so their merged `strike/<id>` worktrees
  // + branches pile up forever. Reap any whose branch is fully merged into
  // origin/main with no live strike session (never touches feature/* or unmerged work).
  const strikeWorkspaceActions = await reapMergedStrikeWorkspaces();
  actions.push(...strikeWorkspaceActions);
  for (const a of strikeWorkspaceActions) addLog('action', a, state.patrolCycle);

  // PAN-1817: stop the server+frontend UI containers of workspaces whose agent
  // has been idle (no agent, no tmux) past the grace window. Light-touch and
  // reversible — never touches the agent (host tmux), worktree, or branch.
  const idleStackActions = await reconcileIdleWorkspaceStacks();
  actions.push(...idleStackActions);
  for (const a of idleStackActions) addLog('action', a, state.patrolCycle);

  // Re-send the resume continue prompt when a work agent is alive and idle after
  // resume but no user record landed in the JSONL transcript.
  const stalledResumeActions = await nudgeStalledResumeWorkAgents();
  actions.push(...stalledResumeActions);
  for (const a of stalledResumeActions) addLog('action', a, state.patrolCycle);

  // Nudge work agents that are alive-but-idle with open beads remaining.
  // Catches the gap autoResume misses: tmux alive, status='running', Stop
  // hook fired (idle), but no advance to the next bead (gpt-5.5 checkpoint
  // pattern, prompt mis-interpretation, etc.).
  const beadNudgeActions = await nudgeIdleWorkAgentsWithOpenBeads();
  actions.push(...beadNudgeActions);
  for (const a of beadNudgeActions) addLog('action', a, state.patrolCycle);

  // Detect "Invalid signature in thinking block" in active agent output (PAN-612).
  // Context compaction corrupts thinking-block signatures; the session cannot be
  // resumed. Must run before idle-suspend so we recover corrupted agents first.
  const signatureCorruptionActions = await checkThinkingSignatureCorruption();
  actions.push(...signatureCorruptionActions);
  for (const a of signatureCorruptionActions) addLog('action', a, state.patrolCycle);

  // Check and auto-suspend idle agents (PAN-80, fixed in PAN-154)
  const suspendActions = await checkAndSuspendIdleAgents();
  actions.push(...suspendActions);
  for (const a of suspendActions) addLog('action', a, state.patrolCycle);

  // Clear readyForMerge for issues whose workspace no longer exists.
  // Prevents MERGE button showing for issues that can't actually merge.
  try {
    const { resolveProjectFromIssueSync } = await import('../projects.js');
    const allStatuses = loadReviewStatuses();
    for (const [issueId, status] of Object.entries(allStatuses)) {
      if (!status.readyForMerge || status.mergeStatus === 'merged') continue;
      const project = resolveProjectFromIssueSync(issueId);
      if (!project) continue;
      const wsPath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      if (!existsSync(wsPath)) {
        setReviewStatusSync(issueId, { readyForMerge: false, mergeStatus: 'failed', mergeNotes: 'Workspace does not exist' });
        const msg = `Cleared readyForMerge for ${issueId} (workspace deleted)`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Failed to check workspace existence: ${err.message}`);
  }

  // PAN-1716: Reap completed advancing-role (review/test/ship) sessions that are
  // still tmux-alive before the dispatchers run, so freed ceiling slots are
  // available to this same cycle's review/test/ship re-dispatch below.
  const reapedTerminalActions = await checkTerminalAdvancingSessions();
  actions.push(...reapedTerminalActions);
  for (const a of reapedTerminalActions) addLog('action', a, state.patrolCycle);

  // PAN-1726: Reap the work session of an already-merged issue (work-role
  // sibling of the PAN-1716 advancing reaper). An idle merged work agent holds a
  // PAN-1665 work slot; re-pause + kill it so the slot frees for live work.
  const reapedWorkActions = await checkMergedWorkSessions();
  actions.push(...reapedWorkActions);
  for (const a of reapedWorkActions) addLog('action', a, state.patrolCycle);

  // PAN-1778: proactively refresh Claude credentials on active remote agents
  // when the host credentials file changes, with a 15 min fallback cadence.
  // Runs before the reactive 401 heal/reap path so long remote runs get fresh
  // OAuth tokens before they stall. Zero active remote agents is a local state
  // scan only — no Fly provider construction and no Fly API calls.
  try {
    const { refreshClaudeCredentialsForActiveRemoteAgents } = await import('../remote/remote-completion.js');
    const remoteCredentialActions = await refreshClaudeCredentialsForActiveRemoteAgents();
    actions.push(...remoteCredentialActions);
    for (const a of remoteCredentialActions) addLog(a.includes('failed') ? 'warn' : 'action', a, state.patrolCycle);
  } catch (err: any) {
    addLog('warn', `Remote credential refresh patrol failed: ${err.message}`, state.patrolCycle);
  }

  // PAN-1845: keep ephemeral-tier remote VMs from running forever when the host
  // (or deacon) goes away. The patrol writes a freshness file; a VM-side
  // watchdog self-stops the machine when the heartbeat goes stale.
  try {
    const { refreshHostHeartbeatForEphemeralVms } = await import('../remote/remote-agents.js');
    const heartbeatActions = await refreshHostHeartbeatForEphemeralVms();
    actions.push(...heartbeatActions);
    for (const a of heartbeatActions) addLog(a.includes('failed') ? 'warn' : 'action', a, state.patrolCycle);
  } catch (err: any) {
    addLog('warn', `Remote heartbeat refresh patrol failed: ${err.message}`, state.patrolCycle);
  }

  // PAN-1676: hand completed remote (fly.io) agents to the review pipeline.
  // Cheap no-op when no remote-state.json is active (local file scan only —
  // no fly API calls); otherwise checks each VM for the REMOTE_DONE sentinel,
  // materializes the local worktree, creates review artifacts + the completed
  // marker, and destroys the machine.
  try {
    const { reapCompletedRemoteAgents } = await import('../remote/remote-completion.js');
    const remoteReap = await reapCompletedRemoteAgents();
    for (const r of remoteReap) {
      if (r.status === 'handed-off' || r.status === 'error') {
        const msg = `Remote reap ${r.issueId}: ${r.status} (${r.details.join('; ')})`;
        actions.push(msg);
        addLog(r.status === 'error' ? 'warn' : 'action', msg, state.patrolCycle);
      }
    }
  } catch (err: any) {
    addLog('warn', `Remote reap patrol failed: ${err.message}`, state.patrolCycle);
  }

  // PAN-1730: Reap the work session of an issue idle awaiting its test verdict
  // (review passed, test pending, pane idle ≥10m). When the work pool alone
  // meets the PAN-1665 total ceiling, these idle agents livelock test dispatch —
  // freeing the slot here lets this same cycle's checkPendingTestDispatch admit
  // the test that releases them. Kill-without-pause; see the function comment.
  const reapedAwaitingTestActions = await checkAwaitingTestWorkSessions();
  actions.push(...reapedAwaitingTestActions);
  for (const a of reapedAwaitingTestActions) addLog('action', a, state.patrolCycle);

  // PAN-1908: primary review-status orphan recovery is now reactive
  // (review.coordinator.died / work.completed events). The patrol keeps a thin
  // SQLite-only safety net for dropped events.
  const orphanActions = await checkOrphanedReviewStatuses();
  actions.push(...orphanActions);
  for (const a of orphanActions) addLog('action', a, state.patrolCycle);

  // Bound per-bead inspect sessions so work agents never wait forever for a verdict.
  const inspectTimeoutActions = await checkInspectAgentTimeouts();
  actions.push(...inspectTimeoutActions);
  for (const a of inspectTimeoutActions) addLog('action', a, state.patrolCycle);

  // PAN-1559: reap untracked inspect tmux sessions. Inspect agents now write
  // state.json at spawn, but this safety net kills older leaked sessions and
  // any future dead inspect panes before they burn compute indefinitely.
  const inspectReaperActions = await cleanupOrphanedInspectSessions();
  actions.push(...inspectReaperActions);
  for (const a of inspectReaperActions) addLog('action', a, state.patrolCycle);

  // Detect new commits pushed after review passed before any test/merge path can
  // act on stale review approval.
  const postReviewActions = await checkPostReviewCommits();
  actions.push(...postReviewActions);
  for (const a of postReviewActions) addLog('action', a, state.patrolCycle);

  const stalledConvoyActions = await recoverStalledReviewConvoys();
  actions.push(...stalledConvoyActions);
  for (const a of stalledConvoyActions) addLog('action', a, state.patrolCycle);

  // PAN-1908: primary missing-status creation is now reactive (work.completed
  // event). The patrol keeps a thin agents-table safety net for dropped events.
  const missingStatusActions = await checkMissingReviewStatuses();
  actions.push(...missingStatusActions);
  for (const a of missingStatusActions) addLog('action', a, state.patrolCycle);

  // PAN-1681: Recover test agents that wrote .pan/test/result.json but never
  // POSTed testStatus (nudge once → auto-complete). Runs BEFORE the dispatcher
  // below so a recoverable verdict is honored before any re-dispatch or stuck
  // marker — the dispatcher's stuck path skips issues this already resolved.
  const unsignaledTestActions = await checkCompletedButUnsignaledTests();
  actions.push(...unsignaledTestActions);
  for (const a of unsignaledTestActions) addLog('action', a, state.patrolCycle);

  // PAN-1658: after a rebase, reviewStatus may already be passed while testStatus
  // remains pending. Run before the dispatcher so green GitHub Actions CI on the
  // current PR HEAD can clear stale pending state instead of spawning a new test.
  const greenCiTestStatusActions = await reconcileTestStatusFromGreenCi();
  actions.push(...greenCiTestStatusActions);
  for (const a of greenCiTestStatusActions) addLog('action', a, state.patrolCycle);

  // Retry test-agent dispatch for issues where review passed but test never started (PAN-699)
  const pendingTestActions = await checkPendingTestDispatch();
  actions.push(...pendingTestActions);
  for (const a of pendingTestActions) addLog('action', a, state.patrolCycle);

  // Reset issues stuck in 'reviewing' with no active review session (PAN-733)
  const stuckReviewActions = await checkStuckReviewing();
  actions.push(...stuckReviewActions);
  for (const a of stuckReviewActions) addLog('action', a, state.patrolCycle);

  // Detect review specialists that wrote synthesis.md but never signaled completion
  const unsignaledReviewActions = await checkCompletedButUnsignaledReviews();
  actions.push(...unsignaledReviewActions);
  for (const a of unsignaledReviewActions) addLog('action', a, state.patrolCycle);

  // PAN-796: Bypass review for issues where verification passed but review infra keeps failing
  const verifContradictionActions = await checkVerificationReviewContradiction();
  actions.push(...verifContradictionActions);
  for (const a of verifContradictionActions) addLog('action', a, state.patrolCycle);

  // Kill orphaned planning sessions whose issue has already progressed past planning.
  // PAN-682 pattern: `planning-pan-<id>` tmux session survives hours after `complete-planning`
  // because either (a) `skipKill=true` was set or (b) complete-planning was never invoked
  // (work agent was started via a different path). If the corresponding work agent session
  // `agent-pan-<id>` is alive, planning is definitively over — kill the planning session.
  const planningCleanupActions = await cleanupOrphanedPlanningSessions();
  actions.push(...planningCleanupActions);
  for (const a of planningCleanupActions) addLog('action', a, state.patrolCycle);

  // Notify review synthesis when server-owned convoy reviewers crash or time out.
  const reviewerMonitorActions = await monitorReviewConvoySignals();
  actions.push(...reviewerMonitorActions);
  for (const a of reviewerMonitorActions) addLog('action', a, state.patrolCycle);

  // Kill orphaned review sessions whose work agent is no longer running.
  // Review sessions are named review-<issueId>-<timestamp>-<role> and are
  // never killed by teardown because the exact-match pattern doesn't catch them.
  const reviewCleanupActions = await cleanupOrphanedReviewSessions();
  actions.push(...reviewCleanupActions);
  for (const a of reviewCleanupActions) addLog('action', a, state.patrolCycle);

  // PAN-464: Check workspace Docker container health and auto-restart crashed containers
  const containerActions = await checkWorkspaceContainerHealth(state);
  actions.push(...containerActions);
  for (const a of containerActions) addLog('action', a, state.patrolCycle);

  // Dead-end and first-completion nudges DISABLED — too flaky, risk of
  // draining AI token credits by sending unnecessary prompts to agents.
  // If an agent is stuck, the human operator can nudge it manually via the
  // dashboard's Tell action.

  // Safety-net: trigger merge for issues stuck in readyForMerge state (PAN-344)
  const mergeStuckActions = await checkReadyForMergeStuck();
  actions.push(...mergeStuckActions);
  for (const a of mergeStuckActions) addLog('action', a, state.patrolCycle);

  // Auto-retry merges that failed due to transient post-rebase verification failures
  const failedMergeRetryActions = await checkFailedMergeRetry();
  actions.push(...failedMergeRetryActions);
  for (const a of failedMergeRetryActions) addLog('action', a, state.patrolCycle);

  // Reconcile stale merge status: detect branches merged to main outside the dashboard
  const staleMergeActions = await reconcileStaleMergeStatus();
  actions.push(...staleMergeActions);
  for (const a of staleMergeActions) addLog('action', a, state.patrolCycle);

  // PAN-1027 reverse: detect mergeStatus=merged issues whose GitHub PR is not merged
  // (closed-without-merge, reopened after revert, or false positive from squash detection).
  // Without this, those issues get stuck because mergeStatus blocks all pipeline gates.
  const falseMergedActions = await reconcileFalseMerged();
  actions.push(...falseMergedActions);
  for (const a of falseMergedActions) addLog('action', a, state.patrolCycle);

  // PAN-1028: detect merge_status=merged but review_status non-terminal (coordinator
  // crashed mid-run, dashboard missed the transition). Reconcile to review_status=passed
  // so the dashboard stops showing "running reviewers with no data."
  const mergedReviewingActions = await reconcileMergedButReviewing();
  actions.push(...mergedReviewingActions);
  for (const a of mergedReviewingActions) addLog('action', a, state.patrolCycle);

  const autoCloseOutActions = await autoCloseOut();
  actions.push(...autoCloseOutActions);
  for (const a of autoCloseOutActions) addLog('action', a, state.patrolCycle);

  // Closed-PR readyForMerge reconciler: stops the "Awaiting Merge" view from
  // listing issues whose PR was closed without merging (PAN-1111-style stale
  // state). Best-effort against the forge; 10-min per-issue cooldown.
  const closedPrReadyActions = await reconcileClosedPrReadyForMerge();
  actions.push(...closedPrReadyActions);
  for (const a of closedPrReadyActions) addLog('action', a, state.patrolCycle);

  // Dead-end agent recovery: nudge agents stuck with reviewStatus=blocked/failed after
  // fixing review issues but not re-requesting review. Has 10-min per-issue cooldown and
  // 7-requeue circuit breaker to avoid runaway API credit consumption.
  const deadEndActions = await checkDeadEndAgents();
  actions.push(...deadEndActions);
  for (const a of deadEndActions) addLog('action', a, state.patrolCycle);

  // First-completion gap detection: nudge work agents that finished implementation
  // but never called pan done. Only fires for agents idle >10min with commits and
  // no completion marker or review status entry. Has 15-min cooldown per agent.
  const firstCompletionActions = await checkFirstCompletionAgents();
  actions.push(...firstCompletionActions);
  for (const a of firstCompletionActions) addLog('action', a, state.patrolCycle);

  // Resolution patrol DISABLED — auto-completing and poking agents consumes
  // API credits and is unreliable. Human operator can take action via dashboard.

  // Lazy agent correction DISABLED — sends messages to agents which costs
  // API credits. Human operator can check lazy behavior via dashboard.

  // Stuck work agent recovery still runs — it only intervenes after 10 minutes
  // of no tool use, escalating to Escape/Ctrl-C/respawn (not paid messages).
  const stuckActions = await checkStuckWorkAgents();
  actions.push(...stuckActions);
  for (const a of stuckActions) addLog('action', a, state.patrolCycle);

  // API error recovery: nudge agents that stopped due to transient provider errors.
  const apiErrorActions = await checkApiErrorAgents();
  actions.push(...apiErrorActions);
  for (const a of apiErrorActions) addLog('action', a, state.patrolCycle);

  const stuckRemediationActions = await checkStuckAgentRemediation();
  actions.push(...stuckRemediationActions);
  for (const a of stuckRemediationActions) addLog('action', a, state.patrolCycle);

  // PAN-1625: reap orphaned dashboard-server processes (failed-restart leftovers
  // that lost the port but keep running — and can run a second Deacon). Low
  // cadence (~10 min). Never touches the live server, the port owner, a
  // just-spawned server, or a workspace-container server — see the reaper module.
  const serverReaperEveryCycles = Math.max(1, Math.round((10 * 60 * 1000) / config.patrolIntervalMs));
  if (state.patrolCycle % serverReaperEveryCycles === 0) {
    const reaperActions = await reapOrphanedDashboardServers();
    actions.push(...reaperActions);
    for (const a of reaperActions) addLog('action', a, state.patrolCycle);
  }

  // PAN-1706: reap leftover playwright-mcp trees / stale headless browsers.
  // Each ghost browser keeps a full dashboard page polling at full rate,
  // multiplying server load. Same ~10 min cadence as the server reaper.
  if (state.patrolCycle % serverReaperEveryCycles === 0) {
    const playwrightActions = await reapLeftoverPlaywrightBrowsers();
    actions.push(...playwrightActions);
    for (const a of playwrightActions) addLog('action', a, state.patrolCycle);
  }

  // PAN-1441: sweep host-main beads drift into git. `.beads/{issues.jsonl,
  // export-state.json}` re-export on `main` whenever the `bd` binary syncs the
  // shared dolt remote, and there is no single Overdeck write site to hook —
  // so commit any resulting drift here. queueBeadsAutoCommit is main-only,
  // debounced, skips missing files, and no-ops when nothing changed.
  for (const { config: projectConfig } of listProjectsSync()) {
    if (projectConfig.path) queueBeadsAutoCommit(projectConfig.path);
  }

  // Periodic agent state cleanup (PAN-154)
  if (Math.random() < 0.003) {
    const cleanupActions = await cleanupStaleAgentState();
    actions.push(...cleanupActions);
    for (const a of cleanupActions) addLog('action', a, state.patrolCycle);
  }

  // Periodic abandoned-feedback sweep — safety net for workspaces where the
  // event-driven cleanup (new review cycle / merge / close-out) never fired.
  // See docs/REVIEW-AGENT-ARCHITECTURE.md.
  if (Math.random() < 0.003) {
    const feedbackActions = await cleanupAbandonedFeedback();
    actions.push(...feedbackActions);
    for (const a of feedbackActions) addLog('action', a, state.patrolCycle);
  }

  // PAN-1908: primary orphan reviewer-session cleanup is reactive
  // (agent.stopped for the owning work agent). This is a thin safety-net
  // sweep for dropped events (PAN-846).
  if (Math.random() < 0.01) {
    const orphanActions = await cleanupOrphanReviewerSessions();
    actions.push(...orphanActions);
    for (const a of orphanActions) addLog('action', a, state.patrolCycle);
  }

  // Check for mass death (uses shared state)
  const massDeathCheck = checkMassDeath(state);
  if (massDeathCheck.isMassDeath && massDeathCheck.message) {
    console.error(`[deacon] ${massDeathCheck.message}`);
    actions.push(massDeathCheck.message);
    addLog('error', massDeathCheck.message, state.patrolCycle);
  }

  // Patrol per-project ephemeral specialists (PAN-300)
  // Ephemeral specialists are spawned on-demand and are not auto-restarted by the deacon.
  // Patrol detects stuck sessions, dead sessions, and auto-completes successful merges (PAN-375).
  try {
    const projectSpecialists = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectSpecialists) {
      if (!projSpec.isRunning) {
        // Session is dead — reset any stale active runtime state so the next
        // merge request is not blocked by a phantom busy signal.
        const runtimeState = getAgentRuntimeStateSync(projSpec.tmuxSession);
        if (runtimeState?.state === 'active') {
          saveAgentRuntimeState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date().toISOString() });
          const msg = `Dead-session reset: per-project ${projSpec.specialistType} (${projSpec.projectKey}) was active but session is gone`;
          actions.push(msg);
          addLog('action', msg, state.patrolCycle);
          console.log(`[deacon] ${msg}`);

          // PAN-375: If merge specialist died while merging, check if merge actually succeeded
          if (projSpec.specialistType === 'merge-agent' && runtimeState.currentIssue) {
            const issueId = runtimeState.currentIssue;
            try {
              const currentStatus = getReviewStatusSync(issueId);
              if (currentStatus?.mergeStatus === 'merging') {
                const { resolveProjectFromIssueSync } = await import('../projects.js');
                const resolved = resolveProjectFromIssueSync(issueId);
                if (resolved) {
                  const branch = `feature/${issueId.toLowerCase()}`;
                  const { stdout } = await execAsync(
                    `git -C "${resolved.projectPath}" log --oneline origin/main --grep="Merge branch '${branch}'" 2>/dev/null | head -1`,
                    { encoding: 'utf-8' }
                  );
                  if (stdout.trim()) {
                    console.log(`[deacon] PAN-375: merge specialist died but ${issueId} IS merged (${stdout.trim()}). Auto-completing.`);
                    setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false });
                    const { postMergeLifecycle } = await import('./merge-agent.js');
                    postMergeLifecycle(issueId, resolved.projectPath).catch(err =>
                      console.warn(`[deacon] postMergeLifecycle failed for ${issueId}: ${err}`)
                    );
                    actions.push(`Auto-completed stale merge for ${issueId}`);
                  } else {
                    console.log(`[deacon] Merge specialist died and ${issueId} NOT merged. Resetting to readyForMerge.`);
                    setReviewStatusSync(issueId, { mergeStatus: 'pending' });
                  }
                }
              }
            } catch (err) {
              console.warn(`[deacon] PAN-375 check failed for ${issueId}: ${err}`);
            }
          }
        }
        continue;
      }

      const runtimeState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      // A running ephemeral specialist with no runtime state, or active for more than
      // the max specialist timeout (ephemeral specialist spawn uses 15 min), is considered stuck.
      const isStuck = runtimeState?.state === 'active' && runtimeState.lastActivity
        ? (Date.now() - new Date(runtimeState.lastActivity).getTime()) > 15 * 60 * 1000
        : false;

      if (isStuck) {
        addLog('warn', `Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing`, state.patrolCycle);
        console.log(`[deacon] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing ${projSpec.tmuxSession}`);
        try {
          await Effect.runPromise(killSession(projSpec.tmuxSession));
          // Preserve Claude JSONL/session artifacts; only reset Overdeck runtime state.
          saveAgentRuntimeState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date().toISOString() });
          actions.push(`Force-killed stuck per-project ${projSpec.specialistType} (${projSpec.projectKey})`);
        } catch {
          // Non-fatal — session may have already exited
        }
      }

      // PAN-919: Idle-but-alive specialist — task completed but session lingers
      // (e.g. Claude Code sitting at "Press Ctrl-D again to exit" after one-shot task).
      // Ephemeral specialists have no reason to stay alive once idle.
      const IDLE_LINGER_MS = 5 * 60 * 1000; // 5 minutes
      if (
        !isStuck &&
        (!runtimeState || runtimeState.state === 'idle') &&
        runtimeState?.lastActivity &&
        Date.now() - new Date(runtimeState.lastActivity).getTime() > IDLE_LINGER_MS
      ) {
        const ageMin = Math.round((Date.now() - new Date(runtimeState.lastActivity).getTime()) / 60000);
        const msg = `Killed lingering idle specialist ${projSpec.specialistType} (${projSpec.projectKey}) — idle ${ageMin}min`;
        console.log(`[deacon] ${msg}`);
        try {
          await Effect.runPromise(killSession(projSpec.tmuxSession));
          actions.push(msg);
          addLog('action', msg, state.patrolCycle);
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error during per-project specialist patrol:', msg);
  }

  // Single save for the entire patrol cycle — all mutations from
  // checkSpecialistHealth, forceKillSpecialist, and checkMassDeath
  // accumulate in the shared state object and are persisted once here.
  saveState(state);

  const result: PatrolResult = {
    cycle: state.patrolCycle,
    timestamp: state.lastPatrol,
    specialists: results,
    actionsToken: actions,
    massDeathDetected: massDeathCheck.isMassDeath,
  };

  lastPatrolResult = result;
  return result;
}

// Store the most recent patrol result for API access
let lastPatrolResult: PatrolResult | null = null;
let hasLoggedGlobalPauseSkip = false;

// ============================================================================
// Deacon Log Buffer
// ============================================================================

export interface DeaconLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'action' | 'error';
  message: string;
  cycle?: number;
}

const MAX_LOG_ENTRIES = 200;
const deaconLogs: DeaconLogEntry[] = [];

function addLog(level: DeaconLogEntry['level'], message: string, cycle?: number): void {
  deaconLogs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    cycle,
  });
  // Trim to max size
  if (deaconLogs.length > MAX_LOG_ENTRIES) {
    deaconLogs.splice(0, deaconLogs.length - MAX_LOG_ENTRIES);
  }
}

/**
 * Get recent deacon log entries.
 * Returns the most recent `limit` entries (default 100).
 */
export function getDeaconLogs(limit = 100): DeaconLogEntry[] {
  return deaconLogs.slice(-limit);
}

/**
 * Get the result of the most recent patrol cycle.
 * Used by the dashboard API to show recent Deacon actions.
 */
export function getLastPatrolResult(): PatrolResult | null {
  return lastPatrolResult;
}

/**
 * Detect agents whose tmux output contains "Invalid signature in thinking block" —
 * a symptom of context compaction corrupting thinking-block cryptographic signatures
 * (PAN-612). The corrupted session cannot be resumed; the agent must start fresh.
 *
 * Recovery: kill the tmux session, mark agent stopped, delete session.id so
 * autoResumeStoppedWorkAgents won't try --resume with the corrupted session.
 * The JSONL file is NEVER deleted (sacred).
 */
async function checkThinkingSignatureCorruption(): Promise<string[]> {
  const actions: string[] = [];
  if (!existsSync(AGENTS_DIR)) return actions;

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-'));
  } catch {
    return actions;
  }

  for (const agentId of agentDirs) {
    // Only check agents that claim to be running
    const state = getAgentStateSync(agentId);
    if (!state || state.status !== 'running') continue;

    // Check if the tmux session is alive
    if (!sessionExistsSync(agentId)) continue;

    // Capture recent output and scan for signature corruption
    let output: string;
    try {
      output = await Effect.runPromise(capturePane(agentId, 100));
    } catch {
      continue;
    }

    if (!output.includes('Invalid signature in thinking block')) continue;

    // Corruption detected — recover the agent
    const issueId = state.issueId ?? agentId;
    console.error(`[deacon] SIGNATURE CORRUPTION detected in ${agentId} (${issueId}) — recovering`);
    logDeaconEventSync(`checkThinkingSignatureCorruption: corruption detected in ${agentId} (${issueId})`);
    logAgentLifecycleSync(agentId, 'signature corruption detected — recovering: killed session, cleared session.id');

    // Kill the tmux session
    try {
      await Effect.runPromise(killSession(agentId));
    } catch { /* non-fatal */ }

    // Delete session.id so resumeAgent won't --resume the corrupted session
    const sessionFile = join(AGENTS_DIR, agentId, 'session.id');
    if (existsSync(sessionFile)) {
      try { rmSync(sessionFile); } catch { /* non-fatal */ }
    }

    // Mark agent as stopped
    try {
      saveAgentStateSync({ ...state, status: 'stopped', stoppedAt: new Date().toISOString() });
    } catch { /* non-fatal */ }

    // Notify server layer so the read model and frontend update
    if (agentStoppedNotifier) {
      try { agentStoppedNotifier(agentId); } catch { /* non-fatal */ }
    }

    const msg = `Recovered ${agentId} (${issueId}) from thinking-block signature corruption — session killed, will start fresh on next resume`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEventSync(`checkThinkingSignatureCorruption: ${msg}`);
  }

  return actions;
}

/**
 * Start the deacon patrol loop
 */
let recoverOrphanedAgentsInFlight: Promise<string[]> | null = null;
const RAPID_POST_RESUME_DEATH_MS = 120_000;

function isRapidPostResumeDeath(state: AgentState): boolean {
  const lastResumeMs = Date.parse(state.lastResumeAt ?? '');
  return Number.isFinite(lastResumeMs) && Date.now() - lastResumeMs <= RAPID_POST_RESUME_DEATH_MS;
}

/**
 * PAN-1718: a work agent that reached a tmux session but lost it before ever
 * delivering its kickoff never started doing real work — this is a launch
 * crash, not a healthy run that later died. Work agents set
 * kickoffDelivered=false at spawn and =true once the kickoff lands.
 *
 * Why this exists alongside isRapidPostResumeDeath: that guard keys off
 * lastResumeAt, so it only catches rapid death after a *resume*. A
 * fundamentally-broken work agent (crashing harness, dead model) is
 * re-dispatched by the orphan-proposed reconciler as a *fresh start* each
 * time, which has no lastResumeAt — and its startedAt→orphan span can exceed
 * the rapid window purely because the spawn itself is slow (e.g. ~2 min to
 * reach `running`). Without this, the orphan path resets the failure counter
 * every cycle, so consecutiveFailures oscillates 1→0→1 and never reaches
 * maxConsecutiveFailures — the troubled gate never trips and the agent
 * crash-loops forever. Treating a pre-kickoff orphan as an accumulating
 * failure lets it trip `troubled` after maxConsecutiveFailures, which the
 * reconciler then honors (it skips troubled agents) and the loop stops.
 */
function isPreKickoffLaunchDeath(state: AgentState): boolean {
  return state.role === 'work' && state.kickoffDelivered === false;
}

/**
 * PAN-1908: event-driven orphan recovery. A single agent has been declared
 * heartbeat-dead (tmux session gone). Mark it stopped, record a failure for
 * auto-resume tracking, and notify subscribers. Does NOT enumerate directories —
 * it operates on the agent ID passed by the event/reconcile caller.
 */
export async function handleAgentHeartbeatDeadEvent(agentId: string, context?: string): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — OVERDECK_NO_RESUME=1`);
    return [];
  }

  const state = getAgentStateSync(agentId);
  if (!state) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — no state`);
    return [];
  }
  if (state.status !== 'running' && state.status !== 'starting') {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — status=${state.status} (not running/starting)`);
    return [];
  }
  if (isVerifyPausedAgentState(state)) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — verify-paused (mergeStatus=merged, tmux session intentionally absent)`);
    return [];
  }

  // PAN-1557: convoy reviewers are interactive — they own a tmux session
  // (remain-on-exit on) like other specialists, so liveness is the session's
  // pane, not a launcher pid. While the pane is alive the reviewer is working
  // or idling attachably; a dead pane (Claude exited) or a missing session
  // past the startup grace means it's done — fall through to mark stopped.
  if (state.reviewSubRole) {
    if (sessionExistsSync(agentId)) {
      try {
        const dead = ((await Effect.runPromise(listPaneValues(agentId, '#{pane_dead}')))[0]?.trim() ?? '') === '1';
        if (!dead) return []; // pane alive — still working / idling attachably
        try { await Effect.runPromise(killSession(agentId)); } catch { /* ignore */ }
        logDeaconEventSync(`handleAgentHeartbeatDeadEvent: killed dead reviewer pane ${agentId}`);
      } catch {
        return []; // can't check — assume alive
      }
    } else {
      // No session yet — startup grace keyed off startedAt before orphaning.
      const startedMs = Date.parse(state.startedAt ?? '');
      const REVIEWER_STARTUP_GRACE_MS = 90_000;
      if (Number.isFinite(startedMs) && Date.now() - startedMs < REVIEWER_STARTUP_GRACE_MS) {
        return [];
      }
    }
    // Session gone (or dead pane past grace) — fall through to mark stopped.
  } else if (sessionExistsSync(agentId)) {
    // Planning sessions use remain-on-exit, so the tmux session persists after
    // Claude exits. Check if the pane's process is actually dead.
    if (agentId.startsWith('planning-')) {
      try {
        const result = (await Effect.runPromise(listPaneValues(agentId, '#{pane_dead}')))[0]?.trim() ?? '';
        if (result !== '1') return []; // pane is alive — truly still running
        // Pane is dead — kill the zombie tmux session and fall through to recovery
        try { await Effect.runPromise(killSession(agentId)); } catch { /* ignore */ }
        logDeaconEventSync(`handleAgentHeartbeatDeadEvent: killed dead planning pane ${agentId}`);
      } catch {
        return []; // can't check — assume alive
      }
    } else {
      return []; // truly still running
    }
  } else if (state.status === 'starting') {
    // PAN-1256: work agents in `starting` status need a startup grace
    // window before being declared orphaned.
    if (isStartingWithinGrace(state)) {
      return [];
    }
    // Past the grace window with no tmux session — true orphan, fall through.
  }

  // Orphaned — crashed agent with no tmux session
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  await Effect.runPromise(saveAgentState(state));
  // PAN-1530: only record failure markers for agents the auto-resume gate
  // will actually retry. Planning agents are one-shot by design.
  const isResumableRole = !agentId.startsWith('planning-');
  const completedReviewArtifact = hasCompletedReviewArtifact(state);
  if (state.stoppedByUser !== true && isResumableRole && !completedReviewArtifact) {
    const rapidPostResumeDeath = isRapidPostResumeDeath(state);
    const preKickoffLaunchDeath = isPreKickoffLaunchDeath(state);
    // PAN-1718: preserve (accumulate) the failure counter for deaths that prove
    // the agent never came up healthy — a rapid post-resume death, or a death
    // before the kickoff was ever delivered. Resetting on these lets a
    // fundamentally-broken agent that the reconciler re-dispatches as a fresh
    // start zero its counter every cycle and crash-loop forever without ever
    // tripping the troubled gate.
    const accumulatingDeath = rapidPostResumeDeath || preKickoffLaunchDeath;
    if (!accumulatingDeath) {
      resetAgentFailureCount(agentId);
    }
    const failureReason = rapidPostResumeDeath
      ? `rapid post-resume death: tmux session missing within ${RAPID_POST_RESUME_DEATH_MS / 1000}s (${context ?? 'event'})`
      : preKickoffLaunchDeath
        ? `launch crash: tmux session lost before kickoff delivery (${context ?? 'event'})`
        : `orphaned: tmux session missing (${context ?? 'event'})`;
    const failedState = await Effect.runPromise(recordAgentFailure(agentId, failureReason));
    if (failedState) {
      notifyAgentStatusChanged(failedState, oldStatus, false);
      orphanFailureRecordedForAutoResume.add(agentId);
    }
  } else if (completedReviewArtifact) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} stopped after completed review artifact; not recording orphan failure`);
  }
  const msg = `Recovered orphaned agent ${agentId} (${oldStatus}→stopped)`;
  console.log(`[deacon] ${msg}`);
  logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${msg} — tmux session missing, state.json reset`);
  logAgentLifecycleSync(agentId, `status changed: ${oldStatus} → stopped (orphaned: tmux session missing)`);
  // Notify server layer so the read model and frontend update
  if (agentStoppedNotifier) {
    try { agentStoppedNotifier(agentId); } catch { /* non-fatal */ }
  }
  return [msg];
}

/**
 * On startup, detect agents whose state.json claims 'running' or 'starting' but have
 * no live tmux session — this happens after a system crash where tmux was killed but
 * state.json was never updated. Reset them to 'stopped' so resume/re-plan works correctly.
 */
export async function recoverOrphanedAgents(context?: string): Promise<string[]> {
  if (recoverOrphanedAgentsInFlight) {
    logDeaconEventSync(`recoverOrphanedAgents coalesced${context ? ` (${context})` : ''}: scan already in flight`);
    return recoverOrphanedAgentsInFlight;
  }

  const scan = recoverOrphanedAgentsOnce(context);
  recoverOrphanedAgentsInFlight = scan;
  try {
    return await scan;
  } finally {
    if (recoverOrphanedAgentsInFlight === scan) {
      recoverOrphanedAgentsInFlight = null;
    }
  }
}

async function recoverOrphanedAgentsOnce(context?: string): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`OVERDECK_NO_RESUME=1 — skipping recoverOrphanedAgents${context ? ` (${context})` : ''}`);
    return [];
  }

  // PAN-1908: authoritative registry is the agents table; no directory scan.
  const candidates = listAllAgents()
    .filter((agent) => agent.status === 'running' || agent.status === 'starting')
    .map((agent) => agent.id);

  logDeaconEventSync(`recoverOrphanedAgents started${context ? ` (${context})` : ''}: ${candidates.length} candidate(s) from agents table`);
  const actions: string[] = [];
  for (const agentId of candidates) {
    try {
      const result = await handleAgentHeartbeatDeadEvent(agentId, context ?? 'patrol');
      actions.push(...result);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`recoverOrphanedAgents: error processing ${agentId}: ${reason}`);
    }
  }
  if (actions.length > 0 && context) {
    console.log(`[deacon] ${context}: ${actions.length} orphaned agent(s) reset to stopped`);
    logDeaconEventSync(`recoverOrphanedAgents completed (${context}): ${actions.length} orphaned agent(s) reset to stopped`);
  } else {
    logDeaconEventSync(`recoverOrphanedAgents completed: no orphaned agents found`);
  }
  return actions;
}

/**
 * Kill `planning-*` tmux sessions whose corresponding work agent (`agent-*`) is
 * already alive — that's definitive evidence planning is over. Handles the PAN-682
 * pattern where a planning session survives after `complete-planning` fails to
 * kill it (skipKill=true path, or complete-planning never invoked because the
 * work agent was started via a different code path).
 */
async function cleanupOrphanedPlanningSessions(): Promise<string[]> {
  const actions: string[] = [];
  let planningSessions: string[];
  try {
    planningSessions = (await Effect.runPromise(listSessionNames()))
      .filter(s => s.startsWith('planning-'));
  } catch {
    return actions;
  }

  logDeaconEventSync(`cleanupOrphanedPlanningSessions started: found ${planningSessions.length} planning session(s)`);

  for (const planningSession of planningSessions) {
    // planning-pan-596 → agent-pan-596
    const workAgentSession = planningSession.replace(/^planning-/, 'agent-');
    if (!sessionExistsSync(workAgentSession)) {
      logDeaconEventSync(`cleanupOrphanedPlanningSessions: ${planningSession} kept — work agent ${workAgentSession} not running`);
      continue;
    }

    try {
      await Effect.runPromise(killSession(planningSession)).catch(() => {});
    } catch { /* non-fatal */ }

    // Mark planning agent state as stopped so the UI doesn't show a "running" pill.
    try {
      const agentState = getAgentStateSync(planningSession);
      if (agentState && (agentState.status === 'running' || agentState.status === 'starting')) {
        const oldStatus = agentState.status;
        saveAgentStateSync({ ...agentState, status: 'stopped', stoppedAt: new Date().toISOString() });
        if (agentStoppedNotifier) {
          try { agentStoppedNotifier(planningSession); } catch { /* non-fatal */ }
        }
        logAgentLifecycleSync(planningSession, `status changed: ${oldStatus} → stopped (orphaned planning session killed)`);
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`cleanupOrphanedPlanningSessions: error updating state for ${planningSession}: ${reason}`);
    }

    const msg = `Killed orphaned ${planningSession} (work agent ${workAgentSession} is running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEventSync(`cleanupOrphanedPlanningSessions: ${msg}`);
  }
  if (actions.length > 0) {
    logDeaconEventSync(`cleanupOrphanedPlanningSessions completed: killed ${actions.length} orphaned session(s)`);
  } else {
    logDeaconEventSync(`cleanupOrphanedPlanningSessions completed: no orphaned sessions found`);
  }

  return actions;
}

const REVIEWER_IDLE_FAILURE_MS = 3 * 60 * 1000;
const REVIEW_REPORTS_PRESENT_NUDGE_COOLDOWN_MS = 60 * 1000;
const reviewReportsPresentNudges = new Map<string, number>();

type DeaconReviewSynthesis = {
  verdict: 'passed' | 'blocked';
  topBlocker: string;
  body: string;
};

function extractMarkdownSection(markdown: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'im');
  return markdown.match(pattern)?.[1]?.trim() ?? '';
}

function findBlockingFindings(markdown: string): string[] {
  const findings = extractMarkdownSection(markdown, 'Findings');
  if (!findings || /^none\.?$/i.test(findings)) return [];

  const blockers: string[] = [];
  const headingPattern = /^###\s*(?:!|⊗)\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(findings)) !== null) {
    blockers.push(match[1]!.trim());
  }
  return blockers;
}

export function synthesizeReviewFromReports(opts: {
  issueId: string;
  reviewDir: string;
  reports: ReadonlyArray<{ subRole: ReviewSubRole; path: string; body: string }>;
}): DeaconReviewSynthesis {
  const blockers = opts.reports.flatMap(report =>
    findBlockingFindings(report.body).map(title => ({
      subRole: report.subRole,
      title,
      path: report.path,
    })),
  );
  const verdict: 'passed' | 'blocked' = blockers.length > 0 ? 'blocked' : 'passed';
  const topBlocker = blockers[0] ? `[${blockers[0].subRole}] ${blockers[0].title}` : '';
  const blockerSection = blockers.length > 0
    ? blockers.map(blocker => `### [${blocker.subRole}] ${blocker.title}\nSource: ${blocker.path}`).join('\n\n')
    : 'None';
  const cleanSubRoles = opts.reports
    .filter(report => !blockers.some(blocker => blocker.subRole === report.subRole))
    .map(report => `- ${report.subRole}`)
    .join('\n') || 'None';
  const convoyRows = opts.reports.map(report => {
    const blockingCount = findBlockingFindings(report.body).length;
    return `| ${report.subRole} | ready | ${report.path} | ${blockingCount} |`;
  }).join('\n');

  const body = [
    `# Review Synthesis — ${opts.issueId} — ${new Date().toISOString()}`,
    '',
    `## Verdict: ${verdict === 'passed' ? 'APPROVED' : `CHANGES REQUESTED — ${topBlocker}`}`,
    '',
    '## Context',
    '- Generated by Deacon fallback from completed on-disk reviewer reports.',
    `- Review directory: ${opts.reviewDir}`,
    '',
    '## Convoy Status',
    '| Sub-role | Signal | Output | Blocking findings |',
    '| --- | --- | --- | --- |',
    convoyRows,
    '',
    '## Blocking Findings',
    blockerSection,
    '',
    '## Non-blocking Findings',
    'See individual reviewer reports.',
    '',
    '## Clean Sub-roles',
    cleanSubRoles,
    '',
  ].join('\n');

  return { verdict, topBlocker, body };
}

/**
 * Respawn a convoy reviewer that has gone idle without writing its output.
 *
 * PAN-1806: when a reviewer hits a terminal API error it lands back at an idle
 * TUI prompt and never writes a report. Deacon detects that idle state and,
 * on the first occurrence, kills the stale session and starts a fresh reviewer
 * against the same runId, output path, and context manifest. The retry count is
 * persisted on the fresh agent state so a second idle detection signals failure.
 */
async function respawnIdleReviewer(state: AgentState, agentId: string): Promise<boolean> {
  const outputPath = state.reviewOutputPath;
  const attempt = (state.reviewRetryAttempt ?? 0) + 1;
  logDeaconEventSync(`monitorReviewConvoySignals: ${agentId} idle with no output — respawning reviewer (attempt ${attempt})`);

  try {
    await Effect.runPromise(killSession(agentId));
  } catch (err) {
    logDeaconEventSync(`monitorReviewConvoySignals: failed to kill ${agentId} before respawn: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!outputPath || !state.reviewSubRole || !state.reviewRunId) {
    logDeaconEventSync(`monitorReviewConvoySignals: cannot respawn ${agentId} — missing output/run/subRole`);
    return false;
  }

  try {
    const { spawnReviewSubRoleForIssue } = await import('./review-agent.js');
    const contextManifestPath = join(dirname(outputPath), 'context.json');
    const result = await Effect.runPromise(
      spawnReviewSubRoleForIssue({
        issueId: state.issueId,
        workspace: state.workspace,
        subRole: state.reviewSubRole as ReviewSubRole,
        runId: state.reviewRunId,
        outputPath,
        contextManifestPath,
        synthesisAgentId: state.reviewSynthesisAgentId,
        model: state.model,
        harness: state.harness,
        allowHost: state.hostOverride ?? false,
      }),
    );

    if (!result.success) {
      logDeaconEventSync(`monitorReviewConvoySignals: respawn of ${agentId} failed: ${result.error ?? result.message}`);
      return false;
    }

    const freshState = getAgentStateSync(agentId);
    if (freshState) {
      freshState.reviewRetryAttempt = attempt;
      saveAgentStateSync(freshState);
    }

    logDeaconEventSync(`monitorReviewConvoySignals: respawned ${agentId} as ${result.sessionId}`);
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logDeaconEventSync(`monitorReviewConvoySignals: respawn of ${agentId} threw: ${errMsg}`);
    return false;
  }
}

async function nudgeSynthesisForCompleteReviewerReports(states: readonly AgentState[]): Promise<string[]> {
  const actions: string[] = [];
  const now = Date.now();
  const synthesisStates = states.filter(state =>
    state.role === 'review'
    && !state.reviewSubRole
    && state.reviewRunId
    && state.workspace
    && state.issueId
  );

  for (const state of synthesisStates) {
    const status = getReviewStatusSync(state.issueId);
    if (!status || status.reviewStatus !== 'reviewing') continue;

    const reviewDir = join(state.workspace, '.pan', 'review', state.reviewRunId!);
    if (existsSync(join(reviewDir, 'synthesis.md'))) continue;

    const startedMs = Date.parse(state.startedAt);
    const readyLines: string[] = [];
    const reports: Array<{ subRole: ReviewSubRole; path: string; body: string }> = [];
    let allReportsPresent = true;
    for (const subRole of REVIEW_SUB_ROLES) {
      const outputPath = join(reviewDir, `${subRole}.md`);
      if (!existsSync(outputPath)) {
        allReportsPresent = false;
        break;
      }
      try {
        const outputMtimeMs = statSync(outputPath).mtimeMs;
        if (Number.isFinite(startedMs) && outputMtimeMs < startedMs) {
          allReportsPresent = false;
          break;
        }
      } catch {
        allReportsPresent = false;
        break;
      }
      try {
        reports.push({ subRole, path: outputPath, body: readFileSync(outputPath, 'utf8') });
      } catch {
        allReportsPresent = false;
        break;
      }
      readyLines.push(`REVIEWER_READY ${subRole} ${outputPath}`);
    }
    if (!allReportsPresent) continue;

    const nudgeKey = `${state.id}:${state.reviewRunId}`;
    const lastNudge = reviewReportsPresentNudges.get(nudgeKey);
    if (lastNudge && now - lastNudge < REVIEW_REPORTS_PRESENT_NUDGE_COOLDOWN_MS) continue;

    const sessionAlive = await Effect.runPromise(sessionExists(state.id)).catch(() => false);
    const paneDead = sessionAlive ? await Effect.runPromise(isPaneDead(state.id)).catch(() => true) : true;
    if (lastNudge || !sessionAlive || paneDead) {
      const synthesis = synthesizeReviewFromReports({
        issueId: state.issueId,
        reviewDir,
        reports,
      });
      writeFileSync(join(reviewDir, 'synthesis.md'), synthesis.body);
      setReviewStatusSync(state.issueId, {
        reviewStatus: synthesis.verdict,
        reviewNotes: synthesis.topBlocker || 'Review approved by Deacon fallback from completed reviewer reports',
      });
      if (synthesis.verdict === 'blocked') {
        await Effect.runPromise(deliverReviewVerdictFeedback({
          issueId: state.issueId,
          verdict: 'blocked',
          notes: synthesis.topBlocker || 'Review blocked by Deacon fallback from completed reviewer reports',
          workspacePath: state.workspace,
          prUrl: status.prUrl,
        }));
      }
      if (sessionAlive) {
        await Effect.runPromise(killSession(state.id)).catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          logDeaconEventSync(`monitorReviewConvoySignals: failed to kill synthesized parent ${state.id}: ${errMsg}`);
        });
      }
      const action = `Synthesized review for ${state.issueId} from ${REVIEW_SUB_ROLES.length} reviewer reports: ${synthesis.verdict}`;
      actions.push(action);
      logDeaconEventSync(`monitorReviewConvoySignals: ${action}`);
      continue;
    }

    const message = [
      'Deacon fallback: all reviewer report files for this review run are present on disk, but synthesis has not been written yet.',
      'If you have not already synthesized this run, treat these as the missing terminal reviewer signals and proceed now:',
      '',
      ...readyLines,
      '',
      'Read the four reports, write synthesis.md, then signal review status exactly as roles/review.md instructs.',
    ].join('\n');

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(state.id, message);
      reviewReportsPresentNudges.set(nudgeKey, now);
      const action = `Nudged ${state.id} to synthesize from ${REVIEW_SUB_ROLES.length} reviewer reports`;
      actions.push(action);
      logDeaconEventSync(`monitorReviewConvoySignals: ${action}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`monitorReviewConvoySignals: failed to nudge ${state.id} for complete reviewer reports: ${errMsg}`);
    }
  }

  return actions;
}

export async function monitorReviewConvoySignals(): Promise<string[]> {
  const actions: string[] = [];
  if (!existsSync(AGENTS_DIR)) return actions;

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-'));
  } catch {
    return actions;
  }

  const reviewStates: AgentState[] = [];

  for (const agentId of agentDirs) {
    // PAN-1908: use the agents table; fall back to state.json only for legacy dirs.
    const state = await Effect.runPromise(
      getAgentState(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
    ).then((dbState) => dbState ?? getAgentStateSync(agentId));
    if (!state) continue;
    if (state.role !== 'review') continue;
    reviewStates.push(state);
    if (!state.reviewSubRole || !state.reviewSynthesisAgentId) continue;
    if (state.reviewMonitorSignaled) continue;

    const startedMs = Date.parse(state.startedAt);

    // PAN-977: the review sub-role launcher now owns the convoy signal — it
    // signals synthesis on process exit (REVIEWER_READY/FAILED/TIMEOUT) and
    // touches `reviewer-signaled`. When that marker is newer than this run's
    // start, the launcher already signaled and Deacon must not double-signal.
    // Deacon stays the rare backup for the case where the launcher's bash
    // process was SIGKILLed before it could signal.
    const signalMarker = join(AGENTS_DIR, agentId, 'reviewer-signaled');
    if (existsSync(signalMarker)) {
      try {
        if (Number.isFinite(startedMs) && statSync(signalMarker).mtimeMs >= startedMs) continue;
      } catch { /* unreadable marker — fall through to backup signaling */ }
    }

    const outputPath = state.reviewOutputPath;
    let outputWrittenForThisRun = false;
    if (outputPath && existsSync(outputPath)) {
      try {
        const outputMtimeMs = statSync(outputPath).mtimeMs;
        outputWrittenForThisRun = Number.isFinite(startedMs) && outputMtimeMs >= startedMs;
      } catch {
        outputWrittenForThisRun = false;
      }
    }
    const deadlineMs = state.reviewDeadlineAt ? Date.parse(state.reviewDeadlineAt) : Number.NaN;

    // The synthesis agent must be alive to receive any signal.
    const synthesisAlive = await Effect.runPromise(sessionExists(state.reviewSynthesisAgentId));
    if (!synthesisAlive) continue;

    // PAN-1557: convoy reviewers are interactive now — there is no headless
    // launcher process / pid file. Liveness is the reviewer's own tmux session:
    // while it's alive the reviewer is still working (or idling attachably after
    // writing its report); once it's gone the reviewer has crashed or been
    // reaped. The Stop-hook is the primary signal (touches reviewer-signaled +
    // delivers REVIEWER_READY); Deacon is the backup for when that didn't fire.
    const reviewerSessionAlive = (await Effect.runPromise(sessionExists(agentId)).catch(() => false))
      && !(await Effect.runPromise(isPaneDead(agentId)).catch(() => true));

    // Startup grace: give the session time to come up before "gone" reads as death.
    const REVIEWER_STARTUP_GRACE_MS = 90_000;
    const withinStartupGrace = Number.isFinite(startedMs) && (Date.now() - startedMs) < REVIEWER_STARTUP_GRACE_MS;

    // PAN-1806: detect a reviewer that hit a terminal API error and is now
    // idle at its TUI prompt with no report written. The Stop-hook mirror
    // reports 'idle' once the model ends its turn; if that persists while the
    // session is alive and the output file is missing, fail fast rather than
    // wait for the hard deadline. Retry once before signaling failure.
    const runtimeState = getAgentRuntimeStateSync(agentId);
    const runtimeIdleAgeMs =
      runtimeState?.state === 'idle'
        ? Date.now() - new Date(runtimeState.lastActivity).getTime()
        : 0;
    const idleAndNoOutput = reviewerSessionAlive && !outputWrittenForThisRun && runtimeIdleAgeMs > REVIEWER_IDLE_FAILURE_MS;

    // PAN-1818: context-window overflow is deterministic on the same diff/manifest.
    // Capture the pane tail and fast-fail BEFORE the idle-respawn branch so we never
    // burn another cycle respawning a reviewer that will re-overflow. Only check when
    // the reviewer is idle at its prompt — an active reviewer cannot have hit a 400 yet.
    let contextOverflowDetected = false;
    if (!outputWrittenForThisRun && runtimeState?.state === 'idle') {
      const tail = await Effect.runPromise(capturePane(agentId, 100)).catch(() => '');
      contextOverflowDetected = isContextOverflowTail(tail);
    }

    let signal: 'ready' | 'failed' | 'timeout' | null = null;
    let reason = '';
    if (outputWrittenForThisRun) {
      // Report exists for this run but the Stop-hook didn't signal (no fresh
      // marker) — back it up with READY. Safe: the report is on disk.
      signal = 'ready';
    } else if (contextOverflowDetected) {
      signal = 'failed';
      reason = 'context-window overflow (no retry — deterministic)';
    } else if (idleAndNoOutput) {
      const attempt = state.reviewRetryAttempt ?? 0;
      if (attempt < 1 && (await respawnIdleReviewer(state, agentId))) {
        continue;
      }
      signal = 'failed';
      reason = `reviewer idle with no output after terminal API error${attempt >= 1 ? ' (retry exhausted)' : ' (retry failed)'}`;
    } else if (reviewerSessionAlive) {
      // Still working or idling attachably. Only intervene if well past the
      // deadline (genuinely wedged).
      if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs + REVIEWER_STARTUP_GRACE_MS) {
        signal = 'timeout';
        reason = `reviewer still running past deadline ${state.reviewDeadlineAt}`;
      } else {
        continue;
      }
    } else if (withinStartupGrace) {
      // Session not up yet — too early to call it dead.
      continue;
    } else if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs) {
      signal = 'timeout';
      reason = `reviewer exceeded deadline ${state.reviewDeadlineAt}`;
    } else {
      // Session gone, no report, before deadline → reviewer crashed or exited
      // before writing a report.
      signal = 'failed';
      reason = 'reviewer session ended before writing a report';
    }

    if (!signal) continue;

    const message = signal === 'ready'
      ? `REVIEWER_READY ${state.reviewSubRole} ${outputPath}`
      : signal === 'timeout'
        ? `REVIEWER_TIMEOUT ${state.reviewSubRole} ${reason}`
        : `REVIEWER_FAILED ${state.reviewSubRole} ${reason}`;

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(state.reviewSynthesisAgentId, message);
      state.reviewMonitorSignaled = signal;
      saveAgentStateSync(state);
      const action = `Signaled ${message} to ${state.reviewSynthesisAgentId}`;
      actions.push(action);
      logDeaconEventSync(`monitorReviewConvoySignals: ${action}`);
      if (signal === 'ready') {
        try {
          const { notifyPipelineSync } = await import('../pipeline-notifier.js');
          notifyPipelineSync({ type: 'reviewer_completed', issueId: state.issueId, role: state.reviewSubRole });
        } catch { /* non-fatal */ }
      } else if (signal === 'timeout') {
        try {
          const { notifyPipelineSync } = await import('../pipeline-notifier.js');
          notifyPipelineSync({
            type: 'reviewer_timed_out',
            issueId: state.issueId,
            role: state.reviewSubRole,
            sessionName: agentId,
            attempt: 1,
            maxRetries: 1,
            willRetry: false,
          });
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`monitorReviewConvoySignals: failed to signal ${state.reviewSynthesisAgentId} for ${agentId}: ${errMsg}`);
    }
  }

  actions.push(...await nudgeSynthesisForCompleteReviewerReports(reviewStates));

  return actions;
}

/**
 * Kill orphaned review sessions whose work agent is no longer running.
 *
 * Covers three naming patterns:
 *   - PAN-1059 convoy: `agent-<issueId>-review-<subRole>` (current)
 *   - Legacy specialist: `specialist-*-review-*` (retired)
 *   - Legacy batch: `review-<issueId>-<timestamp>-<role>` (retired)
 *
 * A session is "orphaned" when the corresponding work-agent session
 * `agent-<issueLower>` does not exist.
 */
export async function cleanupOrphanedReviewSessions(): Promise<string[]> {
  const actions: string[] = [];
  let reviewSessions: string[];
  try {
    const allSessions = await Effect.runPromise(listSessionNames());
    const convoyReviewSessions = allSessions.filter(s => /^agent-.*-review-(?:security|correctness|performance|requirements)$/.test(s));
    const legacyReviewSessions = allSessions.filter(s => /^review-/.test(s));
    const canonicalReviewSessions = allSessions.filter(s => /^specialist-.*-review-/.test(s));
    reviewSessions = [...new Set([...convoyReviewSessions, ...legacyReviewSessions, ...canonicalReviewSessions])];
  } catch {
    return actions;
  }

  logDeaconEventSync(`cleanupOrphanedReviewSessions started: found ${reviewSessions.length} review session(s)`);

  for (const reviewSession of reviewSessions) {
    let issueId: string | null = null;

    // PAN-1059 convoy pattern
    const convoyMatch = reviewSession.match(/^agent-([a-z0-9]+-\d+)-review-(?:security|correctness|performance|requirements)$/);
    if (convoyMatch) {
      issueId = convoyMatch[1].toUpperCase();
    } else {
      // Legacy batch pattern: review-<issueId>-<timestamp>
      const legacyMatch = reviewSession.match(/^review-([A-Za-z0-9]+-\d+)-\d+/);
      if (legacyMatch) {
        issueId = legacyMatch[1].toUpperCase();
      } else {
        // Legacy specialist pattern: specialist-<project>-<issueId>-review-<role>
        const canonicalMatch = reviewSession.match(/^specialist-(.+)-([A-Za-z0-9]+-\d+)-review-[a-z-]+$/);
        if (canonicalMatch) {
          issueId = canonicalMatch[2].toUpperCase();
        }
      }
    }

    if (!issueId) {
      logDeaconEventSync(`cleanupOrphanedReviewSessions: ${reviewSession} skipped — unparseable session name`);
      continue;
    }

    // PAN-1059 convoy sub-reviewers are owned by the synthesis agent
    // (agent-<id>-review), not the work agent. Check synthesis first,
    // then fall back to work agent for legacy review sessions.
    const synthesisAgentSession = `agent-${issueId.toLowerCase()}-review`;
    const workAgentSession = `agent-${issueId.toLowerCase()}`;
    if (sessionExistsSync(synthesisAgentSession)) {
      logDeaconEventSync(`cleanupOrphanedReviewSessions: ${reviewSession} kept — synthesis agent ${synthesisAgentSession} exists`);
      continue;
    }
    if (sessionExistsSync(workAgentSession)) {
      logDeaconEventSync(`cleanupOrphanedReviewSessions: ${reviewSession} kept — work agent ${workAgentSession} exists`);
      continue;
    }

    try {
      await Effect.runPromise(killSession(reviewSession)).catch(() => {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`cleanupOrphanedReviewSessions: error killing ${reviewSession}: ${reason}`);
    }

    const msg = `Killed orphaned ${reviewSession} (synthesis ${synthesisAgentSession} and work ${workAgentSession} not running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEventSync(`cleanupOrphanedReviewSessions: ${msg}`);
  }
  if (actions.length > 0) {
    logDeaconEventSync(`cleanupOrphanedReviewSessions completed: killed ${actions.length} orphaned session(s)`);
  } else {
    logDeaconEventSync(`cleanupOrphanedReviewSessions completed: no orphaned sessions found`);
  }

  return actions;
}

/**
 * Nudge work agents that are alive-but-idle with open beads remaining.
 *
 * Detects the gap that autoResumeStoppedWorkAgents misses: agents whose tmux
 * session is alive and `state.status === 'running'`, but whose Stop hook has
 * fired (state='idle' in the runtime mirror) and have NOT advanced. The
 * existing recovery paths only fire on `status='stopped'` (process killed)
 * or on a downstream review failure — neither matches this case.
 *
 * Triggered when ALL of the following hold:
 *   - state.status === 'running'                  (process still alive)
 *   - phase === 'implementation' or 'review-response'
 *   - tmux session exists                          (not orphaned)
 *   - isAgentIdleForNudge() returns true           (Stop hook authoritative)
 *   - bd ready -l <issueLabel> has ≥1 ready bead   (work remaining)
 *   - last nudge older than NUDGE_COOLDOWN_MS      (don't spam)
 *
 * Action: send `pan tell` with a concrete imperative pointing at the next
 * ready bead. Updates `<agentDir>/.last-bead-nudge` for cooldown.
 *
 * Returns a list of action descriptions for runPatrol to log.
 */
const BEAD_NUDGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const STALLED_RESUME_NUDGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function hasLandedUserRecordSinceResume(state: AgentState, snapshot: Awaited<ReturnType<typeof captureTranscriptUserRecordSnapshot>>): boolean {
  const resumeAt = state.lastResumeAt ? Date.parse(state.lastResumeAt) : NaN;
  if (!Number.isFinite(resumeAt)) return true;
  const lastUserAt = snapshot.lastUserRecord?.timestamp ? Date.parse(snapshot.lastUserRecord.timestamp) : NaN;
  if (!Number.isFinite(lastUserAt)) return snapshot.userRecordCount > 0;
  return lastUserAt >= resumeAt;
}

function stalledResumeCooldownActive(agentId: string): boolean {
  const cooldownFile = join(getAgentDir(agentId), '.last-stalled-resume-nudge');
  if (!existsSync(cooldownFile)) return false;
  try {
    const last = parseInt(readFileSync(cooldownFile, 'utf-8').trim(), 10);
    return !Number.isNaN(last) && Date.now() - last < STALLED_RESUME_NUDGE_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function recordStalledResumeCooldown(agentId: string): void {
  writeFileSync(join(getAgentDir(agentId), '.last-stalled-resume-nudge'), String(Date.now()), 'utf-8');
}

function buildStalledResumePrompt(state: AgentState): string | null {
  if (state.kickoffDelivered === false) {
    const promptPath = join(getAgentDir(state.id), 'initial-prompt.md');
    try {
      return readFileSync(promptPath, 'utf-8');
    } catch (err) {
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${state.id} skipped — kickoffDelivered=false but ${promptPath} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  return buildDefaultResumeContinueMessage(state.issueId);
}

export async function nudgeStalledResumeWorkAgents(): Promise<string[]> {
  const actions: string[] = [];

  const states = listAgentStates({ status: 'running', role: 'work' });

  for (const state of states) {
    const agentId = state.id;
    if (state.paused || state.troubled) continue;
    if (!state.lastResumeAt) continue;
    if (await isIssueClosed(state.issueId)) continue;
    if (!await Effect.runPromise(sessionExists(agentId))) continue;
    if (!isAgentIdleForNudge(agentId)) continue;
    if (stalledResumeCooldownActive(agentId)) continue;

    const sessionId = state.sessionId;
    if (!sessionId) continue;
    const snapshot = await captureTranscriptUserRecordSnapshot(state.workspace, sessionId);
    if (hasLandedUserRecordSinceResume(state, snapshot)) continue;

    const message = buildStalledResumePrompt(state);
    if (!message) continue;

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(agentId, message);
      recordStalledResumeCooldown(agentId);
      const action = `Re-sent stalled resume prompt to ${agentId} (${state.issueId})`;
      actions.push(action);
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${action}`);
    } catch (err: any) {
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${agentId} messageAgent failed: ${err?.message ?? err}`);
    }
  }

  return actions;
}

export async function nudgeIdleWorkAgentsWithOpenBeads(): Promise<string[]> {
  const actions: string[] = [];

  const states = listAgentStates({ status: 'running', role: 'work' });

  for (const state of states) {
    const agentId = state.id;
    if (await isIssueClosed(state.issueId)) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} skipped — issue ${state.issueId} is closed`);
      continue;
    }

    // Tmux must be alive; orphans are handled by recoverOrphanedAgents.
    if (!await Effect.runPromise(sessionExists(agentId))) continue;

    // Authoritative idle signal — Stop hook fired and runtime mirror is idle.
    // Skips agents currently mid-thought (state='active') and ones we already
    // know are stopped/suspended.
    if (!isAgentIdleForNudge(agentId)) continue;

    // Cooldown — don't nudge the same agent more than once per BEAD_NUDGE_COOLDOWN_MS.
    const cooldownFile = join(getAgentDir(agentId), '.last-bead-nudge');
    if (existsSync(cooldownFile)) {
      try {
        const last = parseInt(readFileSync(cooldownFile, 'utf-8').trim(), 10);
        if (!Number.isNaN(last) && Date.now() - last < BEAD_NUDGE_COOLDOWN_MS) continue;
      } catch { /* fall through and nudge */ }
    }

    // Open beads for THIS issue?
    const issueLabel = state.issueId.toLowerCase();
    let openBeads: string[] = [];
    try {
      const { stdout } = await execAsync(`bd ready -l ${issueLabel}`, {
        cwd: state.workspace,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      // bd ready output: lines starting with "○ workspace-XXXX ● ... pan-NNN: title"
      openBeads = stdout
        .split('\n')
        .filter(l => /^[○◐]\s+workspace-/i.test(l.trim()))
        .map(l => l.trim());
    } catch (err: any) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} bd ready failed: ${err?.message ?? err}`);
      continue;
    }
    if (openBeads.length === 0) continue;

    // Build the nudge: tell the agent what's next, do not just ping.
    const firstBead = openBeads[0]?.replace(/^[○◐]\s+/, '').slice(0, 200) ?? '';
    // PAN-2102: startup kickoff delivery can silently fail on large briefs (the
    // ~50KB initial prompt trips the PTY supervisor's echo-confirm), leaving the
    // agent running with NO original context — only this nudge. Point it at the
    // brief on disk so it can self-recover the full plan/role/decisions/hazards
    // instead of guessing from the bead title alone.
    const briefPath = join(getAgentDir(agentId), 'initial-prompt.md');
    const message = [
      `Deacon idle-nudge: your tmux is alive but Claude is idle and you have ${openBeads.length} open bead(s) remaining for ${state.issueId}.`,
      ``,
      `Next ready bead: ${firstBead}`,
      ``,
      `If you don't already have your full brief for ${state.issueId} in context (work-agent role instructions, the vBRIEF plan, recorded decisions & hazards), re-read it now — it is on disk at ${briefPath}, plus .pan/continue.json and .pan/spec.vbrief.json in your workspace. Startup kickoff delivery can silently fail on large briefs, so do not assume you received it.`,
      ``,
      `Continue the per-bead workflow without asking — claim it (\`bd update <bead-id> --claim\`), implement, commit, close. ` +
      `Inspection is conditional on metadata.requiresInspection (default false; check the plan item before deciding to call \`pan inspect\`). ` +
      `Do NOT end your turn with a multi-paragraph summary; just advance to the next bead.`,
    ].join('\n');

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(agentId, message);
      writeFileSync(cooldownFile, String(Date.now()), 'utf-8');
      const action = `Nudged idle ${agentId} (${state.issueId}) — ${openBeads.length} open bead(s)`;
      actions.push(action);
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${action}`);
    } catch (err: any) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} messageAgent failed: ${err?.message ?? err}`);
    }
  }

  return actions;
}

/**
 * Auto-resume work agents that were stopped by a system crash/reboot
 * but still have incomplete work. Scans all agent state directories for
 * stopped work-role agents and resumes them.
 *
 * Resumption rules:
 * - Agents with pending review feedback (blocked/failed/verification-failed)
 *   are ALWAYS resumed — the specialist pipeline needs them to fix issues.
 * - Agents without pending feedback are skipped if stoppedByUser=true (the
 *   user deliberately killed them via pan kill / pan done).
 * - Orphaned agents (tmux session missing, no stoppedByUser flag) are resumed.
 *
 * Called by runPatrol() on every patrol cycle AND during deacon startup.
 *
 * PAN-1665: bounded by the concurrency governor. An unfreeze used to mass-resume
 * every stopped work agent back-to-back, marching the box toward dozens of heavy
 * `claude` processes (load spiked 5→52). We now resume only up to the number of
 * free work slots (`max_work_agents − runningWork`); at or over the cap we resume
 * nothing and let attrition drain. This is a gate on *starting* work — it never
 * kills a running agent. The load gate and stagger below are secondary safety
 * valves. Remaining candidates are re-evaluated next patrol, so nothing is
 * dropped — only spread out and bounded.
 */
// Skip the rest of this cycle once 1-minute load exceeds cores * this factor.
const RESUME_LOAD_FACTOR = 1.5;
// Pause between consecutive resume spawns so the herd is spread across the cycle.
const RESUME_STAGGER_MS = 150;

function shouldRetryUndeliveredKickoff(state: AgentState): boolean {
  return state.role === 'work' && state.kickoffDelivered === false;
}

interface HandleAgentStoppedOptions {
  /** When true, the caller is managing global concurrency/load gates. */
  skipGlobalGates?: boolean;
  /** Descriptive source for log messages. */
  context?: string;
}

/**
 * PAN-1908: event-driven resume decision for a stopped agent. Called by the
 * reactive scheduler on `agent.stopped` and by the thin safety-net reconcile.
 * Does not enumerate directories — it evaluates the single agent ID it was given.
 */
export async function handleAgentStoppedEvent(
  agentId: string,
  opts: HandleAgentStoppedOptions = {},
): Promise<string | null> {
  const { skipGlobalGates = false, context = 'event' } = opts;
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — OVERDECK_NO_RESUME=1`);
    return null;
  }

  const state = getAgentStateSync(agentId);
  if (!state) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — no state`);
    return null;
  }
  if (state.status !== 'stopped') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — status=${state.status} (not stopped)`);
    return null;
  }
  if (state.role !== 'work') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — role=${state.role} (not work)`);
    return null;
  }

  // Skip if workspace is missing
  if (!state.workspace || !existsSync(state.workspace)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — workspace missing (${state.workspace || 'undefined'})`);
    return null;
  }

  if (state.paused === true) {
    const pauseKind = isVerifyPausedAgentState(state) ? 'verify-paused' : 'manually-paused';
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — ${pauseKind} (${state.pausedReason ?? 'no reason'})`);
    return null;
  }

  if (state.troubled === true) {
    const failureCount = state.consecutiveFailures ?? 0;
    const since = state.firstFailureInRunAt ?? state.troubledAt ?? 'unknown';
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — troubled (${failureCount} consecutive failures since ${since})`);
    return null;
  }

  const hasLiveTmuxSession = await Effect.runPromise(sessionExists(agentId));
  if (hasLiveTmuxSession) {
    const previousStatus = state.status;
    markAgentRunningState(state);
    await Effect.runPromise(saveAgentState(state));
    notifyAgentStatusChanged(state, previousStatus, true);
    const msg = `Reconciled ${agentId} (${previousStatus}→running; tmux session alive)`;
    logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
    return null;
  }

  if (state.lastFailureNextRetryAt !== undefined) {
    const nextRetryMs = Date.parse(state.lastFailureNextRetryAt);
    if (Number.isFinite(nextRetryMs) && nextRetryMs > Date.now()) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — backoff active (next retry at ${state.lastFailureNextRetryAt})`);
      return null;
    }
  }

  // Skip if the agent has a completed marker (or processed completion) — unless
  // review or test found issues that need fixing (blocked / failed).
  const completedFile = join(getAgentDir(agentId), 'completed');
  const processedFile = join(getAgentDir(agentId), 'completed.processed');
  const handedOffViaDone = existsSync(completedFile) || existsSync(processedFile);
  let review = getReviewStatusSync(state.issueId);
  if (handedOffViaDone) {
    const needsFix =
      review?.reviewStatus === 'blocked' ||
      review?.reviewStatus === 'failed' ||
      review?.testStatus === 'failed';
    const trulyPassed =
      review?.reviewStatus === 'passed' && review?.testStatus === 'passed';
    if (needsFix) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} resuming despite completed marker — review/test needs fixing (review=${review?.reviewStatus}, test=${review?.testStatus})`);
    } else if (trulyPassed) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — completed marker exists and review/test passed`);
      return null;
    } else {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — pipeline mid-flight (review=${review?.reviewStatus ?? 'none'}, test=${review?.testStatus ?? 'none'})`);
      return null;
    }
  }

  // Refresh review status if we haven't loaded it yet.
  review ??= getReviewStatusSync(state.issueId);

  // Skip if already merge-ready (review+test passed) or already merged
  if (review?.readyForMerge && review.reviewStatus === 'passed' && review.testStatus === 'passed') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — already merge-ready`);
    return null;
  }
  if (review?.mergeStatus === 'merged') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — already merged`);
    return null;
  }

  if ((state as any).merged === true) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — agent state has merged=true (mergedAt=${(state as any).mergedAt ?? 'unknown'})`);
    return null;
  }

  if (await isIssueClosed(state.issueId)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — issue ${state.issueId} is closed`);
    return null;
  }

  const hasPendingReviewFeedback =
    review?.reviewStatus === 'blocked' ||
    review?.reviewStatus === 'failed' ||
    review?.testStatus === 'failed' ||
    review?.verificationStatus === 'failed';

  const deliberatelyStopped = state.stoppedByUser === true;
  if (deliberatelyStopped && !(handedOffViaDone && hasPendingReviewFeedback)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — deliberately stopped by user (stoppedByUser=true)`);
    return null;
  }

  if (hasPendingReviewFeedback) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} resuming — review feedback pending (review=${review?.reviewStatus}, test=${review?.testStatus}, verification=${review?.verificationStatus})`);
  } else {
    const runtimeState = getAgentRuntimeStateSync(agentId);
    if (runtimeState?.state === 'idle' && !shouldRetryUndeliveredKickoff(state)) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — idle (runtime.state=idle, no review feedback)`);
      return null;
    }
  }

  // Global gates (skipped when the batch reconcile is driving the loop).
  if (!skipGlobalGates) {
    const concurrencyLimits = getConcurrencyLimits();
    const runningBefore = countRunningAgents();
    const workSlots = workResumeSlotsAvailable(runningBefore, concurrencyLimits);
    if (workSlots <= 0) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} deferred — work concurrency cap reached (running=${runningBefore.work}, max=${concurrencyLimits.maxWorkAgents}, slots=${workSlots})`);
      return null;
    }
    const cores = cpus().length || 1;
    const loadCeiling = cores * RESUME_LOAD_FACTOR;
    const load1 = loadavg()[0];
    if (load1 > loadCeiling) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} deferred — load gate tripped (load1=${load1.toFixed(2)} > ${loadCeiling.toFixed(2)})`);
      return null;
    }
  }

  const runtimeStateForLog = getAgentRuntimeStateSync(agentId);
  logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} candidate — calling resumeAgent (issueId=${state.issueId}, runtime.state=${runtimeStateForLog?.state || 'null'})`);
  try {
    const result = await resumeAgent(agentId);
    if (result.success) {
      const resumedState = await Effect.runPromise(getAgentState(agentId));
      if (resumedState) {
        notifyAgentStatusChanged(resumedState, state.status, true);
      }
      const msg = `Auto-resumed ${agentId} (was orphaned by system event)`;
      console.log(`[deacon] ${msg}`);
      logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
      logAgentLifecycleSync(agentId, `resumed by deacon auto-recovery (session restored after system event)`);
      const issueId = state.issueId;
      emitActivityEntrySync({
        source: 'cloister',
        level: 'info',
        message: issueId
          ? `Deacon auto-resumed ${issueId} work agent`
          : `Deacon auto-resumed agent ${agentId}`,
        issueId,
      });
      emitActivityTtsSync({
        utterance: issueId
          ? `Deacon auto resumed ${issueId} work agent`
          : `Deacon auto resumed agent ${agentId}`,
        priority: 1,
        issueId,
        source: 'cloister',
        eventType: 'agent.autoResumed',
      });
      return agentId;
    }
    const msg = `Failed to auto-resume ${agentId}: ${result.error}`;
    if (!orphanFailureRecordedForAutoResume.has(agentId)) {
      const failedState = await Effect.runPromise(recordAgentFailure(agentId, msg));
      if (failedState) {
        notifyAgentStatusChanged(failedState, state.status, false);
      }
    }
    console.warn(`[deacon] ${msg}`);
    logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
    logAgentLifecycleSync(agentId, `auto-resume FAILED: ${result.error}`);
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!orphanFailureRecordedForAutoResume.has(agentId)) {
      const failedState = await Effect.runPromise(recordAgentFailure(agentId, `Auto-resume error for ${agentId}: ${msg}`));
      if (failedState) {
        notifyAgentStatusChanged(failedState, state.status, false);
      }
    }
    console.warn(`[deacon] Auto-resume error for ${agentId}: ${msg}`);
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} auto-resume threw: ${msg}`);
    logAgentLifecycleSync(agentId, `auto-resume threw exception: ${msg}`);
    return null;
  }
}

export async function autoResumeStoppedWorkAgents(): Promise<string[]> {
  const resumed: string[] = [];
  // PAN-1665: count spawn attempts (not just successes) — a failed resume still
  // forks a `claude` process, so the budget must bound attempts to curb the herd.
  let resumeAttempts = 0;
  // Free work slots this patrol = max_work_agents − running work agents. Zero when
  // already at/over the cap, in which case we resume nothing (never kill). Computed
  // once: newly-resumed sessions take time to register as tmux-alive, so we count
  // attempts against this fixed budget rather than re-polling mid-loop.
  const concurrencyLimits = getConcurrencyLimits();
  const runningBefore = countRunningAgents();
  const workSlots = workResumeSlotsAvailable(runningBefore, concurrencyLimits);
  const cores = cpus().length || 1;
  const loadCeiling = cores * RESUME_LOAD_FACTOR;
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync('OVERDECK_NO_RESUME=1 — skipping autoResumeStoppedWorkAgents');
    orphanFailureRecordedForAutoResume.clear();
    return resumed;
  }

  // PAN-1908: authoritative registry is the agents table; no directory scan.
  const candidates = listAllAgents()
    .filter((agent) => agent.status === 'stopped' && agent.role === 'work')
    .map((agent) => agent.id);

  logDeaconEventSync(`autoResumeStoppedWorkAgents started: ${candidates.length} candidate(s) from agents table`);

  for (const agentId of candidates) {
    // PAN-1665 concurrency gate: resume only up to the free work slots, and bail
    // when load is high. At/over the cap workSlots is 0 → we resume nothing and let
    // attrition drain (never kill). Deferred candidates are re-evaluated next patrol.
    if (resumeAttempts >= workSlots) {
      logDeaconEventSync(`autoResumeStoppedWorkAgents: work concurrency cap reached (running=${runningBefore.work}, max=${concurrencyLimits.maxWorkAgents}, slots=${workSlots}); deferring remaining candidates to next patrol`);
      break;
    }
    const load1 = loadavg()[0];
    if (load1 > loadCeiling) {
      logDeaconEventSync(`autoResumeStoppedWorkAgents: load gate tripped (load1=${load1.toFixed(2)} > ${loadCeiling.toFixed(2)} = ${cores} cores * ${RESUME_LOAD_FACTOR}); deferring remaining candidates to next patrol`);
      break;
    }
    // Stagger spawns so the scheduler can absorb each `claude` before the next.
    if (resumeAttempts > 0) {
      await new Promise(r => setTimeout(r, RESUME_STAGGER_MS));
    }

    const result = await handleAgentStoppedEvent(agentId, { skipGlobalGates: true, context: 'patrol' });
    if (result) {
      resumed.push(result);
      resumeAttempts++;
    }
  }
  if (resumed.length > 0) {
    console.log(`[deacon] Auto-resumed ${resumed.length} work agent(s): ${resumed.join(', ')}`);
    logDeaconEventSync(`autoResumeStoppedWorkAgents completed: resumed ${resumed.length} agent(s): ${resumed.join(', ')}`);
  } else {
    logDeaconEventSync(`autoResumeStoppedWorkAgents completed: no agents resumed`);
  }
  orphanFailureRecordedForAutoResume.clear();
  return resumed;
}

/**
 * PAN-1908: thin safety-net reconcile for dropped lifecycle events. Queries the
 * authoritative agents table (no directory scan) and re-runs the event handlers
 * for any row that is inconsistent with live tmux state or should have resumed.
 * The primary path is reactive (agent.stopped / agent.heartbeat_dead events);
 * this is only a fallback.
 */
export async function reconcileAgentLiveness(): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync('OVERDECK_NO_RESUME=1 — skipping reconcileAgentLiveness');
    return [];
  }

  const actions: string[] = [];
  const agents = listAllAgents();

  // Orphans: agents the registry says are running/starting but have no live tmux.
  const orphanCandidates = agents
    .filter((agent) => agent.status === 'running' || agent.status === 'starting')
    .map((agent) => agent.id)
    .filter((id) => !sessionExistsSync(id));

  for (const agentId of orphanCandidates) {
    const result = await handleAgentHeartbeatDeadEvent(agentId, 'reconcile');
    actions.push(...result);
  }

  // Stopped work agents that may have missed an agent.stopped event.
  const stoppedWorkCandidates = agents
    .filter((agent) => agent.status === 'stopped' && agent.role === 'work')
    .map((agent) => agent.id);

  for (const agentId of stoppedWorkCandidates) {
    const resumed = await handleAgentStoppedEvent(agentId, { context: 'reconcile' });
    if (resumed) actions.push(`Auto-resumed ${agentId} via reconcile`);
  }

  if (actions.length > 0) {
    logDeaconEventSync(`reconcileAgentLiveness completed: ${actions.length} action(s)`);
  } else {
    logDeaconEventSync('reconcileAgentLiveness completed: no actions needed');
  }
  return actions;
}

export function startDeacon(): void {
  if (deaconInterval) {
    console.log('[deacon] Already running');
    return;
  }

  config = loadConfig();
  console.log(`[deacon] Starting health monitor (patrol every ${config.patrolIntervalMs / 1000}s)`);
  logDeaconEventSync(`startDeacon: health monitor starting (patrol every ${config.patrolIntervalMs / 1000}s)`);

  // Recover agents whose tmux sessions were killed by a system crash before the
  // first patrol. PAN-1908: use the thin table-query reconcile instead of directory scans.
  void (async () => {
    await reconcileAgentLiveness();
    await runPatrol();
  })().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[deacon] Startup recovery/patrol error:', err);
    logDeaconEventSync(`startDeacon: startup recovery/patrol error: ${msg}`);
  });

  // Schedule regular patrols
  deaconInterval = setInterval(() => {
    runPatrol().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[deacon] Patrol error:', err);
      logDeaconEventSync(`patrol error: ${msg}`);
    });
  }, config.patrolIntervalMs);

  logDeaconEventSync('startDeacon: health monitor started');
}

/**
 * Stop the deacon patrol loop
 */
export function stopDeacon(): void {
  if (deaconInterval) {
    clearInterval(deaconInterval);
    deaconInterval = null;
    console.log('[deacon] Stopped health monitor');
  }
}

/**
 * Check if deacon is running
 */
export function isDeaconRunning(): boolean {
  return deaconInterval !== null;
}

/**
 * Get current deacon status
 */
export function getDeaconStatus(): {
  isRunning: boolean;
  config: DeaconConfig;
  state: DeaconState;
} {
  return {
    isRunning: isDeaconRunning(),
    config: loadConfig(),
    state: loadState(),
  };
}

export function assessDeaconPatrolFreshness(
  params: {
    isRunning: boolean;
    lastPatrol?: string;
    patrolIntervalMs: number;
    nowMs?: number;
  }
): DeaconPatrolFreshness {
  const staleAfterSeconds = Math.ceil((params.patrolIntervalMs * 3) / 1000);
  if (!params.isRunning) {
    return {
      status: 'stopped',
      lastPatrol: params.lastPatrol ?? null,
      secondsSinceLastPatrol: null,
      staleAfterSeconds,
    };
  }

  if (!params.lastPatrol) {
    return {
      status: 'starting',
      lastPatrol: null,
      secondsSinceLastPatrol: null,
      staleAfterSeconds,
    };
  }

  const nowMs = params.nowMs ?? Date.now();
  const lastPatrolMs = Date.parse(params.lastPatrol);
  if (!Number.isFinite(lastPatrolMs)) {
    return {
      status: 'stale',
      lastPatrol: params.lastPatrol,
      secondsSinceLastPatrol: null,
      staleAfterSeconds,
    };
  }

  const secondsSinceLastPatrol = Math.max(0, Math.floor((nowMs - lastPatrolMs) / 1000));
  return {
    status: secondsSinceLastPatrol > staleAfterSeconds ? 'stale' : 'running',
    lastPatrol: params.lastPatrol,
    secondsSinceLastPatrol,
    staleAfterSeconds,
  };
}
