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
// helpers below (`readFileEffect`, `writeFileEffect`, `unlinkEffect`).
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { Effect } from 'effect';
import {
  FsError,
  GitError,
  ProcessSpawnError,
  ProcessTimeoutError,
} from '../errors.js';

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
const execAsyncEffect = (
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
const execFileAsyncEffect = (
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
const readFileEffect = (path: string): Effect.Effect<string, FsError> =>
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
const writeFileEffect = (path: string, data: string): Effect.Effect<void, FsError> =>
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
const unlinkEffect = (path: string): Effect.Effect<void, FsError> =>
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

import { PANOPTICON_HOME, AGENTS_DIR } from '../paths.js';
import { loadCloisterConfig, loadCloisterConfigAsync } from './config.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { setReviewStatus, loadReviewStatuses, getReviewStatus, type ReviewStatus } from '../review-status.js';
import { markWorkspaceStuck } from '../database/review-status-db.js';
import { isDeaconGloballyPaused } from '../database/app-settings.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { resolveProjectFromIssue, listProjects, getProject } from '../projects.js';
import { resolveGitHubIssue } from '../tracker-utils.js';
import { mapGitHubStateToCanonical } from '../../core/state-mapping.js';
import { logDeaconEvent, logAgentLifecycle } from '../persistent-logger.js';
import { emitActivityTts } from '../activity-logger.js';
import { getShadowState } from '../shadow-state.js';
import type { TrackerConfig } from '../tracker/factory.js';

// Review status file location (same as dashboard server)

import {
  SpecialistAgentName,
  getTmuxSessionName,
  isRunning,
  getAllProjectSpecialistStatuses,
} from './specialists.js';
import { getAgentRuntimeState, saveAgentRuntimeState, saveSessionId, listRunningAgents, getAgentDir, getAgentState, getAgentStateAsync, saveAgentState, saveAgentStateAsync, resumeAgent, recordAgentFailureAsync, type AgentState } from '../agents.js';
import { dropStash, isOlderThanDays, listStashes } from '../stashes.js';
import { emitActivityEntry } from '../activity-logger.js';
import { buildTmuxCommandString, capturePaneAsync, createSessionAsync, isPaneDeadAsync, killSession, killSessionAsync, listPaneValues, listPaneValuesAsync, listSessionNamesAsync, sessionExists, sessionExistsAsync, sendKeysAsync } from '../tmux.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default parameters for stuck-session detection.
 * Per gastown: "Let agents decide thresholds. 'Stuck' is a judgment call."
 */
const DEFAULT_STASH_JANITOR_AGE_DAYS = 28;
const STASH_JANITOR_BASELINE_MISSING_PATTERNS = [
  'unknown revision or path not in the working tree',
  'bad revision',
  'ambiguous argument',
  'fatal: invalid revision range',
];

const DEFAULT_CONFIG: DeaconConfig = {
  pingTimeoutMs: 30_000,           // How long to wait for response
  consecutiveFailures: 3,          // Failures before force-kill
  cooldownMs: 5 * 60_000,          // 5 minutes between force-kills
  patrolIntervalMs: 60_000,        // Safety net — immediate processing happens via pipeline events
  massDeathThreshold: 2,           // Deaths within window triggers alert
  massDeathWindowMs: 60_000,       // 1 minute window for mass death detection
  stashJanitorEveryCycles: 60,
};

export interface DeaconConfig {
  pingTimeoutMs: number;
  consecutiveFailures: number;
  cooldownMs: number;
  patrolIntervalMs: number;
  massDeathThreshold: number;
  massDeathWindowMs: number;
  stashJanitorEveryCycles: number;
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

const DEACON_DIR = join(PANOPTICON_HOME, 'deacon');
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

  const cloisterConfig = loadCloisterConfig();
  const configuredJanitorCycles = cloisterConfig.monitoring.stash_janitor_every_cycles;
  if (typeof configuredJanitorCycles === 'number' && configuredJanitorCycles >= 0) {
    config.stashJanitorEveryCycles = configuredJanitorCycles;
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
  const heartbeatFile = join(PANOPTICON_HOME, 'heartbeats', `${tmuxSession}.json`);

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
  const runtimeState = getAgentRuntimeState(tmuxSession);
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
    await killSessionAsync(tmuxSession);

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

/**
 * Status indicators in tmux output that mean the agent is actively working
 * (not idle). These appear in Claude Code's status line.
 */
const ACTIVE_STATUS_PATTERNS = [
  /computing/i,
  /fermenting/i,
  /thinking/i,
  /reading/i,
  /writing/i,
  /editing/i,
  /searching/i,
  /running/i,
  /executing/i,
  /tool use/i,
  /\bBash\b/,
  /\bRead\b/,
  /\bWrite\b/,
  /\bEdit\b/,
  /\bGrep\b/,
  /\bGlob\b/,
  /\bTask\b/,
];

/**
 * Check if agent tmux output indicates active work (not idle)
 * Checks the last 8 non-blank lines of pane output for status indicators.
 * Claude Code's live status bar (◆ Bash, ◆ Thinking, ⏵⏵) appears at the
 * bottom of the pane — only those lines are relevant, not the full visible
 * area which may contain completed tool calls like "● Bash(...)" from prior output.
 */
/**
 * PAN-1249: Effect-typed implementation of `isAgentActiveInTmux`. Never fails
 * — capture errors collapse to `false`. The public Promise function is a
 * thin `Effect.runPromise` wrapper.
 */
const isAgentActiveInTmuxEffect = (sessionName: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: () => capturePaneAsync(sessionName, 5),
    catch: () => 'capture-failed' as const,
  }).pipe(
    Effect.map((stdout) => {
      if (!stdout.trim()) return false;

      // Only scan the bottom of the pane where Claude Code's live status bar lives.
      // Scanning the full visible area causes false positives: completed tool calls
      // like "● Bash(npm run typecheck...)" are visible but the agent may be idle.
      const lines = stdout.split('\n').filter((l: string) => l.trim().length > 0);
      const tail = lines.slice(-8).join('\n');

      for (const pattern of ACTIVE_STATUS_PATTERNS) {
        if (pattern.test(tail)) {
          // Extended computation (Thinking/Fermenting) over threshold = stuck.
          // Don't let stuck agents masquerade as active.
          if (/thinking|fermenting/i.test(tail)) {
            const thinkingMs = parseThinkingDuration(tail);
            if (thinkingMs !== null && thinkingMs >= STUCK_THINKING_THRESHOLD_MS) {
              return false; // Stuck, not active
            }
          }
          return true;
        }
      }

      return false;
    }),
    Effect.catch(() => Effect.succeed(false)),
  );

export async function isAgentActiveInTmux(sessionName: string): Promise<boolean> {
  return Effect.runPromise(isAgentActiveInTmuxEffect(sessionName));
}

/**
 * Determine if an agent is idle based on its runtime.json hook state.
 *
 * The Stop hook (fired by Claude Code's Stop lifecycle event) writes state='idle'
 * to runtime.json whenever Claude finishes a turn and returns to the prompt. This
 * is the authoritative idle signal — no pane parsing needed.
 *
 * Stale-active fallback: if Stop hook never fired (state='active' persists), treat
 * the agent as idle once the heartbeat is older than staleActiveThresholdMs. The
 * heartbeat-hook fires on PostToolUse, so a stale heartbeat means no tool calls
 * and therefore no active computation.
 *
 * Returns false if: no runtime state, suspended, completed, or recently active.
 */
function isAgentIdleForNudge(agentId: string, staleActiveThresholdMs = 5 * 60 * 1000): boolean {
  const runtimeState = getAgentRuntimeState(agentId);
  if (!runtimeState) {
    console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
    return false;
  }
  if (runtimeState.state === 'suspended' || runtimeState.state === 'stopped') return false;
  if (runtimeState.state === 'idle') return true;
  // Stale-active fallback: only fires for 'uninitialized' agents — never for
  // 'active'. An 'active' state means the pre-tool-hook fired and Stop hasn't,
  // which by definition is mid-turn work. Nudging an active agent injects
  // text into the pane mid-Bash and surfaces as `Interrupted · What should
  // Claude do instead?` (PAN-1024 reproduced this with slow gpt-5 runtimes
  // where the heartbeat between tool calls easily exceeds 5min).
  if (runtimeState.state !== 'uninitialized') return false;
  const ageMs = Date.now() - new Date(runtimeState.lastActivity).getTime();
  return ageMs > staleActiveThresholdMs;
}

// ============================================================================
// Stuck Work Agent Detection
// ============================================================================

/**
 * Thinking duration threshold before an agent is considered stuck.
 * Claude Code shows "Thinking... (Xm Ys)" in tmux — if the duration
 * exceeds this threshold with no tool output, the agent is stalled.
 */
const STUCK_THINKING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Cooldown between stuck-recovery attempts for the same agent.
 * Prevents spamming Ctrl+C or respawning in a loop.
 */
const STUCK_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Track recovery attempts per agent: agentId -> { lastAttempt, attempts }
 */
const stuckRecoveryState: Map<string, { lastAttempt: number; attempts: number }> = new Map();

/**
 * Parse thinking duration from tmux output.
 * Claude Code renders: "Thinking… (Xm Ys · ...)" or "· Thinking… (Xm Ys · ...)"
 * Returns duration in milliseconds, or null if not currently thinking.
 */
function parseThinkingDuration(tmuxOutput: string): number | null {
  // Match Claude Code thinking/fermenting status phrases followed by a duration.
  // Handles: "Thinking… (22m 41s", "Fermenting… (5m 10s"
  const match = tmuxOutput.match(/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/);
  if (!match) return null;

  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = parseInt(match[2], 10);
  return (minutes * 60 + seconds) * 1000;
}

/**
 * Check for work agents stuck in extended thinking loops.
 *
 * Detection: tmux shows "Thinking… (Xm Ys)" where duration > threshold.
 * Recovery strategy (escalating):
 *   1. First attempt: Send Escape key to try to cancel thinking
 *   2. Second attempt: Send Ctrl+C to interrupt
 *   3. Third attempt: Kill tmux session and respawn via launcher.sh
 */
export async function checkStuckWorkAgents(): Promise<string[]> {
  const actions: string[] = [];
  const agents = listRunningAgents();
  // Specialist sessions (global or per-project) use the specialist tmux prefix.
  const isSpecialistSession = (id: string) => id.startsWith('specialist-');
  const now = Date.now();

  for (const agent of agents) {
    if (!agent.tmuxActive) continue;

    // Only check work agents, not specialists (specialists have their own health checks)
    const isWorkAgent = agent.id.startsWith('agent-') && !isSpecialistSession(agent.id);
    if (!isWorkAgent) continue;

    // Check cooldown
    const recovery = stuckRecoveryState.get(agent.id);
    if (recovery && (now - recovery.lastAttempt) < STUCK_RECOVERY_COOLDOWN_MS) {
      continue;
    }

    // Capture tmux output to check for stuck thinking
    let tmuxOutput: string;
    try {
      tmuxOutput = await capturePaneAsync(agent.id, 10);
    } catch {
      continue;
    }

    if (!tmuxOutput.trim()) continue;

    // Detect agents stuck on Claude Code's "exclude from context" interactive dialog.
    // This dialog fires when Claude Code wants to add a file to .claudeignore and waits
    // for user input (Esc to cancel, Tab to amend). The notification-hook sets runtime
    // state to 'waiting-on-human', but no automated recovery was wired up for this case.
    const isExcludeDialog = tmuxOutput.includes('Do you want to make this edit to exclude')
      || tmuxOutput.includes('Esc to cancel') && tmuxOutput.includes('Tab to amend');
    if (isExcludeDialog) {
      console.log(`[deacon] Work agent ${agent.id} stuck on exclude-from-context dialog — dismissing with Escape`);
      try {
        await execAsync(`${buildTmuxCommandString(['send-keys', '-t', agent.id, 'Escape'])} 2>/dev/null || true`);
        saveAgentRuntimeState(agent.id, { state: 'active' });
        actions.push(`Stuck recovery: dismissed exclude-from-context dialog for ${agent.id}`);
      } catch (err) {
        console.error(`[deacon] Failed to send Escape to ${agent.id}:`, err);
      }
      continue;
    }

    // Parse thinking duration
    const thinkingMs = parseThinkingDuration(tmuxOutput);
    if (thinkingMs === null || thinkingMs < STUCK_THINKING_THRESHOLD_MS) {
      // Not thinking, or thinking for an acceptable duration — clear recovery state
      if (recovery && recovery.attempts > 0) {
        stuckRecoveryState.delete(agent.id);
      }
      continue;
    }

    const thinkingMinutes = Math.round(thinkingMs / 60000);
    const attempts = recovery?.attempts ?? 0;

    // PAN-653: If the workspace is marked stuck (e.g. main diverged during approve),
    // skip all recovery actions — Deacon must not respawn a stuck workspace.
    const agentIssueId = (agent.issueId || agent.id.replace('agent-', '')).toUpperCase();
    const agentReviewStatus = getReviewStatus(agentIssueId);
    if (agentReviewStatus?.stuck) {
      console.log(`[deacon] Skipping stuck-thinking recovery for ${agent.id} (${agentIssueId}): workspace is stuck`);
      continue;
    }
    if (agentReviewStatus?.deaconIgnored) {
      console.log(`[deacon] Skipping stuck-thinking recovery for ${agent.id} (${agentIssueId}): deacon-ignored by operator`);
      continue;
    }

    console.log(`[deacon] Work agent ${agent.id} stuck thinking for ${thinkingMinutes}m (attempt ${attempts + 1})`);

    try {
      if (attempts === 0) {
        // First attempt: send Escape to cancel thinking
        await execAsync(`${buildTmuxCommandString(['send-keys', '-t', agent.id, 'Escape'])} 2>/dev/null || true`);
        actions.push(`Stuck recovery: sent Escape to ${agent.id} (thinking ${thinkingMinutes}m)`);
      } else if (attempts === 1) {
        // Second attempt: send Ctrl+C to interrupt
        await execAsync(`${buildTmuxCommandString(['send-keys', '-t', agent.id, 'C-c'])} 2>/dev/null || true`);
        actions.push(`Stuck recovery: sent Ctrl+C to ${agent.id} (thinking ${thinkingMinutes}m)`);
      } else {
        // Third+ attempt: kill and respawn
        const launcherPath = join(AGENTS_DIR, agent.id, 'launcher.sh');
        const agentState = getAgentState(agent.id);
        const workspace = agentState?.workspace;

        if (!existsSync(launcherPath) || !workspace) {
          console.error(`[deacon] Cannot respawn ${agent.id}: missing launcher.sh or workspace`);
          actions.push(`Stuck recovery failed for ${agent.id}: missing launcher or workspace`);
          continue;
        }

        // Kill the stuck tmux session
        await killSessionAsync(agent.id).catch(() => { /* no stale session */ });

        // Small delay to let tmux clean up
        await new Promise(r => setTimeout(r, 1000));

        // Respawn in a new tmux session with the same launcher
        // Kill stale session first to prevent "duplicate session" error (PAN-430)
        await killSessionAsync(agent.id).catch(() => { /* no stale session */ });
        await createSessionAsync(agent.id, workspace, `bash ${launcherPath}`, {
          env: BLANKED_PROVIDER_ENV,
        });

        // Reset recovery state since we respawned fresh
        stuckRecoveryState.set(agent.id, { lastAttempt: now, attempts: 0 });

        actions.push(`Stuck recovery: respawned ${agent.id} (was stuck thinking ${thinkingMinutes}m, attempt ${attempts + 1})`);
        console.log(`[deacon] Respawned stuck work agent ${agent.id}`);
        continue;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[deacon] Stuck recovery failed for ${agent.id}:`, msg);
      actions.push(`Stuck recovery error for ${agent.id}: ${msg}`);
    }

    // Track this recovery attempt
    stuckRecoveryState.set(agent.id, {
      lastAttempt: now,
      attempts: attempts + 1,
    });
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
  let sessionNames: string[];
  try {
    sessionNames = await listSessionNamesAsync();
  } catch {
    return actions;
  }

  const agentSessions = sessionNames.filter(
    name => name.startsWith('agent-') || name.startsWith('specialist-') || name.startsWith('planning-'),
  );

  for (const sessionName of agentSessions) {
    const recovery = apiErrorRecoveryState.get(sessionName);
    if (recovery && (now - recovery.lastAttempt) < API_ERROR_RECOVERY_COOLDOWN_MS) {
      continue;
    }

    let tmuxOutput: string;
    try {
      tmuxOutput = await capturePaneAsync(sessionName, 100);
    } catch {
      continue;
    }

    if (!tmuxOutput.trim()) continue;

    const hasPrompt = tmuxOutput.includes('❯');
    if (!hasPrompt) continue;

    const hasApiError = API_ERROR_PATTERNS.some(pattern => tmuxOutput.includes(pattern));
    if (!hasApiError) continue;

    // For work agents, respect stuck/deacon-ignored flags
    if (sessionName.startsWith('agent-')) {
      const agentIssueId = (sessionName.replace('agent-', '')).toUpperCase();
      const agentReviewStatus = getReviewStatus(agentIssueId);
      if (agentReviewStatus?.stuck || agentReviewStatus?.deaconIgnored) {
        continue;
      }
    }

    console.log(`[deacon] Agent ${sessionName} stopped with API error — nudging retry`);

    try {
      const continueMsg = 'You stopped due to a transient API error. This is a temporary server issue, not a problem with your work. Continue from where you left off. Do NOT start over — pick up exactly where you stopped.';
      await sendKeysAsync(sessionName, continueMsg);
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
 * Scans ~/.panopticon/agents/ for directories that:
 * - Have no active tmux session
 * - Are older than the configured retention threshold (default: 30 days)
 * - Don't have a recently processed completion marker
 *
 * Runs at low frequency (~once per day) via random trigger in patrol cycle.
 */
export async function cleanupStaleAgentState(): Promise<string[]> {
  const actions: string[] = [];
  const cloisterConfig = loadCloisterConfig();
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
          const exists = await sessionExistsAsync(dir.name);
          if (exists) {
            continue; // Session exists, skip
          }
        } catch {
          // No session — candidate for cleanup
        }

        // Check directory age via state.json mtime (or dir mtime as fallback)
        const stateFile = join(agentDir, 'state.json');
        let mtime: number;

        if (existsSync(stateFile)) {
          mtime = statSync(stateFile).mtimeMs;
        } else {
          mtime = statSync(agentDir).mtimeMs;
        }

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
  const projects = listProjects();
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

  const { getReviewStatus } = await import('../review-status.js');
  const { clearFeedbackFiles } = await import('./feedback-writer.js');

  for (const { issueId, workspacePath } of listFeatureWorkspaces()) {
    const panFeedbackDir = join(workspacePath, '.pan', 'feedback');
    if (!existsSync(panFeedbackDir)) continue;

    const issueLower = issueId.toLowerCase();

    // Gate 1: work agent tmux session active? If yes, feedback may be current.
    const agentSession = `agent-${issueLower}`;
    try {
      if (await sessionExistsAsync(agentSession)) continue;
    } catch {
      // Treat lookup error as "session might exist" — skip out of caution.
      continue;
    }

    // Gate 2: review in flight? If yes, feedback is about to be consumed.
    try {
      const status = getReviewStatus(issueId);
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
      await clearFeedbackFiles(workspacePath);
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

/**
 * Clean up orphan reviewer and specialist tmux sessions (PAN-846).
 *
 * Sweeps for sessions whose naming pattern indicates they belong to a
 * reviewer or specialist, checks whether the corresponding work agent is
 * still alive or a review is in flight, and kills sessions that have been
 * alive for more than one hour with no owner.
 *
 * Safety net for orphaned convoy reviewer sessions (agent-<id>-review-<subRole>)
 * whose synthesis session already ended but whose sub-role session outlived the
 * stop-hook reaper (e.g. reaper race, tmux busy, dashboard restart).
 */
export async function cleanupOrphanReviewerSessions(): Promise<string[]> {
  const actions: string[] = [];
  const ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  let sessions: string[];
  let creationTimes: Map<string, number>;
  try {
    const { stdout } = await execAsync(
      `tmux -L panopticon -f ${join(PANOPTICON_HOME, 'tmux', 'panopticon.tmux.conf')} list-sessions -F '#{session_name} #{session_created}'`,
      { encoding: 'utf-8' },
    );
    const lines = stdout.split('\n').filter(l => l.trim());
    sessions = [];
    creationTimes = new Map();
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
  } catch {
    // tmux server may not be running — nothing to clean
    return actions;
  }

  const { getReviewStatus } = await import('../review-status.js');
  const { parseReviewerSessionName } = await import('./specialists.js');

  for (const sessionName of sessions) {
    // PAN-1059: convoy sub-role sessions are agent-<id>-review-<subRole>.
    // Legacy specialist sessions matched specialist-*-review-*. Both contain -review-.
    if (!sessionName.includes('-review-')) continue;

    // Check age
    const createdMs = creationTimes.get(sessionName);
    if (!createdMs || now - createdMs < ORPHAN_AGE_MS) continue;

    // Extract issueId from session name
    let issueId: string | null = null;

    // PAN-1059 convoy pattern: agent-<issueId>-review-<subRole>
    const convoyMatch = sessionName.match(/^agent-([a-z0-9]+-\d+)-review-(?:security|correctness|performance|requirements)$/);
    if (convoyMatch) {
      issueId = convoyMatch[1].toUpperCase();
    } else {
      // Legacy specialist pattern: specialist-<project>-<issueId>-review-<role>
      const parsedReviewer = parseReviewerSessionName(sessionName);
      if (parsedReviewer) {
        issueId = parsedReviewer.issueId.toUpperCase();
      } else {
        // Generic fallback
        const match = sessionName.match(/([A-Z0-9]+-\d+)/i);
        if (match) issueId = match[1].toUpperCase();
      }
    }

    if (!issueId) continue;

    // Gate 1: work agent running?
    const agentSession = `agent-${issueId.toLowerCase()}`;
    if (sessions.includes(agentSession)) continue;

    // Gate 2: review in flight for this issue?
    try {
      const status = getReviewStatus(issueId);
      if (status?.reviewStatus === 'reviewing') continue;
    } catch {
      // No status entry → safe to clean
    }

    // Both gates passed — session is an orphan, kill it
    try {
      await killSessionAsync(sessionName);
      const ageMin = Math.round((now - createdMs) / 60000);
      const msg = `Killed orphan reviewer session ${sessionName} (${ageMin}m old)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[deacon] Failed to kill orphan session ${sessionName}: ${msg}`);
    }
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
      emitActivityEntry({
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
    emitActivityEntry({
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

export async function checkOrphanedReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    // loadReviewStatuses() prefers SQLite (DB-first) and falls back to JSON —
    // this is the authoritative source of truth after the PAN-653 DB migration.
    const statuses = loadReviewStatuses();

    // Build a set of all active specialist sessions (global + per-project)
    // so we can check if ANY specialist is working on review/test tasks.
    const activeReviewSessions = new Set<string>(); // issue IDs being reviewed
    const activeTestSessions = new Set<string>(); // issue IDs being tested

    // Check global specialists
    for (const type of ['review-agent', 'test-agent'] as const) {
      const session = getTmuxSessionName(type);
      if (sessionExists(session)) {
        const rState = getAgentRuntimeState(session);
        if (rState?.state === 'active' && rState.currentIssue) {
          (type === 'review-agent' ? activeReviewSessions : activeTestSessions).add(rState.currentIssue.toUpperCase());
        }
      }
    }

    // Check per-project ephemeral specialists
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning) continue;
      const rState = getAgentRuntimeState(projSpec.tmuxSession);
      const isWorking = rState?.state === 'active';
      if (isWorking && rState.currentIssue) {
        if (projSpec.specialistType === 'review-agent') {
          activeReviewSessions.add(rState.currentIssue.toUpperCase());
        } else if (projSpec.specialistType === 'test-agent') {
          activeTestSessions.add(rState.currentIssue.toUpperCase());
        }
      }
    }

    // PAN-1048 R5: detect role-primitive review/test runs (agent-<id>-review,
    // agent-<id>-test) so the deacon doesn't spuriously flag an in-flight role
    // run as an orphan. Replaces the legacy getActiveParallelReviewIssues
    // helper that scanned for review-coordinator-* / review-<id>-<role>
    // sessions spawned by dispatchParallelReview (now retired).
    try {
      const { listRunningAgentsAsync } = await import('../agents.js');
      const agents = await listRunningAgentsAsync();
      for (const agent of agents) {
        if (agent.status === 'stopped' || agent.status === 'error') continue;
        const issueId = (agent.issueId ?? '').trim().toUpperCase();
        if (!issueId) continue;
        const role = agent.role
          ?? (agent.id.endsWith('-review') ? 'review'
            : agent.id.endsWith('-test') ? 'test'
            : null);
        if (role === 'review') activeReviewSessions.add(issueId);
        else if (role === 'test') activeTestSessions.add(issueId);
      }
    } catch {
      // Non-fatal: fall back to specialist-only detection
    }

    let modified = false;

    const latestHistoryEntry = (
      history: Array<{ type: string; status: string; notes?: string }> | undefined,
      type: 'review' | 'test',
      terminalStatuses: readonly string[],
    ): { status: string; notes?: string } | null => {
      if (!history || history.length === 0) return null;
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i];
        if (entry.type === type && terminalStatuses.includes(entry.status)) {
          return { status: entry.status, notes: entry.notes };
        }
      }
      return null;
    };

    for (const [issueId, status] of Object.entries(statuses)) {
      // PAN-794: skip workspaces the breaker already marked stuck. A human unstick
      // or a new commit is required to re-arm review dispatch for this issue.
      if (status.stuck) continue;
      // Operator-set ignore flag: skip all patrol re-dispatch for this issue
      // until the human toggles it back off via the kanban button.
      if (status.deaconIgnored) continue;
      // Skip issues that already completed their pipeline — don't reset
      // statuses that the specialist already reported results for.
      // History contains the ground truth; the top-level status fields
      // are just the latest snapshot.
      // "hasPassedX" means: the LATEST test/review history entry is 'passed',
      // i.e. no newer 'testing'/'reviewing' marker has been recorded since.
      // A stale 'passed' from a previous round must NOT block re-dispatch when
      // new commits have triggered another round (the snapshot is bumped back
      // to 'testing' but the old 'passed' is still in history).
      const latestHistoryByType = (type: 'review' | 'test'): string | undefined => {
        if (!status.history) return undefined;
        for (let i = status.history.length - 1; i >= 0; i--) {
          if (status.history[i].type === type) return status.history[i].status;
        }
        return undefined;
      };
      const hasPassedReview = latestHistoryByType('review') === 'passed';
      const hasPassedTest = latestHistoryByType('test') === 'passed';
      const latestTerminalReview = latestHistoryEntry(status.history, 'review', ['passed', 'failed', 'blocked']);
      const latestTerminalTest = latestHistoryEntry(status.history, 'test', ['passed', 'failed', 'skipped']);

      // Check for orphaned reviewing status — no specialist (global or per-project) is actively reviewing this issue
      const reviewAgentActive = activeReviewSessions.has(issueId.toUpperCase());
      if (status.reviewStatus === 'reviewing' && !reviewAgentActive) {
        // Only restore terminal 'passed' states. Restoring 'failed'/'blocked' would replay
        // stale review notes verbatim (deacon has no way to know whether the agent has
        // pushed new commits that address those notes), creating the cycling-review illusion
        // where every patrol tick appears to be a fresh review failure. For failed/blocked
        // terminal states, fall through to reset=pending so the re-dispatch path below wakes
        // a real review against the current code.
        if (latestTerminalReview && latestTerminalReview.status === 'passed') {
          const reviewUpdate: Record<string, unknown> = {
            reviewStatus: latestTerminalReview.status,
            reviewNotes: latestTerminalReview.notes,
          };
          // Snapshot the workspace HEAD when restoring a passed review from
          // history. Without reviewedAtCommit the canSkipTests fast-path and
          // checkPostReviewCommits both go blind, and the issue can jam at
          // passed-but-no-commit-anchor (PAN-977).
          try {
            const { resolveProjectFromIssue } = await import('../projects.js');
            const project = resolveProjectFromIssue(issueId);
            if (project) {
              const workspacePath = join(
                project.projectPath,
                'workspaces',
                `feature-${issueId.toLowerCase()}`,
              );
              if (existsSync(workspacePath)) {
                const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath });
                reviewUpdate['reviewedAtCommit'] = stdout.trim();
              }
            }
          } catch { /* non-fatal — leave reviewedAtCommit unchanged */ }
          // A restored terminal-passed review resolves any review-infra stuck
          // marker — clear it so the deacon stops skipping the issue.
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
            // Only reset transient failures (e.g. git conflicts, network errors).
            // CI check failures must stay 'failed' until the work agent pushes a fix —
            // resetting to 'pending' would re-queue the merge and cycle indefinitely.
            const isCiFailure = typeof status.mergeNotes === 'string' &&
              status.mergeNotes.includes('failing required checks');
            if (!isCiFailure) {
              reviewUpdate['mergeStatus'] = 'pending';
            }
          }
          setReviewStatus(issueId, reviewUpdate as Parameters<typeof setReviewStatus>[1]);
          status.reviewStatus = latestTerminalReview.status;
          if (latestTerminalTest) {
            status.testStatus = latestTerminalTest.status as typeof status.testStatus;
          }
          actions.push(
            `Restored orphaned review snapshot for ${issueId} to ${latestTerminalReview.status}` +
            (latestTerminalTest ? ` / test ${latestTerminalTest.status}` : ''),
          );
          continue;
        }
        if (!hasPassedReview) {
          console.log(`[deacon] Orphaned review detected: ${issueId} shows 'reviewing' but no review-agent is working on it`);
          // PAN-794: an orphaned 'reviewing' with no active session is the
          // signature of an infrastructure failure (spawn crash, tmux session
          // died, dispatch never wrote a terminal status). Count each reset so
          // the breaker can trip after a bounded number of failed recovery cycles.
          const nextRetry = (status.reviewRetryCount ?? 0) + 1;
          const recoveryStart = status.recoveryStartedAt ?? new Date().toISOString();
          // Use setReviewStatus (not direct JSON write) so SQLite is updated too
          setReviewStatus(issueId, {
            reviewStatus: 'pending',
            reviewRetryCount: nextRetry,
            recoveryStartedAt: recoveryStart,
          });
          status.reviewStatus = 'pending';
          status.reviewRetryCount = nextRetry;
          status.recoveryStartedAt = recoveryStart;
          actions.push(
            `Reset orphaned review for ${issueId} (no review-agent active; retry ${nextRetry}/${REVIEW_INFRA_BREAKER_THRESHOLD})`,
          );
        }
      }

      // Re-dispatch pending reviews that should be in the pipeline.
      // This covers the gap where checkOrphanedReviewStatuses resets reviewing → pending
      // but nothing re-enqueues the issue. Conditions: reviewStatus=pending AND the issue
      // has completed (completed.processed exists) AND has a PR (prUrl exists) AND no
      // review agent is currently working on it.
      const reviewQueuedOrActive = activeReviewSessions.has(issueId.toUpperCase());
      if (
        status.reviewStatus === 'pending' &&
        !reviewQueuedOrActive &&
        !hasPassedReview &&
        status.prUrl
      ) {
        // PAN-794: trip the circuit breaker before another re-dispatch if the
        // current recovery cycle has already consumed its retry budget. The
        // workspace is marked stuck with a specific review-infra reason so the
        // dashboard can render the recovery UI and a human can unstick once the
        // root cause (spawn script, review template, etc.) is addressed.
        if ((status.reviewRetryCount ?? 0) >= REVIEW_INFRA_BREAKER_THRESHOLD) {
          try {
            markWorkspaceStuck(issueId, 'review_infrastructure_failure', {
              reviewRetryCount: status.reviewRetryCount ?? 0,
              recoveryStartedAt: status.recoveryStartedAt,
              lastReviewNotes: status.reviewNotes,
            });
            status.stuck = true;
            status.stuckReason = 'review_infrastructure_failure';
            actions.push(
              `Tripped review-infra breaker for ${issueId} after ${status.reviewRetryCount} retries — marked stuck`,
            );
            console.warn(
              `[deacon] Review-infra breaker tripped for ${issueId} (retries=${status.reviewRetryCount}); marked stuck`,
            );
          } catch (err) {
            console.error(`[deacon] Failed to mark ${issueId} stuck after breaker trip:`, err);
          }
          continue;
        }
        // Check completed.processed marker
        const agentIdForCheck = `agent-${issueId.toLowerCase()}`;
        const completedProcessedFile = join(AGENTS_DIR, agentIdForCheck, 'completed.processed');
        if (existsSync(completedProcessedFile)) {
          const agentState = getAgentState(agentIdForCheck);
          // A completed.processed marker means the work agent intentionally handed off;
          // review recovery does not require that work session to still be running.
          const { resolveProjectFromIssue } = await import('../projects.js');
          const resolved = resolveProjectFromIssue(issueId);
          const issueLower = issueId.toLowerCase();
          const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

          if (workspace && resolved) {
            const branch = `feature/${issueLower}`;
            // PAN-1048 R4: deacon recovery routes through the role primitive.
            const { spawnReviewRoleForIssue } = await import('./review-agent.js');
            try {
              await spawnReviewRoleForIssue({ issueId, workspace, branch });
              // spawnReviewRoleForIssue sets reviewStatus='reviewing' internally;
              // keep local status in sync so this patrol doesn't re-process the issue.
              status.reviewStatus = 'reviewing';
              actions.push(
                `Re-dispatched pending review for ${issueId} (deacon-orphan-recovery)`,
              );
              console.log(
                `[deacon] Re-dispatched review for ${issueId} after orphan/pending detection`,
              );
            } catch (err) {
              actions.push(
                `Failed to re-dispatch pending review for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
              );
              console.error(`[deacon] Failed to re-dispatch review for ${issueId}:`, err);
            }
          } else if (!resolved) {
            actions.push(`Skipped pending review re-dispatch for ${issueId}: no project configured`);
          } else {
            actions.push(`Skipped pending review re-dispatch for ${issueId}: workspace unavailable`);
            console.log(`[deacon] Skipped review re-dispatch for ${issueId} — workspace unavailable`);
          }
        }
      }

      // Check for orphaned testing status (includes dispatch_failed from PAN-369)
      const testAgentActive = activeTestSessions.has(issueId.toUpperCase());
      if (
        (status.testStatus === 'testing' || status.testStatus === 'dispatch_failed') &&
        !testAgentActive &&
        !hasPassedTest &&
        !status.readyForMerge
      ) {
        console.log(
          `[deacon] Orphaned test detected: ${issueId} shows '${status.testStatus}' but test-agent is not active`,
        );

        // Re-dispatch through the unified test role runner (no specialist queue fallback)
        const agentId = `agent-${issueId.toLowerCase()}`;
        const agentState = getAgentState(agentId);
        const { resolveProjectFromIssue } = await import('../projects.js');
        const resolved = resolveProjectFromIssue(issueId);
        const issueLower = issueId.toLowerCase();
        const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

        if (workspace && resolved) {
          const branch = `feature/${issueLower}`;
          const { spawnRun } = await import('../agents.js');
          const { buildTestRolePrompt } = await import('./test-agent-queue.js');

          // PAN-1190: a test role cannot spawn while the workspace docker stack
          // is unhealthy (assertWorkspaceStackHealthyForSpawn throws). Self-heal
          // the stack before re-dispatch so this patrol does not loop
          // `dispatch_failed` forever; defer this cycle while a rebuild is
          // cooling down, and stop entirely once the rebuild cap is exhausted.
          const stackRecovery = await recoverUnhealthyTestStack(issueId, workspace);
          if (stackRecovery === 'cooldown' || stackRecovery === 'exhausted') {
            setReviewStatus(issueId, { testStatus: 'dispatch_failed' });
            status.testStatus = 'dispatch_failed';
            actions.push(
              stackRecovery === 'exhausted'
                ? `Orphaned test for ${issueId}: workspace docker stack unhealthy, rebuild cap reached — escalated to human`
                : `Orphaned test for ${issueId}: workspace docker stack rebuilding — deferring re-dispatch`,
            );
          } else {
            try {
              const run = await spawnRun(issueId, 'test', {
                workspace,
                prompt: buildTestRolePrompt({ issueId, workspace, branch }),
              });
              testStackRebuildState.delete(issueId.toUpperCase());
              setReviewStatus(issueId, { testStatus: 'testing' });
              status.testStatus = 'testing';
              actions.push(
                `Re-dispatched orphaned test for ${issueId} via test role ${run.id} (deacon-orphan-recovery)`,
              );
              console.log(
                `[deacon] Re-dispatched test role for ${issueId} after orphan detection (project: ${resolved.projectKey}, workspace: ${workspace})`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes('already running')) {
                setReviewStatus(issueId, { testStatus: 'testing' });
                status.testStatus = 'testing';
                actions.push(`Orphaned test for ${issueId}: test role already running`);
                console.log(`[deacon] Test role already running for ${issueId}`);
              } else {
                setReviewStatus(issueId, { testStatus: 'dispatch_failed' });
                status.testStatus = 'dispatch_failed';
                actions.push(`Orphaned test role dispatch failed for ${issueId}: ${msg}`);
                console.log(`[deacon] Orphaned test role dispatch failed for ${issueId}: ${msg}`);
              }
            }
          }
        } else {
          // Cannot derive workspace/project — reset to pending so the pipeline can re-trigger cleanly
          setReviewStatus(issueId, { testStatus: 'pending' });
          status.testStatus = 'pending';
          actions.push(
            !resolved
              ? `Reset orphaned test for ${issueId}: no project configured`
              : `Reset orphaned test for ${issueId}: workspace unavailable`,
          );
          console.log(
            !resolved
              ? `[deacon] Reset orphaned test for ${issueId} to pending (no project configured)`
              : `[deacon] Reset orphaned test for ${issueId} to pending (workspace unavailable)`,
          );
        }
      }
    }

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking orphaned review statuses:', msg);
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
    if (!existsSync(AGENTS_DIR)) return actions;

    const { loadReviewStatuses } = await import('../review-status.js');
    const statuses = loadReviewStatuses();

    const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('agent-'));

    for (const dir of agentDirs) {
      const issueId = dir.name.replace('agent-', '').toUpperCase();
      if (statuses[issueId]) continue; // already has a status row

      const completedFile = join(AGENTS_DIR, dir.name, 'completed');
      const processedFile = join(AGENTS_DIR, dir.name, 'completed.processed');
      if (!existsSync(completedFile) && !existsSync(processedFile)) continue;

      // Work is done but no status row — auto-trigger review
      const { resolveProjectFromIssue } = await import('../projects.js');
      const resolved = resolveProjectFromIssue(issueId);
      if (!resolved) {
        actions.push(`Skipped missing-status review for ${issueId}: no project configured`);
        continue;
      }

      const issueLower = issueId.toLowerCase();
      const workspace = findWorkspacePath(resolved.projectPath, issueLower);
      if (!workspace) {
        actions.push(`Skipped missing-status review for ${issueId}: workspace unavailable`);
        continue;
      }

      // PAN-1048 R4: deacon auto-trigger routes through the role primitive.
      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      try {
        await spawnReviewRoleForIssue({
          issueId,
          workspace,
          branch: `feature/${issueLower}`,
        });
        actions.push(`Auto-triggered review for ${issueId} (missing status entry)`);
        console.log(`[deacon] Auto-triggered review for ${issueId} (missing status entry)`);
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
    const { loadReviewStatuses, setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'passed') continue;
      if (status.testStatus !== 'pending' && status.testStatus !== 'dispatch_failed') continue;

      const retryCount = status.testRetryCount ?? 0;
      if (retryCount >= 3) continue;

      // For pending, only retry if it's been >5 minutes since review passed
      if (status.testStatus === 'pending') {
        const reviewPassedAt = status.history
          ?.filter(h => h.type === 'review' && h.status === 'passed')
          .pop()?.timestamp;
        if (reviewPassedAt && now - new Date(reviewPassedAt).getTime() < 5 * 60 * 1000) {
          continue;
        }
      }

      const { resolveProjectFromIssue } = await import('../projects.js');
      const resolved = resolveProjectFromIssue(issueId);
      if (!resolved) continue;

      const issueLower = issueId.toLowerCase();
      const workAgentId = `agent-${issueLower}`;
      const agentState = getAgentState(workAgentId);
      const workspace = agentState?.workspace || findWorkspacePath(resolved.projectPath, issueLower);
      const branch = `feature/${issueLower}`;

      if (!workspace) {
        actions.push(`Skipped test retry for ${issueId}: workspace unavailable`);
        continue;
      }

      const { spawnRun } = await import('../agents.js');
      const { buildTestRolePrompt } = await import('./test-agent-queue.js');
      try {
        const run = await spawnRun(issueId, 'test', {
          workspace,
          prompt: buildTestRolePrompt({ issueId, workspace, branch }),
        });
        setReviewStatus(issueId, { testStatus: 'testing', testRetryCount: retryCount + 1 });
        actions.push(`Dispatched test role ${run.id} for ${issueId} (retry ${retryCount + 1})`);
        console.log(`[deacon] Dispatched test role for ${issueId} (retry ${retryCount + 1})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already running')) {
          setReviewStatus(issueId, { testStatus: 'testing', testRetryCount: retryCount + 1 });
          actions.push(`Test role already running for ${issueId} (retry ${retryCount + 1})`);
        } else {
          setReviewStatus(issueId, {
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
    const { loadReviewStatuses, setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();

    // Build set of issues with active review sessions
    const activeReviewIssues = new Set<string>();
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning) continue;
      const rState = getAgentRuntimeState(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue && projSpec.specialistType === 'review-agent') {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Also check global review-agent
    const globalReviewSession = getTmuxSessionName('review-agent');
    if (sessionExists(globalReviewSession)) {
      const rState = getAgentRuntimeState(globalReviewSession);
      if (rState?.state === 'active' && rState.currentIssue) {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Detect active review runs: agent-<id>-review (synthesis) and
    // agent-<id>-review-<subRole> (PAN-1059 convoy).
    try {
      const { listRunningAgentsAsync } = await import('../agents.js');
      const agents = await listRunningAgentsAsync();
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

      setReviewStatus(issueId, {
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

      const resolved = resolveProjectFromIssue(issueId);
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
      const sessionAlive = sessionExists(reviewSession);
      const paneDead = sessionAlive ? await isPaneDeadAsync(reviewSession).catch(() => true) : true;
      const activeReviewState = sessionAlive && !paneDead ? getAgentState(reviewSession) : null;
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
          setReviewStatus(issueId, {
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
        setReviewStatus(issueId, {
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
// Verification/review contradiction (PAN-796)
// ============================================================================

export async function checkVerificationReviewContradiction(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { loadReviewStatuses, setReviewStatus } = await import('../review-status.js');
    const { resolveProjectFromIssue } = await import('../projects.js');
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
          const project = resolveProjectFromIssue(issueId);
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
        setReviewStatus(issueId, {
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
    const { resolveProjectFromIssue } = await import('../projects.js');

    for (const [issueId, status] of Object.entries(statuses)) {
      // Only check passed reviews not yet merged
      if (status.mergeStatus === 'merged') continue;
      if (!status.reviewedAtCommit) continue;
      if (status.reviewStatus !== 'passed' && !status.readyForMerge) continue;

      // Resolve workspace path
      const project = resolveProjectFromIssue(issueId);
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
          setReviewStatus(issueId, { reviewedAtCommit: currentHead });
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
      setReviewStatus(issueId, {
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
      const freshStatus = getReviewStatus(issueId);
      if (freshStatus?.reviewStatus === 'pending') {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        const branch = `feature/${issueId.toLowerCase()}`;
        const dispatchResult = await spawnReviewRoleForIssue({
          issueId,
          workspace: workspacePath,
          branch,
          force: true,
        });
        if (dispatchResult.success) {
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
let agentStatusChangedNotifier: ((state: AgentState, previousStatus?: AgentState['status']) => void) | null = null;
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
export function setAgentStatusChangedNotifier(fn: (state: AgentState, previousStatus?: AgentState['status']) => void): void {
  agentStatusChangedNotifier = fn;
}

function notifyAgentStatusChanged(state: AgentState, previousStatus?: AgentState['status']): void {
  if (!agentStatusChangedNotifier) return;
  try { agentStatusChangedNotifier(state, previousStatus); } catch { /* non-fatal */ }
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

// ============================================================================
// Undispatched-ship safety-net
// ============================================================================

// Wait this long after the review/test status last changed before the patrol
// steps in — long enough that the reactive scheduler's primary
// onIssueStateChange('shipping') trigger has had every chance to fire first.
const SHIP_DISPATCH_STALENESS_MS = 2 * 60 * 1000; // 2 min
// Per-issue cooldown between successive re-dispatch attempts. onIssueStateChange
// is already idempotent (activeRoleRunExists skips a live, current ship run),
// so this is purely to keep the patrol log quiet while a ship run is in flight.
const SHIP_DISPATCH_COOLDOWN_MS = 5 * 60 * 1000; // 5 min
const shipDispatchCooldowns = new Map<string, number>();

/**
 * Safety-net patrol: re-dispatch the ship role for issues where review and
 * test both passed but the issue never reached readyForMerge.
 *
 * The only thing that normally dispatches ship is the reactive scheduler's
 * onIssueStateChange('shipping') event. If that event is swallowed — e.g. a
 * stale/zombie ship session made activeRoleRunExists() return true — the issue
 * jams forever: review and test are green, but ship never runs, readyForMerge
 * stays false, and the dashboard Merge button never lights up. This patrol is
 * the backstop so a single missed event can't strand an issue.
 *
 * onIssueStateChange() owns the actual safety: it resolves the workspace,
 * detects a stale ship session via roleRunHead vs current HEAD, kills the
 * zombie, and only then spawns a fresh ship run. A genuinely in-flight ship
 * run is left alone (activeRoleRunExists returns true), so this patrol is
 * idempotent.
 *
 * Guards:
 *   - review + test both 'passed', not yet readyForMerge
 *   - skip merging/merged/failed (checkFailedMergeRetry owns the failed path)
 *   - staleness: status at least 2 min old (don't race the primary trigger)
 *   - per-issue cooldown: 5 min between re-dispatch attempts
 */
export async function checkUndispatchedShip(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'passed') continue;
      if (status.testStatus !== 'passed') continue;
      if (status.readyForMerge) continue;
      if (status.mergeStatus === 'merging' || status.mergeStatus === 'merged' || status.mergeStatus === 'failed') continue;

      // Give the reactive scheduler's primary trigger time to land first.
      if (!status.updatedAt) continue;
      if (now - new Date(status.updatedAt).getTime() < SHIP_DISPATCH_STALENESS_MS) continue;

      // Per-issue cooldown — keeps the log quiet while a ship run is in flight.
      const lastAttempt = shipDispatchCooldowns.get(key);
      if (lastAttempt && (now - lastAttempt) < SHIP_DISPATCH_COOLDOWN_MS) continue;

      const issueId = status.issueId ?? key;
      console.log(
        `[deacon] Ship never dispatched for ${issueId} (review+test passed, `
        + `readyForMerge=false) — re-triggering shipping lifecycle`,
      );
      shipDispatchCooldowns.set(key, now);

      try {
        const { onIssueStateChange } = await import('./service.js');
        await onIssueStateChange(issueId, 'shipping');
        actions.push(`Re-dispatched ship for ${issueId} (review+test passed but never reached readyForMerge)`);
      } catch (err) {
        console.error(
          `[deacon] failed to re-dispatch ship for ${issueId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkUndispatchedShip:', msg);
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

      const project = resolveProjectFromIssue(issueId);
      if (!project) continue;

      const branch = `feature/${issueId.toLowerCase()}`;
      let isMerged = false;

      // Check 1: regular merge — branch tip is an ancestor of main
      try {
        await execFileAsync('git', ['merge-base', '--is-ancestor', branch, 'main'], {
          cwd: project.projectPath,
        });
        isMerged = true;
      } catch {
        // Not a regular merge ancestor — try squash-merge detection
      }

      // Check 2: squash merge — query GitHub for PR mergedAt/mergeCommit. The
      // old regex-based detection (`\(PAN-XXXX[ )]` against `git log --pretty=%s`)
      // matched ANY commit that mentioned the issue in a trailer, not just
      // genuine squash merges. That's how PAN-977/945/913/544/457 got
      // mergeStatus=merged and rolled into close-out without an actual merge:
      // unrelated commits landed on main with `(PAN-977)` references and the
      // deacon trusted them. GitHub's API is the only authoritative source.
      if (!isMerged) {
        const { resolveGitHubIssue: _resolveGitHubIssue } = await import('../tracker-utils.js');
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
        setReviewStatus(issueId, { mergeStatus: 'merged', readyForMerge: false });
        staleMergeReconciled.add(issueId);
        const msg = `Reconciled stale mergeStatus for ${issueId} — branch ${branch} is merged to main`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);
        // PAN-1027: also run the post-merge handoff so labels get cleaned, work agent
        // tmux session is killed, beads compacted, etc. Without this the dashboard knows
        // the issue is merged but the GitHub labels stay stale ("in-progress"/"in-review")
        // and orphaned tmux sessions leak memory. skipDeploy avoids respawning the server
        // — it's a best-effort reconciliation, not a fresh merge.
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
 * PAN-1178: detect swarm slot PRs that merged into their parent feature branch
 * but whose `/api/swarm/slot-merged` callback never fired.
 *
 * Slot branches merge into `feature/<parent>`, NOT into main. Neither
 * `reconcileStaleMergeStatus` (which scans for branches merged to main) nor the
 * GitHub-app `reviewStatus.prUrl` patrol (which tracks the issue's single main
 * PR) ever sees them. With no detector, `postMergeLifecycle` is never called
 * for the slot branch, `onSlotMergeComplete` never runs, and the swarm's
 * auto-advance stalls — every wave then needs a manual `pan swarm <id>` plus a
 * hand-rolled `/api/swarm/slot-merged` POST.
 *
 * This patrol closes that gap. For every active swarm (a feature workspace
 * whose continue vBRIEF carries a `swarmRuntime` with at least one `running`
 * slot) it asks GitHub which PRs merged into the parent feature branch, then
 * fires `postMergeLifecycle(issueId, projectPath, slotBranch, { skipDeploy })`
 * for each running slot whose slot branch is among them — exactly the loopback
 * the merge-agent drives on the happy path.
 *
 * Re-firing is guarded two ways: the durable gate is the runtime slot status
 * itself (once `onSlotMergeComplete` flips the slot to `merged` it is no longer
 * `running`, so the patrol skips it), and a short per-branch cooldown bridges
 * the window while the async loopback POST is still in flight.
 */
const recentSlotMergeFires = new Map<string, number>();
const SLOT_MERGE_REFIRE_COOLDOWN_MS = 5 * 60 * 1000;

interface MergedSlotPr {
  number: number;
  headRefName: string;
  mergedAt: string | null;
  url: string;
}

export async function detectMergedSwarmSlots(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { parseSlotBranch, postMergeLifecycle } = await import('./merge-agent.js');
    const { resolveGitHubIssue } = await import('../tracker-utils.js');
    const { readContinueStateAsync } = await import('../vbrief/continue-state.js');

    const now = Date.now();
    // Drop cooldown entries that can no longer suppress anything, so the map
    // stays bounded to slot branches fired within the last cooldown window.
    for (const [branch, firedAt] of recentSlotMergeFires) {
      if (now - firedAt >= SLOT_MERGE_REFIRE_COOLDOWN_MS) recentSlotMergeFires.delete(branch);
    }

    for (const { issueId, workspacePath } of listFeatureWorkspaces()) {
      // Slot sub-workspaces (`feature-<parent>-slot-N`) are not swarm parents.
      if (/-slot-\d+$/i.test(issueId)) continue;

      let runtime;
      try {
        const cont = await readContinueStateAsync(workspacePath, issueId);
        runtime = cont?.swarmRuntime;
      } catch {
        continue; // unreadable / malformed continue file — skip this workspace
      }
      if (!runtime) continue;

      // Only `running` slots can have a lost slot-merged callback: a `pending`
      // slot has no branch yet, and `merged`/`failed`/`failed-merge` slots are
      // already terminal.
      const runningSlots = runtime.slots.filter(slot => slot.status === 'running');
      if (runningSlots.length === 0) continue;

      const gh = resolveGitHubIssue(issueId);
      if (!gh.isGitHub) continue;
      const project = resolveProjectFromIssue(issueId);
      if (!project) continue;

      const issueLower = issueId.toLowerCase();
      const featureBranch = `feature/${issueLower}`;

      let mergedPrs: MergedSlotPr[];
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'list', '--repo', `${gh.owner}/${gh.repo}`, '--base', featureBranch,
            '--state', 'merged', '--json', 'number,headRefName,mergedAt,url', '--limit', '50'],
          { cwd: project.projectPath },
        );
        mergedPrs = JSON.parse(stdout || '[]') as MergedSlotPr[];
      } catch {
        continue; // gh query failed — leave it for the next patrol cycle
      }

      // Index merged slot PRs by head branch for an O(1) per-slot lookup.
      const mergedSlotPrs = new Map<string, MergedSlotPr>();
      for (const pr of mergedPrs) {
        if (!pr.mergedAt) continue;
        const slotInfo = parseSlotBranch(pr.headRefName);
        if (!slotInfo) continue;
        // Defensive: the base branch matched but the head encodes a different
        // parent (should not happen, but never fire across issues).
        if (slotInfo.issueLower !== issueLower) continue;
        mergedSlotPrs.set(pr.headRefName, pr);
      }
      if (mergedSlotPrs.size === 0) continue;

      for (const slot of runningSlots) {
        const slotBranch = `feature/${issueLower}-slot-${slot.slotId}`;
        const pr = mergedSlotPrs.get(slotBranch);
        if (!pr) continue; // this slot's PR has not merged — nothing to do

        const lastFired = recentSlotMergeFires.get(slotBranch);
        if (lastFired !== undefined && now - lastFired < SLOT_MERGE_REFIRE_COOLDOWN_MS) continue;
        recentSlotMergeFires.set(slotBranch, now);

        const msg = `Detected merged swarm slot PR #${pr.number} (${slotBranch}) — firing postMergeLifecycle for ${issueId} slot ${slot.slotId}`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);
        // postMergeLifecycle routes slot branches straight to the loopback
        // `/api/swarm/slot-merged` POST and returns; projectPath is unused on
        // that path but kept for signature parity with the main-branch case.
        postMergeLifecycle(issueId, project.projectPath, slotBranch, { skipDeploy: true }).catch(err =>
          console.warn(`[deacon] postMergeLifecycle (swarm slot) failed for ${issueId} slot ${slot.slotId}: ${err}`),
        );
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Error in detectMergedSwarmSlots: ${err.message}`);
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
        const prState = await getPullRequestState(prRef[1], prRef[2], Number.parseInt(prRef[3], 10));
        if (!prState.merged) {
          // GitHub says not merged but our DB says merged — reset internal state.
          // Leave reviewStatus alone (it may legitimately be passed/failed/blocked from
          // the prior cycle); the issue can proceed through the pipeline once mergeStatus
          // is no longer blocking.
          setReviewStatus(issueId, { mergeStatus: 'pending' });
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
        const prState = await getPullRequestState(owner, repo, prNumber);
        if (prState.state === 'OPEN' && !prState.merged) continue;

        if (prState.merged) {
          setReviewStatus(issueId, {
            readyForMerge: false,
            mergeStatus: 'merged',
            mergeNotes: undefined,
          });
          const msg = `Reset readyForMerge for ${issueId} — PR #${prNumber} is already merged`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        } else {
          setReviewStatus(issueId, {
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
      setReviewStatus(issueId, {
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
            const ciFileResult = await writeFeedbackFile({
              issueId,
              specialist: 'merge-agent',
              outcome: 'ci-failure',
              summary: 'CI checks still failing after 5 transient retries — merge blocked',
              markdownBody: `## CI Check Failure — Merge Blocked\n\n${ciNotes}\n\n### Action Required\n\nFix the failing CI checks, commit, and push. Panopticon will detect the new commits and re-run the review pipeline automatically.\n\nAlternatively:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
            }).catch((err: Error) => {
              console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message);
              return { success: false, error: err.message };
            });
            const agentSession = `agent-${issueId.toLowerCase()}`;
            if (sessionExists(agentSession)) {
              const ciPath = (ciFileResult as any)?.filePath;
              const ciMsg = ciPath
                ? `CI checks are failing on the PR after 5 retries.\n\nMUST READ: ${ciPath}\n\nFix the failures, commit, then run: pan done ${issueId}`
                : `CI checks are failing on the PR after 5 retries. Fix the failures, commit, then run: pan done ${issueId}`;
              await sendKeysAsync(agentSession, ciMsg);
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
        const ciFileResult2 = await writeFeedbackFile({
          issueId,
          specialist: 'merge-agent',
          outcome: 'ci-failure',
          summary: 'CI checks failed at merge — re-submit to re-enter merge queue',
          markdownBody: `## CI Check Failure\n\n${ciNotes}\n\nCI checks failed at merge time. This may be transient (pending checks, GitHub status lag). Re-submit to re-enter the merge queue:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
        }).catch((err: Error) => {
          console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message);
          return { success: false, error: err.message };
        });
        const agentSessionCi = `agent-${issueId.toLowerCase()}`;
        if (sessionExists(agentSessionCi)) {
          const ciPath2 = (ciFileResult2 as any)?.filePath;
          const ciMsg2 = ciPath2
            ? `CI checks failed on the PR for ${issueId}. This may be transient.\n\nMUST READ: ${ciPath2}\n\nFix any failures, commit, then run: pan done ${issueId}`
            : `CI checks failed on the PR for ${issueId}. This may be transient. Fix any failures, commit, then run: pan done ${issueId}`;
          await sendKeysAsync(agentSessionCi, ciMsg2);
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
          await writeFeedbackFile({
            issueId: issueIdForFb,
            specialist: 'merge-agent',
            outcome: 'timeout',
            summary: 'Merge timed out waiting for rebase — please rebase and push',
            markdownBody: `## Merge Timed Out — Rebase Required\n\n${timeoutNotes}\n\n### Action Required\n\nThe merge was requested but the rebased branch was not pushed in time. Please:\n\n1. Run \`git fetch origin\` and \`git rebase origin/main\` (or the target branch)\n2. Resolve any conflicts\n3. Run \`git push --force-with-lease\`\n4. Run \`pan done ${issueIdForFb}\`\n\nAfter pushing, the merge will be retried automatically.`,
          }).catch((err: Error) => console.error(`[deacon] Failed to write timeout feedback for ${issueIdForFb}:`, err.message));
          const agentSession = `agent-${issueIdForFb.toLowerCase()}`;
          if (sessionExists(agentSession)) {
            await sendKeysAsync(agentSession,
              `Merge timed out — the rebased branch was not pushed in time. Please rebase onto the target branch, resolve any conflicts, push with --force-with-lease, then run "pan done ${issueIdForFb}". After pushing, the merge will proceed automatically.`
            );
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

      setReviewStatus(issueId, {
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
  const { resolveProjectFromIssue } = await import('../projects.js');
  const projectConfig = resolveProjectFromIssue(issueId);
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

      if (!sessionExists(agentSessionName)) {
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
        setReviewStatus(issueId, {
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
        const resolved = resolveProjectFromIssue(issueId);
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

        await sendKeysAsync(agentSessionName, nudgeMessage);
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

export async function logNonCanonicalStashesOnStartup(): Promise<string[]> {
  const actions: string[] = [];

  for (const { issueId, workspacePath } of listFeatureWorkspaces()) {
    if (!existsSync(workspacePath)) continue;

    try {
      const stashes = await listStashes(workspacePath);
      for (const stash of stashes) {
        if (stash.kind !== 'unknown') continue;
        const message = `Non-canonical stash in ${issueId} (${workspacePath}): ${stash.ref} ${stash.message} — audit recommended`;
        console.warn(`[deacon] ${message}`);
        emitActivityEntry({ source: 'dashboard', level: 'warn', message });
        actions.push(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[deacon] Failed non-canonical stash scan for ${issueId}: ${message}`);
    }
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

  const reviewStatus = getReviewStatus(issueId);
  if (reviewStatus?.mergeStatus === 'merged') {
    return remember(true);
  }

  if (reviewStatus?.prUrl) {
    const prRef = reviewStatus.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (prRef) {
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
        if (isGitHubAppConfigured()) {
          const prState = await getPullRequestState(prRef[1], prRef[2], Number.parseInt(prRef[3], 10));
          if (prState.merged) {
            setReviewStatus(issueId, { mergeStatus: 'merged', readyForMerge: false, mergeNotes: undefined });
            // PAN-1027: also run the post-merge handoff so labels get cleaned and the
            // work-agent tmux session is killed. Without this, GitHub-detected merges
            // leave stale "in-progress" / "in-review" labels and leaked tmux sessions.
            try {
              const resolved = resolveProjectFromIssue(issueId);
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

  const resolved = resolveProjectFromIssue(issueId);
  if (!resolved) {
    return remember(false);
  }

  const project = getProject(resolved.projectKey);
  if (!project?.tracker) {
    return remember(false);
  }

  try {
    const { createTracker } = await import('../tracker/factory.js');
    const panopticonConfig = await import('../config.js');
    const globalTrackerConfig = panopticonConfig.loadConfig().trackers;

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

export async function cleanupSpawnAndOrphanedStashes(now = new Date()): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgents();
    for (const agent of agents) {
      if (!agent.id.startsWith('agent-')) continue;
      const agentState = getAgentState(agent.id);
      if (!agentState?.workspace || !agentState.preSpawnStashRef) continue;
      if (!existsSync(agentState.workspace)) continue;
      if (!agentState.preSpawnBaselineHead) {
        console.warn(`[deacon] Missing pre-spawn baseline head for ${agentState.issueId}; preserving stash`);
        continue;
      }

      let hasCommitsAhead = false;
      try {
        const { stdout } = await execAsync(`git rev-list ${agentState.preSpawnBaselineHead}..HEAD --count`, {
          cwd: agentState.workspace,
          encoding: 'utf-8',
        });
        hasCommitsAhead = (parseInt(stdout.trim(), 10) || 0) > 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const baselineMissing = STASH_JANITOR_BASELINE_MISSING_PATTERNS.some((pattern) => message.includes(pattern));
        if (!baselineMissing) {
          console.warn(`[deacon] Failed checking post-spawn commits for ${agentState.issueId}: ${message}`);
          continue;
        }
        console.warn(`[deacon] Missing baseline ref for ${agentState.issueId}; dropping pre-spawn stash because the running agent has moved past spawn`);
        hasCommitsAhead = true;
      }

      if (!hasCommitsAhead) continue;

      try {
        await dropStash(agentState.workspace, agentState.preSpawnStashRef);
        agentState.preSpawnStashRef = undefined;
        agentState.preSpawnStashMessage = undefined;
        agentState.preSpawnBaselineHead = undefined;
        saveAgentState(agentState);
        actions.push(`Dropped pre-spawn stash for ${agentState.issueId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not found|does not exist/i.test(message)) {
          console.warn(`[deacon] Failed dropping pre-spawn stash for ${agentState.issueId}: ${message}`);
          continue;
        }
        agentState.preSpawnStashRef = undefined;
        agentState.preSpawnStashMessage = undefined;
        agentState.preSpawnBaselineHead = undefined;
        saveAgentState(agentState);
      }
    }

    const mergeReconciliationCache = new Map<string, boolean>();

    for (const { issueId, workspacePath } of listFeatureWorkspaces()) {
      if (!existsSync(workspacePath)) continue;

      try {
        const stashes = await listStashes(workspacePath);
        const matchingPreMergeStashes = stashes.filter(
          (stash) => stash.kind === 'pre-merge' && stash.issueId === issueId.toUpperCase(),
        );
        const issueAlreadyMerged = matchingPreMergeStashes.length > 0
          ? await reconcileAndCheckIfMerged(issueId, mergeReconciliationCache)
          : false;
        const mergedPreMergeStashes = issueAlreadyMerged ? matchingPreMergeStashes : [];

        const staleStashes = stashes
          .filter((stash) => stash.kind !== 'salvageable' && isOlderThanDays(stash, DEFAULT_STASH_JANITOR_AGE_DAYS, now));
        // Preserve the first occurrence so a stash that is both "merged" and "stale" keeps the
        // merged label in logs. Drop known stack slots in descending order so earlier slots stay
        // stable, then fall back to SHA-based resolution for entries without stackRef.
        const dedupedStashesToDrop = [...mergedPreMergeStashes, ...staleStashes]
          .filter((stash, index, entries) => entries.findIndex((entry) => entry.ref === stash.ref) === index);
        const stashesWithStackRef = dedupedStashesToDrop
          .map((stash) => {
            const indexMatch = stash.stackRef?.match(/stash@\{(\d+)\}/);
            const stashIndex = indexMatch ? parseInt(indexMatch[1], 10) : Number.NaN;
            return { stash, stashIndex };
          })
          .filter((entry) => Number.isFinite(entry.stashIndex))
          .sort((a, b) => b.stashIndex - a.stashIndex)
          .map((entry) => entry.stash);
        const stashesWithoutStackRef = dedupedStashesToDrop.filter((stash) => !stash.stackRef);
        const stashesToDrop = [...stashesWithStackRef, ...stashesWithoutStackRef];
        for (const stash of stashesToDrop) {
          await dropStash(workspacePath, stash.ref, stash.stackRef);
          const reason = mergedPreMergeStashes.some((entry) => entry.ref === stash.ref)
            ? 'merged issue'
            : 'stale';
          actions.push(`Dropped ${reason} ${stash.kind} stash for ${issueId}: ${stash.ref}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[deacon] Failed stash janitor sweep for ${issueId}: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[deacon] Error in stash janitor: ${message}`);
  }

  return actions;
}

// Track per-agent cooldowns for first-completion nudges
const firstCompletionCooldowns = new Map<string, number>();
const FIRST_COMPLETION_IDLE_MS = 10 * 60 * 1000; // 10 minutes idle before nudging
const FIRST_COMPLETION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between nudges

function isVerifyPausedAgentState(state: Pick<AgentState, 'issueId' | 'paused'>): boolean {
  if (state.paused !== true || !state.issueId) return false;
  return getReviewStatus(state.issueId)?.mergeStatus === 'merged';
}

// Cache for auto-close-out canonical state queries to avoid N+1 shell execs on patrol
const autoCloseOutCache = new Map<string, { state: string | null; timestamp: number }>();
const AUTO_CLOSE_OUT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getAutoCloseOutCanonicalState(issueId: string): Promise<string | null> {
  const cached = autoCloseOutCache.get(issueId);
  if (cached && Date.now() - cached.timestamp < AUTO_CLOSE_OUT_CACHE_TTL_MS) {
    return cached.state;
  }

  const ghResolved = resolveGitHubIssue(issueId);
  if (!ghResolved.isGitHub) return null;

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
}

function recordAutoCloseOutFailure(issueId: string, message: string): void {
  console.warn(`[deacon] Auto close-out failed for ${issueId}: ${message}`);
  setReviewStatus(issueId, { mergeNotes: `Auto close-out failed: ${message}` });
  emitActivityEntry({
    source: 'cloister',
    level: 'warn',
    issueId,
    message: `Auto close-out failed for ${issueId}: ${message}`,
  });
}

export async function autoCloseOut(now = new Date()): Promise<string[]> {
  const closeOutConfig = (await loadCloisterConfigAsync()).close_out;
  if (closeOutConfig?.auto !== true) return [];

  const delayMinutes = Math.max(0, closeOutConfig.auto_delay_minutes ?? 60);
  const cutoff = now.getTime() - delayMinutes * 60 * 1000;
  const actions: string[] = [];
  const statuses = loadReviewStatuses();

  for (const [key, status] of Object.entries(statuses)) {
    const issueId = (status.issueId || key).toUpperCase();
    if (status.mergeStatus !== 'merged') continue;
    if (status.stuck || status.deaconIgnored) continue;

    const updatedAt = Date.parse(status.updatedAt || '');
    if (!Number.isFinite(updatedAt) || updatedAt > cutoff) continue;

    let canonicalState: string | null;
    try {
      canonicalState = await getAutoCloseOutCanonicalState(issueId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      actions.push(`Auto close-out failed for ${issueId}: ${message}`);
      continue;
    }
    if (canonicalState !== 'verifying_on_main') continue;

    const resolvedProject = resolveProjectFromIssue(issueId);
    if (!resolvedProject) {
      const message = 'no project configured';
      recordAutoCloseOutFailure(issueId, message);
      actions.push(`Auto close-out failed for ${issueId}: ${message}`);
      continue;
    }

    const ghResolved = resolveGitHubIssue(issueId);
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
      const result = await closeOut(ctx);
      if (!result.success) {
        const failed = result.steps.find(step => !step.success && !step.skipped);
        throw new Error(failed?.error ?? 'closeOut workflow failed');
      }
      const message = `Auto close-out completed for ${issueId}`;
      console.log(`[deacon] ${message}`);
      emitActivityEntry({ source: 'cloister', level: 'info', issueId, message });
      actions.push(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      actions.push(`Auto close-out failed for ${issueId}: ${message}`);
    }
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
    const agents = listRunningAgents();
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

      const runtimeState = getAgentRuntimeState(agent.id)!;
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
      const agentStateForGate = getAgentState(agent.id);
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
      const agentState = getAgentState(agent.id);
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
        await sendKeysAsync(agent.id, nudgeMessage);
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
    const agents = listRunningAgents();
    // Specialist sessions (global or per-project) use the specialist tmux prefix.
    const isSpecialistSession = (id: string) => id.startsWith('specialist-');

    for (const agent of agents) {
      if (!agent.id.startsWith('agent-') || isSpecialistSession(agent.id)) continue;

      const runtimeState = getAgentRuntimeState(agent.id);
      if (!runtimeState?.resolution || runtimeState.resolution === 'working' || runtimeState.resolution === 'completed' || runtimeState.resolution === 'abandoned') continue;

      const resolution = runtimeState.resolution;
      const count = runtimeState.resolutionCount || 0;
      const issueId = (agent.issueId || agent.id.replace('agent-', '')).toUpperCase();

      // PAN-653: Skip workspaces marked stuck — Deacon must not poke/respawn them.
      // Keyed by issueId (not agentId) so respawned agents with new IDs still match.
      const resolutionReviewStatus = getReviewStatus(issueId);
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
          const panBin = join(PANOPTICON_HOME, 'bin', 'pan');
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
          await sendKeysAsync(agent.id, pokeMsg);
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
      const sessions = await listSessionNamesAsync();
      const agentSessions = sessions.filter(s => s.startsWith('agent-') || s.startsWith('planning-'));
      for (const session of agentSessions) {
        try {
          const pid = (await listPaneValuesAsync(session, '#{pane_pid}'))[0]?.trim();
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
      'docker ps -a --filter "status=exited" --filter "name=panopticon-feature-" --format "{{.Names}}|{{.Status}}" 2>/dev/null || true',
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
      const match = name.match(/panopticon-feature-([\w-]+?)-(frontend|server)-/);
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
      const agentRunning = await sessionExistsAsync(agentId);
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
              await sendKeysAsync(
                agentId,
                `⚠️  Deacon alert: container "${name}" has crashed ${CONTAINER_RESTART_MAX_COUNT} times and auto-restart gave up. The UAT environment at feature-${issueLower}.pan.localhost may be broken. Manual intervention required — check docker logs or re-containerize.`,
                'deacon:container-gave-up',
              );
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
        const { resolveProjectFromIssue } = await import('../projects.js');
        const issueUpper = issueLower.toUpperCase();
        const resolved = resolveProjectFromIssue(issueUpper);
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
          await sendKeysAsync(
            agentId,
            `ℹ️  Deacon: container "${name}" crashed and was auto-restarted (attempt ${count}/${CONTAINER_RESTART_MAX_COUNT}). The UAT environment should recover in ~30s. No action needed unless this keeps happening.`,
            'deacon:container-restarted',
          );
        } catch {
          // Agent may not be interactive — non-fatal
        }
      } catch (restartErr: any) {
        console.warn(`[deacon] Failed to restart ${name}: ${restartErr.message}`);
        // PAN-464: Alert agent that restart failed
        try {
          await sendKeysAsync(
            agentId,
            `⚠️  Deacon alert: container "${name}" crashed and restart failed (${(restartErr as Error).message}). The UAT environment at feature-${issueLower}.pan.localhost is likely broken.`,
            'deacon:container-restart-failed',
          );
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

  hasLoggedGlobalPauseSkip = false;
  addLog('info', `Patrol cycle ${state.patrolCycle} — checking per-project specialists`, state.patrolCycle);
  console.log(`[deacon] Patrol cycle ${state.patrolCycle} - checking per-project specialists`);

  // Process any pending post-merge lifecycle that wasn't consumed on startup (PAN-626).
  // In dev mode, the deploy script may fail to restart cleanly, leaving the pending file.
  try {
    const pendingFile = join(PANOPTICON_HOME, 'pending-post-merge.json');
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

  // Recover orphaned agents: status=running but tmux session gone (failed resume, crash, etc.)
  const orphanedAgentActions = await recoverOrphanedAgents();
  actions.push(...orphanedAgentActions);
  for (const a of orphanedAgentActions) addLog('action', a, state.patrolCycle);

  // Auto-resume stopped work agents that have pending review feedback or were
  // orphaned by a crash. Runs on every patrol so agents don't stay stuck if
  // they stop between patrol cycles. (PAN-805)
  const resumeActions = await autoResumeStoppedWorkAgents();
  actions.push(...resumeActions);
  for (const a of resumeActions) addLog('action', a, state.patrolCycle);

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
    const { resolveProjectFromIssue } = await import('../projects.js');
    const allStatuses = loadReviewStatuses();
    for (const [issueId, status] of Object.entries(allStatuses)) {
      if (!status.readyForMerge || status.mergeStatus === 'merged') continue;
      const project = resolveProjectFromIssue(issueId);
      if (!project) continue;
      const wsPath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      if (!existsSync(wsPath)) {
        setReviewStatus(issueId, { readyForMerge: false, mergeStatus: 'failed', mergeNotes: 'Workspace does not exist' });
        const msg = `Cleared readyForMerge for ${issueId} (workspace deleted)`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);
      }
    }
  } catch (err: any) {
    console.warn(`[deacon] Failed to check workspace existence: ${err.message}`);
  }

  // Check for orphaned review/test statuses (PAN-88)
  const orphanActions = await checkOrphanedReviewStatuses();
  actions.push(...orphanActions);
  for (const a of orphanActions) addLog('action', a, state.patrolCycle);

  // Check for completed work with no review status entry at all (PAN-699)
  const missingStatusActions = await checkMissingReviewStatuses();
  actions.push(...missingStatusActions);
  for (const a of missingStatusActions) addLog('action', a, state.patrolCycle);

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

  // Detect new commits pushed after review passed — invalidate stale reviews
  const postReviewActions = await checkPostReviewCommits();
  actions.push(...postReviewActions);
  for (const a of postReviewActions) addLog('action', a, state.patrolCycle);

  // PAN-464: Check workspace Docker container health and auto-restart crashed containers
  const containerActions = await checkWorkspaceContainerHealth(state);
  actions.push(...containerActions);
  for (const a of containerActions) addLog('action', a, state.patrolCycle);

  // Dead-end and first-completion nudges DISABLED — too flaky, risk of
  // draining AI token credits by sending unnecessary prompts to agents.
  // If an agent is stuck, the human operator can nudge it manually via the
  // dashboard's Tell action.

  // Safety-net: re-dispatch ship for issues where review+test passed but the
  // reactive shipping trigger was swallowed (e.g. by a stale ship session).
  const undispatchedShipActions = await checkUndispatchedShip();
  actions.push(...undispatchedShipActions);
  for (const a of undispatchedShipActions) addLog('action', a, state.patrolCycle);

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

  // PAN-1178: detect swarm slot PRs merged into a feature branch (not main) so
  // the slot-merged loopback fires and the swarm's auto-advance is not stranded.
  const swarmSlotActions = await detectMergedSwarmSlots();
  actions.push(...swarmSlotActions);
  for (const a of swarmSlotActions) addLog('action', a, state.patrolCycle);

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

  const configuredStashJanitorEveryCycles = config.stashJanitorEveryCycles
    ?? Math.round((60 * 60 * 1000) / config.patrolIntervalMs);
  const stashJanitorEveryCycles = configuredStashJanitorEveryCycles > 0
    ? Math.max(1, configuredStashJanitorEveryCycles)
    : Number.POSITIVE_INFINITY;
  if (Number.isFinite(stashJanitorEveryCycles) && state.patrolCycle % stashJanitorEveryCycles === 0) {
    const stashJanitorActions = await cleanupSpawnAndOrphanedStashes();
    actions.push(...stashJanitorActions);
    for (const a of stashJanitorActions) addLog('action', a, state.patrolCycle);
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

  // Periodic orphan reviewer/specialist session sweep (PAN-846).
  // Safety net for convoy sessions the stop-hook reaper missed.
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
        const runtimeState = getAgentRuntimeState(projSpec.tmuxSession);
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
              const currentStatus = getReviewStatus(issueId);
              if (currentStatus?.mergeStatus === 'merging') {
                const { resolveProjectFromIssue } = await import('../projects.js');
                const resolved = resolveProjectFromIssue(issueId);
                if (resolved) {
                  const branch = `feature/${issueId.toLowerCase()}`;
                  const { stdout } = await execAsync(
                    `git -C "${resolved.projectPath}" log --oneline origin/main --grep="Merge branch '${branch}'" 2>/dev/null | head -1`,
                    { encoding: 'utf-8' }
                  );
                  if (stdout.trim()) {
                    console.log(`[deacon] PAN-375: merge specialist died but ${issueId} IS merged (${stdout.trim()}). Auto-completing.`);
                    setReviewStatus(issueId, { mergeStatus: 'merged', readyForMerge: false });
                    const { postMergeLifecycle } = await import('./merge-agent.js');
                    postMergeLifecycle(issueId, resolved.projectPath).catch(err =>
                      console.warn(`[deacon] postMergeLifecycle failed for ${issueId}: ${err}`)
                    );
                    actions.push(`Auto-completed stale merge for ${issueId}`);
                  } else {
                    console.log(`[deacon] Merge specialist died and ${issueId} NOT merged. Resetting to readyForMerge.`);
                    setReviewStatus(issueId, { mergeStatus: 'pending' });
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

      const runtimeState = getAgentRuntimeState(projSpec.tmuxSession);
      // A running ephemeral specialist with no runtime state, or active for more than
      // the max specialist timeout (ephemeral specialist spawn uses 15 min), is considered stuck.
      const isStuck = runtimeState?.state === 'active' && runtimeState.lastActivity
        ? (Date.now() - new Date(runtimeState.lastActivity).getTime()) > 15 * 60 * 1000
        : false;

      if (isStuck) {
        addLog('warn', `Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing`, state.patrolCycle);
        console.log(`[deacon] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing ${projSpec.tmuxSession}`);
        try {
          await killSessionAsync(projSpec.tmuxSession);
          // Preserve Claude JSONL/session artifacts; only reset Panopticon runtime state.
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
          await killSessionAsync(projSpec.tmuxSession);
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
    const stateFile = join(AGENTS_DIR, agentId, 'state.json');
    if (!existsSync(stateFile)) continue;
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    } catch {
      continue;
    }
    if (state.status !== 'running') continue;

    // Check if the tmux session is alive
    if (!sessionExists(agentId)) continue;

    // Capture recent output and scan for signature corruption
    let output: string;
    try {
      output = await capturePaneAsync(agentId, 100);
    } catch {
      continue;
    }

    if (!output.includes('Invalid signature in thinking block')) continue;

    // Corruption detected — recover the agent
    const issueId = (state.issueId as string | undefined) ?? agentId;
    console.error(`[deacon] SIGNATURE CORRUPTION detected in ${agentId} (${issueId}) — recovering`);
    logDeaconEvent(`checkThinkingSignatureCorruption: corruption detected in ${agentId} (${issueId})`);
    logAgentLifecycle(agentId, 'signature corruption detected — recovering: killed session, cleared session.id');

    // Kill the tmux session
    try {
      await killSessionAsync(agentId);
    } catch { /* non-fatal */ }

    // Delete session.id so resumeAgent won't --resume the corrupted session
    const sessionFile = join(AGENTS_DIR, agentId, 'session.id');
    if (existsSync(sessionFile)) {
      try { rmSync(sessionFile); } catch { /* non-fatal */ }
    }

    // Mark agent as stopped
    state.status = 'stopped';
    state.stoppedAt = new Date().toISOString();
    try {
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch { /* non-fatal */ }

    // Notify server layer so the read model and frontend update
    if (agentStoppedNotifier) {
      try { agentStoppedNotifier(agentId); } catch { /* non-fatal */ }
    }

    const msg = `Recovered ${agentId} (${issueId}) from thinking-block signature corruption — session killed, will start fresh on next resume`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEvent(`checkThinkingSignatureCorruption: ${msg}`);
  }

  return actions;
}

/**
 * Start the deacon patrol loop
 */
let recoverOrphanedAgentsInFlight: Promise<string[]> | null = null;

/**
 * On startup, detect agents whose state.json claims 'running' or 'starting' but have
 * no live tmux session — this happens after a system crash where tmux was killed but
 * state.json was never updated. Reset them to 'stopped' so resume/re-plan works correctly.
 */
export async function recoverOrphanedAgents(context?: string): Promise<string[]> {
  if (recoverOrphanedAgentsInFlight) {
    logDeaconEvent(`recoverOrphanedAgents coalesced${context ? ` (${context})` : ''}: scan already in flight`);
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
    logDeaconEvent(`PANOPTICON_NO_RESUME=1 — skipping recoverOrphanedAgents${context ? ` (${context})` : ''}`);
    return [];
  }

  if (!existsSync(AGENTS_DIR)) return [];
  let dirs: string[];
  try { dirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-') || d.startsWith('planning-')); }
  catch { return []; }

  logDeaconEvent(`recoverOrphanedAgents started${context ? ` (${context})` : ''}: scanning ${dirs.length} directorie(s)`);
  const actions: string[] = [];
  for (const dir of dirs) {
    const stateFile = join(AGENTS_DIR, dir, 'state.json');
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (state.status !== 'running' && state.status !== 'starting') continue;
      if (isVerifyPausedAgentState(state)) {
        logDeaconEvent(`recoverOrphanedAgents: ${dir} skipped — verify-paused (mergeStatus=merged, tmux session intentionally absent)`);
        continue;
      }

      // PAN-977: headless review sub-role agents run via `claude --print` in a
      // detached, HUP-immune launcher with NO tmux session. "No tmux session"
      // is their normal steady state, not orphanhood — gating their liveness on
      // sessionExists() resets them to stopped on every patrol and thrashes the
      // convoy. Their lifecycle is owned by monitorReviewConvoySignals via the
      // launcher pid. Here we only orphan-recover them once that launcher pid is
      // actually gone (the launcher removes the pid file after it signals).
      if (state.reviewSubRole) {
        const reviewerLauncherPid = join(AGENTS_DIR, dir, 'reviewer-launcher.pid');
        if (existsSync(reviewerLauncherPid)) {
          let launcherAlive = false;
          try {
            const pid = Number.parseInt(readFileSync(reviewerLauncherPid, 'utf-8').trim(), 10);
            if (Number.isInteger(pid) && pid > 0) {
              try { process.kill(pid, 0); launcherAlive = true; } catch { launcherAlive = false; }
            }
          } catch { launcherAlive = false; }
          if (launcherAlive) continue; // launcher still working — not orphaned
        } else {
          // No pid file yet: the launcher either hasn't written it (startup
          // race) or already finished and cleaned up. Give it a startup grace
          // window keyed off startedAt before declaring the agent orphaned.
          const startedMs = Date.parse(state.startedAt ?? '');
          const REVIEWER_LAUNCHER_GRACE_MS = 90_000;
          if (Number.isFinite(startedMs) && Date.now() - startedMs < REVIEWER_LAUNCHER_GRACE_MS) {
            continue;
          }
        }
        // Launcher pid is gone (or never appeared past the grace window) — the
        // headless reviewer process has exited. Fall through to mark stopped.
      } else if (sessionExists(dir)) {
        // Planning sessions use remain-on-exit, so the tmux session persists after
        // Claude exits. Check if the pane's process is actually dead.
        if (dir.startsWith('planning-')) {
          try {
            const result = (await listPaneValuesAsync(dir, '#{pane_dead}'))[0]?.trim() ?? '';
            if (result !== '1') continue; // pane is alive — truly still running
            // Pane is dead — kill the zombie tmux session and fall through to recovery
            try { await killSessionAsync(dir); } catch { /* ignore */ }
            logDeaconEvent(`recoverOrphanedAgents: killed dead planning pane ${dir}`);
          } catch {
            continue; // can't check — assume alive
          }
        } else {
          continue; // truly still running
        }
      } else if (state.status === 'starting') {
        // PAN-1256: work agents in `starting` status need a startup grace
        // window before being declared orphaned. The harness launch (especially
        // kimi-k2.6 via pi, or large model warmup) can take 30-60+ seconds to
        // create the tmux session on a loaded system. Without this gate, the
        // 60s patrol races the spawn flow's 30s ready-poll and kills slow
        // spawns. Mirror the reviewer pattern (REVIEWER_LAUNCHER_GRACE_MS above)
        // with a generous window: patrol-interval (60s) + ready-poll (30s) +
        // headroom for tmux/launcher cold start.
        const startedMs = Date.parse(state.startedAt ?? '');
        const WORK_LAUNCHER_GRACE_MS = 120_000;
        if (Number.isFinite(startedMs) && Date.now() - startedMs < WORK_LAUNCHER_GRACE_MS) {
          continue;
        }
        // Past the grace window with no tmux session — true orphan, fall through.
      }
      // Orphaned — crashed agent with no tmux session
      const oldStatus = state.status;
      state.status = 'stopped';
      state.stoppedAt = new Date().toISOString();
      await saveAgentStateAsync(state);
      if (state.stoppedByUser !== true) {
        const failedState = await recordAgentFailureAsync(dir, `orphaned: tmux session missing (${context ?? 'patrol'})`);
        if (failedState) {
          notifyAgentStatusChanged(failedState, oldStatus);
          orphanFailureRecordedForAutoResume.add(dir);
        }
      }
      const msg = `Recovered orphaned agent ${dir} (${oldStatus}→stopped)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
      logDeaconEvent(`recoverOrphanedAgents: ${msg} — tmux session missing, state.json reset`);
      logAgentLifecycle(dir, `status changed: ${oldStatus} → stopped (orphaned: tmux session missing at boot)`);
      // Notify server layer so the read model and frontend update
      if (agentStoppedNotifier) {
        try { agentStoppedNotifier(dir); } catch { /* non-fatal */ }
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEvent(`recoverOrphanedAgents: error processing ${dir}: ${reason}`);
    }
  }
  if (actions.length > 0 && context) {
    console.log(`[deacon] ${context}: ${actions.length} orphaned agent(s) reset to stopped`);
    logDeaconEvent(`recoverOrphanedAgents completed (${context}): ${actions.length} orphaned agent(s) reset to stopped`);
  } else {
    logDeaconEvent(`recoverOrphanedAgents completed: no orphaned agents found`);
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
    planningSessions = (await listSessionNamesAsync())
      .filter(s => s.startsWith('planning-'));
  } catch {
    return actions;
  }

  logDeaconEvent(`cleanupOrphanedPlanningSessions started: found ${planningSessions.length} planning session(s)`);

  for (const planningSession of planningSessions) {
    // planning-pan-596 → agent-pan-596
    const workAgentSession = planningSession.replace(/^planning-/, 'agent-');
    if (!sessionExists(workAgentSession)) {
      logDeaconEvent(`cleanupOrphanedPlanningSessions: ${planningSession} kept — work agent ${workAgentSession} not running`);
      continue;
    }

    try {
      await killSessionAsync(planningSession).catch(() => {});
    } catch { /* non-fatal */ }

    // Mark planning agent state as stopped so the UI doesn't show a "running" pill.
    try {
      const stateFile = join(AGENTS_DIR, planningSession, 'state.json');
      if (existsSync(stateFile)) {
        const agentState = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (agentState.status === 'running' || agentState.status === 'starting') {
          const oldStatus = agentState.status;
          agentState.status = 'stopped';
          agentState.stoppedAt = new Date().toISOString();
          writeFileSync(stateFile, JSON.stringify(agentState, null, 2));
          if (agentStoppedNotifier) {
            try { agentStoppedNotifier(planningSession); } catch { /* non-fatal */ }
          }
          logAgentLifecycle(planningSession, `status changed: ${oldStatus} → stopped (orphaned planning session killed)`);
        }
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEvent(`cleanupOrphanedPlanningSessions: error updating state for ${planningSession}: ${reason}`);
    }

    const msg = `Killed orphaned ${planningSession} (work agent ${workAgentSession} is running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEvent(`cleanupOrphanedPlanningSessions: ${msg}`);
  }
  if (actions.length > 0) {
    logDeaconEvent(`cleanupOrphanedPlanningSessions completed: killed ${actions.length} orphaned session(s)`);
  } else {
    logDeaconEvent(`cleanupOrphanedPlanningSessions completed: no orphaned sessions found`);
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

  for (const agentId of agentDirs) {
    const state = getAgentState(agentId);
    if (!state) continue;
    if (state.role !== 'review') continue;
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
    const synthesisAlive = await sessionExistsAsync(state.reviewSynthesisAgentId);
    if (!synthesisAlive) continue;

    // PAN-977: the review sub-role launcher is HUP-immune and intentionally
    // outlives its tmux session, so "tmux session missing" is NOT a failure.
    // The launcher writes its pid to reviewer-launcher.pid and removes it once
    // it has signaled. Deacon checks the launcher process itself: while that
    // pid is alive the launcher is still working (or about to signal) and
    // Deacon stays out of the way. Deacon only steps in once the launcher pid
    // is gone with no signal marker — the rare SIGKILL-before-signal case.
    const launcherPidPath = join(AGENTS_DIR, agentId, 'reviewer-launcher.pid');
    let launcherAlive = false;
    if (existsSync(launcherPidPath)) {
      try {
        const pid = Number.parseInt(readFileSync(launcherPidPath, 'utf-8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); launcherAlive = true; } catch { launcherAlive = false; }
        }
      } catch { launcherAlive = false; }
    }

    // Startup grace: give the launcher time to write its pid file before a
    // missing pid is read as death (avoids racing the bash env setup).
    const REVIEWER_LAUNCHER_GRACE_MS = 90_000;
    const withinStartupGrace = Number.isFinite(startedMs) && (Date.now() - startedMs) < REVIEWER_LAUNCHER_GRACE_MS;

    let signal: 'ready' | 'failed' | 'timeout' | null = null;
    let reason = '';
    if (launcherAlive) {
      // Launcher still running — only intervene if it has blown well past its
      // deadline (genuinely wedged, e.g. a hung `pan tell`).
      if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs + REVIEWER_LAUNCHER_GRACE_MS) {
        signal = 'timeout';
        reason = `reviewer launcher still running past deadline ${state.reviewDeadlineAt}`;
      } else {
        continue;
      }
    } else if (withinStartupGrace) {
      // Launcher pid not written yet — too early to call it dead.
      continue;
    } else if (outputWrittenForThisRun) {
      // Launcher died after writing the report but before signaling READY.
      signal = 'ready';
    } else if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs) {
      signal = 'timeout';
      reason = `reviewer exceeded deadline ${state.reviewDeadlineAt}`;
    } else {
      // Launcher pid is gone, no report, before deadline → the launcher bash
      // process was SIGKILLed before it could run its signal block.
      signal = 'failed';
      reason = 'reviewer launcher process died before signaling synthesis';
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
      saveAgentState(state);
      const action = `Signaled ${message} to ${state.reviewSynthesisAgentId}`;
      actions.push(action);
      logDeaconEvent(`monitorReviewConvoySignals: ${action}`);
      if (signal === 'ready') {
        try {
          const { notifyPipeline } = await import('../pipeline-notifier.js');
          notifyPipeline({ type: 'reviewer_completed', issueId: state.issueId, role: state.reviewSubRole });
        } catch { /* non-fatal */ }
      } else if (signal === 'timeout') {
        try {
          const { notifyPipeline } = await import('../pipeline-notifier.js');
          notifyPipeline({
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
      logDeaconEvent(`monitorReviewConvoySignals: failed to signal ${state.reviewSynthesisAgentId} for ${agentId}: ${errMsg}`);
    }
  }

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
    const allSessions = await listSessionNamesAsync();
    const convoyReviewSessions = allSessions.filter(s => /^agent-.*-review-(?:security|correctness|performance|requirements)$/.test(s));
    const legacyReviewSessions = allSessions.filter(s => /^review-/.test(s));
    const canonicalReviewSessions = allSessions.filter(s => /^specialist-.*-review-/.test(s));
    reviewSessions = [...new Set([...convoyReviewSessions, ...legacyReviewSessions, ...canonicalReviewSessions])];
  } catch {
    return actions;
  }

  logDeaconEvent(`cleanupOrphanedReviewSessions started: found ${reviewSessions.length} review session(s)`);

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
      logDeaconEvent(`cleanupOrphanedReviewSessions: ${reviewSession} skipped — unparseable session name`);
      continue;
    }

    // PAN-1059 convoy sub-reviewers are owned by the synthesis agent
    // (agent-<id>-review), not the work agent. Check synthesis first,
    // then fall back to work agent for legacy review sessions.
    const synthesisAgentSession = `agent-${issueId.toLowerCase()}-review`;
    const workAgentSession = `agent-${issueId.toLowerCase()}`;
    if (sessionExists(synthesisAgentSession)) {
      logDeaconEvent(`cleanupOrphanedReviewSessions: ${reviewSession} kept — synthesis agent ${synthesisAgentSession} exists`);
      continue;
    }
    if (sessionExists(workAgentSession)) {
      logDeaconEvent(`cleanupOrphanedReviewSessions: ${reviewSession} kept — work agent ${workAgentSession} exists`);
      continue;
    }

    try {
      await killSessionAsync(reviewSession).catch(() => {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEvent(`cleanupOrphanedReviewSessions: error killing ${reviewSession}: ${reason}`);
    }

    const msg = `Killed orphaned ${reviewSession} (synthesis ${synthesisAgentSession} and work ${workAgentSession} not running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEvent(`cleanupOrphanedReviewSessions: ${msg}`);
  }
  if (actions.length > 0) {
    logDeaconEvent(`cleanupOrphanedReviewSessions completed: killed ${actions.length} orphaned session(s)`);
  } else {
    logDeaconEvent(`cleanupOrphanedReviewSessions completed: no orphaned sessions found`);
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

export async function nudgeIdleWorkAgentsWithOpenBeads(): Promise<string[]> {
  const actions: string[] = [];
  if (!existsSync(AGENTS_DIR)) return actions;

  let dirs: string[];
  try {
    dirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-'));
  } catch { return actions; }

  for (const agentId of dirs) {
    const state = getAgentState(agentId);
    if (!state) continue;
    if (state.status !== 'running') continue;
    if (state.role !== 'work') continue;

    // Tmux must be alive; orphans are handled by recoverOrphanedAgents.
    if (!await sessionExistsAsync(agentId)) continue;

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
      logDeaconEvent(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} bd ready failed: ${err?.message ?? err}`);
      continue;
    }
    if (openBeads.length === 0) continue;

    // Build the nudge: tell the agent what's next, do not just ping.
    const firstBead = openBeads[0]?.replace(/^[○◐]\s+/, '').slice(0, 200) ?? '';
    const message = [
      `Deacon idle-nudge: your tmux is alive but Claude is idle and you have ${openBeads.length} open bead(s) remaining for ${state.issueId}.`,
      ``,
      `Next ready bead: ${firstBead}`,
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
      logDeaconEvent(`nudgeIdleWorkAgentsWithOpenBeads: ${action}`);
    } catch (err: any) {
      logDeaconEvent(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} messageAgent failed: ${err?.message ?? err}`);
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
 */
export async function autoResumeStoppedWorkAgents(): Promise<string[]> {
  const resumed: string[] = [];
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEvent('PANOPTICON_NO_RESUME=1 — skipping autoResumeStoppedWorkAgents');
    orphanFailureRecordedForAutoResume.clear();
    return resumed;
  }

  if (!existsSync(AGENTS_DIR)) {
    orphanFailureRecordedForAutoResume.clear();
    return resumed;
  }

  let dirs: string[];
  try {
    dirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-'));
  } catch {
    orphanFailureRecordedForAutoResume.clear();
    return resumed;
  }

  logDeaconEvent(`autoResumeStoppedWorkAgents started: scanning ${dirs.length} agent directorie(s)`);

  for (const agentId of dirs) {
    const state = getAgentState(agentId);
    if (!state) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — no state.json`);
      continue;
    }
    if (state.status !== 'stopped') {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — status=${state.status} (not stopped)`);
      continue;
    }
    if (state.role !== 'work') {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — role=${state.role} (not work)`);
      continue;
    }

    // Skip if workspace is missing
    if (!state.workspace || !existsSync(state.workspace)) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — workspace missing (${state.workspace || 'undefined'})`);
      continue;
    }

    if (state.paused === true) {
      const pauseKind = isVerifyPausedAgentState(state) ? 'verify-paused' : 'manually-paused';
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — ${pauseKind} (${state.pausedReason ?? 'no reason'})`);
      continue;
    }

    if (state.troubled === true) {
      const failureCount = state.consecutiveFailures ?? 0;
      const since = state.firstFailureInRunAt ?? state.troubledAt ?? 'unknown';
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — troubled (${failureCount} consecutive failures since ${since})`);
      continue;
    }

    if (state.lastFailureNextRetryAt !== undefined) {
      const nextRetryMs = Date.parse(state.lastFailureNextRetryAt);
      if (Number.isFinite(nextRetryMs) && nextRetryMs > Date.now()) {
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — backoff active (next retry at ${state.lastFailureNextRetryAt})`);
        continue;
      }
    }

    // Skip if the agent has a completed marker (or processed completion) — unless
    // review or test found issues that need fixing (blocked / failed).
    const completedFile = join(getAgentDir(agentId), 'completed');
    const processedFile = join(getAgentDir(agentId), 'completed.processed');
    if (existsSync(completedFile) || existsSync(processedFile)) {
      const review = getReviewStatus(state.issueId);
      const needsFix =
        review?.reviewStatus === 'blocked' ||
        review?.reviewStatus === 'failed' ||
        review?.testStatus === 'failed';
      const trulyPassed =
        review?.reviewStatus === 'passed' && review?.testStatus === 'passed';
      if (needsFix) {
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} resuming despite completed marker — review/test needs fixing (review=${review?.reviewStatus}, test=${review?.testStatus})`);
      } else if (trulyPassed) {
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — completed marker exists and review/test passed`);
        continue;
      } else {
        // Pending state: pipeline mid-flight (review fan-out queued, test running, etc.).
        // Don't resume the agent — they're waiting for downstream signals to deliver feedback.
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — pipeline mid-flight (review=${review?.reviewStatus ?? 'none'}, test=${review?.testStatus ?? 'none'})`);
        continue;
      }
    }

    // Skip if already merge-ready (review+test passed) or already merged
    const review = getReviewStatus(state.issueId);
    if (review?.readyForMerge && review.reviewStatus === 'passed' && review.testStatus === 'passed') {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — already merge-ready`);
      continue;
    }
    if (review?.mergeStatus === 'merged') {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — already merged`);
      continue;
    }

    // Hard gate: postMergeLifecycle stamps `merged: true` on the agent state when
    // the issue's PR is merged. This is the authoritative do-not-resume signal —
    // it doesn't depend on review_status being correct (which can flap during
    // squash-detection races) and doesn't depend on shadow-state being up to
    // date (old issues may have no shadow file). Saw 10 spurious work agents
    // get respawned for already-merged issues during a mergeStatus flap window.
    if ((state as any).merged === true) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — agent state has merged=true (mergedAt=${(state as any).mergedAt ?? 'unknown'})`);
      continue;
    }

    const shadowState = await getShadowState(state.issueId);
    const issueClosed = shadowState?.trackerStatus === 'closed';
    if (issueClosed) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — issue ${state.issueId} is CLOSED on tracker`);
      continue;
    }

    const deliberatelyStopped = state.stoppedByUser === true;
    if (deliberatelyStopped) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — deliberately stopped by user (stoppedByUser=true)`);
      continue;
    }

    // Resume agents with pending review feedback regardless of why they stopped.
    // Review/test/verification failures mean the specialist pipeline needs the
    // agent to fix issues — auto-resume must NOT block on runtime.state here.
    const hasPendingReviewFeedback =
      review?.reviewStatus === 'blocked' ||
      review?.reviewStatus === 'failed' ||
      review?.testStatus === 'failed' ||
      review?.verificationStatus === 'failed';
    if (hasPendingReviewFeedback) {
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} resuming — review feedback pending (review=${review?.reviewStatus}, test=${review?.testStatus}, verification=${review?.verificationStatus})`);
    } else {

      // Fallback: runtime.state === 'idle' means the agent is genuinely idle,
      // not crashed. Skip auto-resume unless review feedback arrives later.
      const runtimeState = getAgentRuntimeState(agentId);
      if (runtimeState?.state === 'idle') {
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} skipped — idle (runtime.state=idle, no review feedback)`);
        continue;
      }
    }

    const runtimeStateForLog = getAgentRuntimeState(agentId);
    logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} candidate — calling resumeAgent (issueId=${state.issueId}, runtime.state=${runtimeStateForLog?.state || 'null'})`);
    try {
      const result = await resumeAgent(agentId);
      if (result.success) {
        resumed.push(agentId);
        const resumedState = await getAgentStateAsync(agentId);
        if (resumedState) {
          notifyAgentStatusChanged(resumedState, state.status);
        }
        const msg = `Auto-resumed ${agentId} (was orphaned by system event)`;
        console.log(`[deacon] ${msg}`);
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${msg}`);
        logAgentLifecycle(agentId, `resumed by deacon auto-recovery (session restored after system event)`);
        const issueId = state.issueId;
        emitActivityEntry({
          source: 'cloister',
          level: 'info',
          message: issueId
            ? `Deacon auto-resumed ${issueId} work agent`
            : `Deacon auto-resumed agent ${agentId}`,
          issueId,
        });
        emitActivityTts({
          utterance: issueId
            ? `Deacon auto resumed ${issueId} work agent`
            : `Deacon auto resumed agent ${agentId}`,
          priority: 1,
          issueId,
          source: 'cloister',
          eventType: 'agent.autoResumed',
        });
      } else {
        const msg = `Failed to auto-resume ${agentId}: ${result.error}`;
        if (!orphanFailureRecordedForAutoResume.has(agentId)) {
          const failedState = await recordAgentFailureAsync(agentId, msg);
          if (failedState) {
            notifyAgentStatusChanged(failedState, state.status);
          }
        }
        console.warn(`[deacon] ${msg}`);
        logDeaconEvent(`autoResumeStoppedWorkAgents: ${msg}`);
        logAgentLifecycle(agentId, `auto-resume FAILED: ${result.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!orphanFailureRecordedForAutoResume.has(agentId)) {
        const failedState = await recordAgentFailureAsync(agentId, `Auto-resume error for ${agentId}: ${msg}`);
        if (failedState) {
          notifyAgentStatusChanged(failedState, state.status);
        }
      }
      console.warn(`[deacon] Auto-resume error for ${agentId}: ${msg}`);
      logDeaconEvent(`autoResumeStoppedWorkAgents: ${agentId} auto-resume threw: ${msg}`);
      logAgentLifecycle(agentId, `auto-resume threw exception: ${msg}`);
    }
  }
  if (resumed.length > 0) {
    console.log(`[deacon] Auto-resumed ${resumed.length} work agent(s): ${resumed.join(', ')}`);
    logDeaconEvent(`autoResumeStoppedWorkAgents completed: resumed ${resumed.length} agent(s): ${resumed.join(', ')}`);
  } else {
    logDeaconEvent(`autoResumeStoppedWorkAgents completed: no agents resumed`);
  }
  orphanFailureRecordedForAutoResume.clear();
  return resumed;
}

export function startDeacon(): void {
  if (deaconInterval) {
    console.log('[deacon] Already running');
    return;
  }

  config = loadConfig();
  console.log(`[deacon] Starting health monitor (patrol every ${config.patrolIntervalMs / 1000}s)`);
  logDeaconEvent(`startDeacon: health monitor starting (patrol every ${config.patrolIntervalMs / 1000}s)`);

  // Recover agents whose tmux sessions were killed by a system crash before the
  // first patrol. The recovery mutex also coalesces any interval patrol that fires
  // while startup recovery is still scanning.
  void (async () => {
    await recoverOrphanedAgents('Startup recovery');
    await autoResumeStoppedWorkAgents();
    await runPatrol();
  })().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[deacon] Startup recovery/patrol error:', err);
    logDeaconEvent(`startDeacon: startup recovery/patrol error: ${msg}`);
  });

  // Schedule regular patrols
  deaconInterval = setInterval(() => {
    runPatrol().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[deacon] Patrol error:', err);
      logDeaconEvent(`patrol error: ${msg}`);
    });
  }, config.patrolIntervalMs);

  logDeaconEvent('startDeacon: health monitor started');
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
