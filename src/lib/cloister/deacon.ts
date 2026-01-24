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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { PANOPTICON_HOME } from '../paths.js';
import {
  SpecialistType,
  getEnabledSpecialists,
  getTmuxSessionName,
  isRunning,
  initializeSpecialist,
  checkSpecialistQueue,
  getNextSpecialistTask,
  wakeSpecialistWithTask,
  completeSpecialistTask,
} from './specialists.js';
import { getAgentRuntimeState, saveAgentRuntimeState, saveSessionId, listRunningAgents } from '../agents.js';
import { sessionExists } from '../tmux.js';

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
  patrolIntervalMs: 30_000,        // Check every 30 seconds
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
  specialistName: SpecialistType;
  lastPingTime?: string;         // ISO 8601
  lastResponseTime?: string;     // ISO 8601
  consecutiveFailures: number;
  lastForceKillTime?: string;    // ISO 8601
  forceKillCount: number;
}

/**
 * Complete health check state for all specialists
 */
export interface DeaconState {
  specialists: Record<SpecialistType, SpecialistHealthState>;
  lastPatrol?: string;           // ISO 8601
  patrolCycle: number;
  recentDeaths: string[];        // ISO timestamps of recent deaths
  lastMassDeathAlert?: string;   // ISO 8601
}

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  specialistName: SpecialistType;
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
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const loaded = JSON.parse(content);
      config = { ...DEFAULT_CONFIG, ...loaded };
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
    specialists: {} as Record<SpecialistType, SpecialistHealthState>,
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
  name: SpecialistType
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
function checkHeartbeat(name: SpecialistType): {
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
 */
export function checkSpecialistHealth(name: SpecialistType): HealthCheckResult {
  const state = loadState();
  const healthState = getSpecialistState(state, name);
  const wasRunning = isRunning(name);

  // Update ping time
  healthState.lastPingTime = new Date().toISOString();

  // If not running, it's not responsive
  if (!wasRunning) {
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
    saveState(state);

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

  // Not responsive - increment failure counter
  healthState.consecutiveFailures++;
  saveState(state);

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
 */
export async function forceKillSpecialist(name: SpecialistType): Promise<{
  success: boolean;
  message: string;
}> {
  const tmuxSession = getTmuxSessionName(name);
  const state = loadState();
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
    await execAsync(`tmux kill-session -t "${tmuxSession}"`);

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

    saveState(state);

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
 */
export function checkMassDeath(): {
  isMassDeath: boolean;
  deathCount: number;
  message?: string;
} {
  const state = loadState();

  // Prune old deaths
  const windowStart = Date.now() - config.massDeathWindowMs;
  state.recentDeaths = state.recentDeaths.filter(
    (d) => new Date(d).getTime() > windowStart
  );
  saveState(state);

  const deathCount = state.recentDeaths.length;

  if (deathCount >= config.massDeathThreshold) {
    // Check if we already alerted recently
    if (state.lastMassDeathAlert) {
      const lastAlert = new Date(state.lastMassDeathAlert).getTime();
      const alertCooldown = 5 * 60_000; // 5 minutes between alerts
      if (Date.now() - lastAlert < alertCooldown) {
        return {
          isMassDeath: true,
          deathCount,
          message: 'Mass death detected (already alerted)',
        };
      }
    }

    // Record alert
    state.lastMassDeathAlert = new Date().toISOString();
    saveState(state);

    return {
      isMassDeath: true,
      deathCount,
      message: `ALERT: ${deathCount} specialist deaths in ${config.massDeathWindowMs / 1000}s - possible infrastructure issue`,
    };
  }

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
 * Work agents: 10 minute idle timeout
 */
async function checkAndSuspendIdleAgents(): Promise<string[]> {
  const actions: string[] = [];
  const specialists = getEnabledSpecialists();
  const specialistNames = new Set(specialists.map(s => getTmuxSessionName(s.name)));

  // Get all running agents
  const agents = listRunningAgents();

  for (const agent of agents) {
    if (!agent.tmuxActive) {
      continue; // Skip if tmux session is already gone
    }

    // Get runtime state (from hooks)
    const runtimeState = getAgentRuntimeState(agent.id);

    // Only suspend idle agents
    if (!runtimeState || runtimeState.state !== 'idle') {
      continue;
    }

    // Calculate idle time
    const lastActivity = new Date(runtimeState.lastActivity);
    const idleMs = Date.now() - lastActivity.getTime();
    const idleMinutes = idleMs / (1000 * 60);

    // Determine timeout based on agent type
    const isSpecialist = specialistNames.has(agent.id);
    const timeoutMinutes = isSpecialist ? 5 : 10;

    // Check if idle timeout exceeded
    if (idleMinutes > timeoutMinutes) {
      console.log(`[deacon] Auto-suspending ${agent.id} (idle for ${Math.round(idleMinutes)} minutes)`);

      try {
        // Get session ID if available (would come from hook state or API)
        // For now, we'll save the agent ID as a placeholder - in a real implementation,
        // Claude would report its session ID via a hook or we'd extract it from the API
        const sessionId = runtimeState.sessionId || `session-${agent.id}`;

        // Save session ID for later resume
        saveSessionId(agent.id, sessionId);

        // Kill tmux session
        execSync(`tmux kill-session -t "${agent.id}" 2>/dev/null || true`);

        // Update state
        saveAgentRuntimeState(agent.id, {
          state: 'suspended',
          suspendedAt: new Date().toISOString(),
          sessionId,
        });

        actions.push(`Auto-suspended ${agent.id} after ${Math.round(idleMinutes)}min idle`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Failed to suspend ${agent.id}:`, msg);
      }
    }
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

  const enabled = getEnabledSpecialists();
  const results: HealthCheckResult[] = [];
  const actions: string[] = [];

  console.log(`[deacon] Patrol cycle ${state.patrolCycle} - checking ${enabled.length} specialists`);

  for (const specialist of enabled) {
    const result = checkSpecialistHealth(specialist.name);
    results.push(result);

    // Handle stuck specialists
    if (result.shouldForceKill) {
      console.log(`[deacon] ${specialist.name} stuck (${result.consecutiveFailures} failures), force-killing`);
      const killResult = forceKillSpecialist(specialist.name);
      actions.push(`Force-killed ${specialist.name}: ${killResult.message}`);

      // Auto-restart if specialist was initialized
      if (killResult.success) {
        console.log(`[deacon] Auto-restarting ${specialist.name}...`);
        const initResult = await initializeSpecialist(specialist.name);
        if (initResult.success) {
          actions.push(`Auto-restarted ${specialist.name}`);
        } else {
          actions.push(`Failed to restart ${specialist.name}: ${initResult.message}`);
        }
      }
    } else if (!result.wasRunning && !result.inCooldown) {
      // Specialist should be running but isn't - auto-start
      console.log(`[deacon] ${specialist.name} not running, auto-starting...`);
      const initResult = await initializeSpecialist(specialist.name);
      if (initResult.success) {
        actions.push(`Auto-started ${specialist.name}`);
      } else if (initResult.error !== 'already_running') {
        actions.push(`Failed to start ${specialist.name}: ${initResult.message}`);
      }
    }

    // Check for queued work if specialist is idle or suspended (PAN-74, updated for PAN-80)
    const specialistSession = getTmuxSessionName(specialist.name);
    const runtimeState = getAgentRuntimeState(specialistSession);
    const queue = checkSpecialistQueue(specialist.name);

    // Auto-resume suspended specialists if they have queued work (PAN-80)
    if (runtimeState?.state === 'suspended' && queue.hasWork) {
      const nextTask = getNextSpecialistTask(specialist.name);
      if (nextTask) {
        console.log(`[deacon] Auto-resuming suspended ${specialist.name} for queued task: ${nextTask.payload.issueId}`);
        try {
          const { resumeAgent } = await import('../agents.js');
          const message = `# Queued Work\n\nProcessing queued task: ${nextTask.payload.issueId}`;
          const resumeResult = await resumeAgent(specialistSession, message);

          if (resumeResult.success) {
            actions.push(`Auto-resumed ${specialist.name} for queued task: ${nextTask.payload.issueId}`);
            completeSpecialistTask(specialist.name, nextTask.id);
          } else {
            console.error(`[deacon] Failed to auto-resume ${specialist.name}: ${resumeResult.error}`);
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[deacon] Error auto-resuming ${specialist.name}:`, msg);
        }
      }
    }
    // Wake idle specialists if they have queued work
    else if (result.wasRunning && runtimeState?.state === 'idle' && queue.hasWork) {
      const nextTask = getNextSpecialistTask(specialist.name);
      if (nextTask) {
        console.log(`[deacon] ${specialist.name} idle with queued work, waking for ${nextTask.payload.issueId}`);
        try {
            // Extract task details from payload
            // Note: branch, workspace, prUrl are stored in context by submitToSpecialistQueue
            const taskDetails = {
              issueId: nextTask.payload.issueId || '',
              branch: nextTask.payload.context?.branch,
              workspace: nextTask.payload.context?.workspace,
              prUrl: nextTask.payload.context?.prUrl,
              context: nextTask.payload.context,
            };
            const wakeResult = await wakeSpecialistWithTask(specialist.name, taskDetails);
            if (wakeResult.success) {
              completeSpecialistTask(specialist.name, nextTask.id);
              actions.push(`Processed queued task for ${specialist.name}: ${nextTask.payload.issueId}`);
            } else {
              console.error(`[deacon] Failed to wake ${specialist.name} for queued task: ${wakeResult.error}`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[deacon] Error processing queue for ${specialist.name}:`, msg);
          }
        }
      }
    }
  }

  // Check and auto-suspend idle agents (PAN-80)
  const suspendActions = await checkAndSuspendIdleAgents();
  actions.push(...suspendActions);

  saveState(state);

  // Check for mass death
  const massDeathCheck = checkMassDeath();
  if (massDeathCheck.isMassDeath && massDeathCheck.message) {
    console.error(`[deacon] ${massDeathCheck.message}`);
    actions.push(massDeathCheck.message);
  }

  return {
    cycle: state.patrolCycle,
    timestamp: state.lastPatrol,
    specialists: results,
    actionsToken: actions,
    massDeathDetected: massDeathCheck.isMassDeath,
  };
}

/**
 * Start the deacon patrol loop
 */
export function startDeacon(): void {
  if (deaconInterval) {
    console.log('[deacon] Already running');
    return;
  }

  config = loadConfig();
  console.log(`[deacon] Starting health monitor (patrol every ${config.patrolIntervalMs / 1000}s)`);

  // Run initial patrol
  runPatrol().catch((err) => console.error('[deacon] Patrol error:', err));

  // Schedule regular patrols
  deaconInterval = setInterval(() => {
    runPatrol().catch((err) => console.error('[deacon] Patrol error:', err));
  }, config.patrolIntervalMs);
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
