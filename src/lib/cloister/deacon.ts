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
import { homedir } from 'os';

const execAsync = promisify(exec);
import { PANOPTICON_HOME } from '../paths.js';

// Review status file location (same as dashboard server)
const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');
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
export async function checkAndSuspendIdleAgents(): Promise<string[]> {
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

        // Kill tmux session (async to avoid blocking event loop - PAN-72)
        await execAsync(`tmux kill-session -t "${agent.id}" 2>/dev/null || true`);

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

// ============================================================================
// Lazy Agent Detection
// ============================================================================

/**
 * Patterns that indicate a lazy agent trying to avoid work
 */
const LAZY_PATTERNS = [
  /what would you like me to do\??/i,
  /option\s*[123]:/i,
  /options?:/i,
  /would you prefer/i,
  /should I (continue|proceed|stop)/i,
  /this would take \d+[-–]\d+ hours/i,
  /estimated \d+ hours/i,
  /manual intervention/i,
  /requires human/i,
  /stop here/i,
  /deferred (to|for) (future|later|follow-up)/i,
  /future PR/i,
  /follow-up issue/i,
  /documented for later/i,
  /remaining work documented/i,
  /targeted approach/i,
  /infrastructure.*(complete|done).*tests.*(fail|broken)/i,
];

/**
 * Anti-lazy message sent when lazy behavior is detected
 */
const ANTI_LAZY_MESSAGE = `STOP. You are being lazy. Do not ask for options or permission. Do not offer to stop here. Do not defer work. Complete ALL the work now. Fix ALL failing tests. Do not give time estimates. The only acceptable end state is: all tests pass, all code committed, all code pushed. Continue working until that is achieved.`;

// Track when we last sent anti-lazy message to each agent (debounce)
const lazyMessageCooldowns: Map<string, number> = new Map();
const LAZY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check tmux output for lazy agent behavior
 * Only checks recent output (last 20 lines) to avoid matching old history
 * Only triggers if agent appears to be at idle prompt (waiting for input)
 */
export async function checkLazyAgent(sessionName: string): Promise<{
  isLazy: boolean;
  matchedPattern?: string;
  output?: string;
}> {
  try {
    // Check cooldown - don't spam the same agent
    const lastSent = lazyMessageCooldowns.get(sessionName) || 0;
    if (Date.now() - lastSent < LAZY_COOLDOWN_MS) {
      return { isLazy: false };
    }

    // Capture recent tmux output (last 20 lines only - recent behavior)
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -20 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );

    if (!stdout.trim()) {
      return { isLazy: false };
    }

    // Only check if agent appears to be idle (waiting for input)
    // Look for prompt indicators like "> " at end, or "?" waiting for response
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1] || '';
    const isAtPrompt = lastLine.match(/^[>\$#]\s*$/) ||
                       lastLine.endsWith('?') ||
                       lastLine.includes('What would you like');

    if (!isAtPrompt) {
      // Agent is actively working, don't interrupt
      return { isLazy: false };
    }

    // Check for lazy patterns in recent output
    for (const pattern of LAZY_PATTERNS) {
      if (pattern.test(stdout)) {
        return {
          isLazy: true,
          matchedPattern: pattern.source,
          output: stdout.slice(-500), // Last 500 chars for context
        };
      }
    }

    return { isLazy: false };
  } catch {
    return { isLazy: false };
  }
}

/**
 * Send anti-lazy message to an agent
 */
export async function sendAntiLazyMessage(sessionName: string): Promise<boolean> {
  try {
    // Send the anti-lazy message
    await execAsync(
      `tmux send-keys -t "${sessionName}" "${ANTI_LAZY_MESSAGE.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8' }
    );
    // Send Enter
    await execAsync(`tmux send-keys -t "${sessionName}" Enter`, { encoding: 'utf-8' });

    // Record cooldown to prevent spam
    lazyMessageCooldowns.set(sessionName, Date.now());

    console.log(`[deacon] Sent anti-lazy message to ${sessionName}`);
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[deacon] Failed to send anti-lazy message to ${sessionName}:`, msg);
    return false;
  }
}

/**
 * Check if an issue has completed or is in the review pipeline (agent has handed off)
 *
 * Returns true if:
 * - Issue has been merged (status cleared)
 * - Issue is in review pipeline (reviewing, testing, passed, readyForMerge)
 *
 * In these cases, the agent has done its job and shouldn't get anti-lazy messages.
 */
function isIssueCompletedOrInReview(agentId: string): boolean {
  try {
    // Extract issue ID from agent ID (e.g., "agent-pan-97" -> "PAN-97")
    const match = agentId.match(/agent-([a-z]+-\d+)/i);
    if (!match) return false;

    const issueId = match[1].toUpperCase();

    if (!existsSync(REVIEW_STATUS_FILE)) {
      // No review status file at all - assume agent hasn't started review yet
      return false;
    }

    const content = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    const statuses = JSON.parse(content);
    const status = statuses[issueId];

    // If status was cleared (after merge), agent has completed
    if (!status) {
      // Check if issue appears to have been processed before
      // No status = either never started review, or was cleared after merge
      // We'll be conservative: if the agent is idle and no status exists,
      // check if Linear/GitHub issue is closed
      return false; // Will need to check issue tracker status separately
    }

    // If issue is in review pipeline (reviewing, testing, or passed), agent has handed off
    const hasCompletedReview =
      status.reviewStatus === 'reviewing' ||
      status.reviewStatus === 'passed' ||
      status.testStatus === 'testing' ||
      status.testStatus === 'passed' ||
      status.readyForMerge === true ||
      status.mergeStatus === 'merging' ||
      status.mergeStatus === 'merged';

    return hasCompletedReview;
  } catch {
    return false;
  }
}

/**
 * Check all active agents for lazy behavior and auto-correct
 */
export async function checkAndCorrectLazyAgents(): Promise<string[]> {
  const actions: string[] = [];

  // Get all running agents
  const agents = listRunningAgents();

  for (const agent of agents) {
    if (!agent.tmuxActive) continue;

    // Skip agents whose issues are already in the review pipeline or completed
    // They've done their work and handed off - not lazy
    if (isIssueCompletedOrInReview(agent.id)) {
      continue;
    }

    // Check for lazy behavior
    const lazyCheck = await checkLazyAgent(agent.id);

    if (lazyCheck.isLazy) {
      console.log(`[deacon] Lazy agent detected: ${agent.id} (pattern: ${lazyCheck.matchedPattern})`);

      // Send correction message
      const sent = await sendAntiLazyMessage(agent.id);
      if (sent) {
        actions.push(`Corrected lazy agent ${agent.id} (matched: ${lazyCheck.matchedPattern})`);
      }
    }
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
export async function checkOrphanedReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    if (!existsSync(REVIEW_STATUS_FILE)) {
      return actions;
    }

    const content = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    const statuses: Record<string, { reviewStatus?: string; testStatus?: string }> = JSON.parse(content);

    // Check review-agent status
    const reviewAgentSession = getTmuxSessionName('review-agent');
    const reviewAgentRunning = sessionExists(reviewAgentSession);
    const reviewAgentState = getAgentRuntimeState(reviewAgentSession);
    const reviewAgentActive = reviewAgentRunning && reviewAgentState?.state === 'active';

    // Check test-agent status
    const testAgentSession = getTmuxSessionName('test-agent');
    const testAgentRunning = sessionExists(testAgentSession);
    const testAgentState = getAgentRuntimeState(testAgentSession);
    const testAgentActive = testAgentRunning && testAgentState?.state === 'active';

    let modified = false;

    for (const [issueId, status] of Object.entries(statuses)) {
      // Check for orphaned reviewing status
      if (status.reviewStatus === 'reviewing' && !reviewAgentActive) {
        console.log(`[deacon] Orphaned review detected: ${issueId} shows 'reviewing' but review-agent is not active`);
        status.reviewStatus = 'pending';
        modified = true;
        actions.push(`Reset orphaned review for ${issueId} (review-agent not active)`);
      }

      // Check for orphaned testing status
      if (status.testStatus === 'testing' && !testAgentActive) {
        console.log(`[deacon] Orphaned test detected: ${issueId} shows 'testing' but test-agent is not active`);
        status.testStatus = 'pending';
        modified = true;
        actions.push(`Reset orphaned test for ${issueId} (test-agent not active)`);
      }
    }

    // Save changes if any
    if (modified) {
      writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking orphaned review statuses:', msg);
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
      const killResult = await forceKillSpecialist(specialist.name);
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

  // Check and auto-suspend idle agents (PAN-80)
  const suspendActions = await checkAndSuspendIdleAgents();
  actions.push(...suspendActions);

  // Check for orphaned review/test statuses (PAN-88)
  const orphanActions = await checkOrphanedReviewStatuses();
  actions.push(...orphanActions);

  // Check for lazy agent behavior and auto-correct
  const lazyActions = await checkAndCorrectLazyAgents();
  actions.push(...lazyActions);

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
