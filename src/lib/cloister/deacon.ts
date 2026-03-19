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
import { join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { PANOPTICON_HOME, AGENTS_DIR } from '../paths.js';
import { loadCloisterConfig } from './config.js';

// Review status file location (same as dashboard server)
const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

/**
 * Update testStatus to 'testing' when the test-agent starts working.
 * Uses the shared review-status.json file (same as dashboard server).
 */
function updateTestStatusToTesting(issueId: string): void {
  try {
    if (!existsSync(REVIEW_STATUS_FILE)) return;
    const data = JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
    const upper = issueId.toUpperCase();
    if (data[upper]) {
      data[upper].testStatus = 'testing';
      data[upper].updatedAt = new Date().toISOString();
      writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[deacon] Updated testStatus to 'testing' for ${upper}`);
    }
  } catch (error) {
    console.error(`[deacon] Failed to update testStatus for ${issueId}:`, error);
  }
}
import {
  SpecialistType,
  getEnabledSpecialists,
  getTmuxSessionName,
  isRunning,
  initializeSpecialist,
  wakeSpecialist,
  clearSessionId,
  checkSpecialistQueue,
  getNextSpecialistTask,
  wakeSpecialistWithTask,
  completeSpecialistTask,
  getAllProjectSpecialistStatuses,
} from './specialists.js';
import { getAgentRuntimeState, saveAgentRuntimeState, saveSessionId, listRunningAgents, getAgentDir, getAgentState, saveAgentState } from '../agents.js';
import { sessionExists, sendKeysAsync } from '../tmux.js';

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
  mergeStuckAttempts?: Record<string, number>;  // circuit-breaker attempt counts (PAN-344)
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
 *
 * When called from runPatrol, pass the shared state object to avoid
 * independent load/save cycles that clobber each other (the original
 * bug that prevented consecutiveFailures from ever accumulating).
 *
 * When called standalone (no sharedState), loads and saves state itself.
 */
export async function checkSpecialistHealth(
  name: SpecialistType,
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
  name: SpecialistType,
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

    // P0 FIX: Sync state.json lastActivity with runtime heartbeat
    // This keeps the dashboard accurate and prevents stale state display
    if (runtimeState && runtimeState.lastActivity) {
      const state = getAgentState(agent.id);
      if (state) {
        const runtimeLastActivity = runtimeState.lastActivity;
        const stateLastActivity = state.lastActivity;

        // Update state.json if runtime is more recent (or state has no timestamp)
        if (!stateLastActivity || new Date(runtimeLastActivity) > new Date(stateLastActivity)) {
          state.lastActivity = runtimeLastActivity;
          saveAgentState(state);
        }
      }
    }

    // Only suspend idle agents
    if (!runtimeState || runtimeState.state !== 'idle') {
      continue;
    }

    // PAN-154: Check tmux output for active status indicators before marking idle
    // Agents that are computing/thinking/reading are NOT idle despite hook state
    const activeInTmux = await isAgentActiveInTmux(agent.id);
    if (activeInTmux) {
      continue; // Agent is actively working, skip suspension
    }

    // Calculate idle time
    const lastActivity = new Date(runtimeState.lastActivity);
    const idleMs = Date.now() - lastActivity.getTime();
    const idleMinutes = idleMs / (1000 * 60);

    // Determine timeout based on agent type
    const isSpecialist = specialistNames.has(agent.id);

    // NEVER auto-suspend work agents — they wait for review/test feedback
    // and must stay alive to receive results. Only suspend specialists.
    const isWorkAgent = agent.id.startsWith('agent-') && !isSpecialist;
    if (isWorkAgent) {
      continue;
    }

    const timeoutMinutes = 5; // Specialists only

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

    // PAN-154: Check if agent is actively computing/thinking before checking laziness
    // Agents showing status indicators are working, not lazy
    for (const pattern of ACTIVE_STATUS_PATTERNS) {
      if (pattern.test(stdout)) {
        return { isLazy: false };
      }
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
// Agent State Cleanup
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
 * Parses last 5 lines of tmux capture-pane output for status indicators
 */
export async function isAgentActiveInTmux(sessionName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -5 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );

    if (!stdout.trim()) return false;

    for (const pattern of ACTIVE_STATUS_PATTERNS) {
      if (pattern.test(stdout)) {
        // "Thinking" with a duration over the threshold is NOT active — it's stuck.
        // Don't let stuck agents masquerade as active.
        if (/thinking/i.test(stdout)) {
          const thinkingMs = parseThinkingDuration(stdout);
          if (thinkingMs !== null && thinkingMs >= STUCK_THINKING_THRESHOLD_MS) {
            return false; // Stuck, not active
          }
        }
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
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
  // Match patterns like "Thinking… (22m 41s" or "Thinking… (5s"
  const match = tmuxOutput.match(/[Tt]hinking[^\n]*?\((?:(\d+)m\s*)?(\d+)s/);
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
  const specialists = getEnabledSpecialists();
  const specialistNames = new Set(specialists.map(s => getTmuxSessionName(s.name)));
  const now = Date.now();

  for (const agent of agents) {
    if (!agent.tmuxActive) continue;

    // Only check work agents, not specialists (specialists have their own health checks)
    const isWorkAgent = agent.id.startsWith('agent-') && !specialistNames.has(agent.id);
    if (!isWorkAgent) continue;

    // Check cooldown
    const recovery = stuckRecoveryState.get(agent.id);
    if (recovery && (now - recovery.lastAttempt) < STUCK_RECOVERY_COOLDOWN_MS) {
      continue;
    }

    // Capture tmux output to check for stuck thinking
    let tmuxOutput: string;
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -t "${agent.id}" -p -S -10 2>/dev/null || echo ""`,
        { encoding: 'utf-8' }
      );
      tmuxOutput = stdout;
    } catch {
      continue;
    }

    if (!tmuxOutput.trim()) continue;

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

    console.log(`[deacon] Work agent ${agent.id} stuck thinking for ${thinkingMinutes}m (attempt ${attempts + 1})`);

    try {
      if (attempts === 0) {
        // First attempt: send Escape to cancel thinking
        await execAsync(`tmux send-keys -t "${agent.id}" Escape 2>/dev/null || true`);
        actions.push(`Stuck recovery: sent Escape to ${agent.id} (thinking ${thinkingMinutes}m)`);
      } else if (attempts === 1) {
        // Second attempt: send Ctrl+C to interrupt
        await execAsync(`tmux send-keys -t "${agent.id}" C-c 2>/dev/null || true`);
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
        await execAsync(`tmux kill-session -t "${agent.id}" 2>/dev/null || true`);

        // Small delay to let tmux clean up
        await new Promise(r => setTimeout(r, 1000));

        // Respawn in a new tmux session with the same launcher
        await execAsync(
          `tmux new-session -d -s "${agent.id}" -c "${workspace}" "bash ${launcherPath}"`,
          { encoding: 'utf-8' }
        );

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
  const retentionDays = cloisterConfig.retention?.agent_state_days ?? 30;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (!existsSync(AGENTS_DIR)) {
    return actions;
  }

  try {
    const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const agentDir = join(AGENTS_DIR, dir.name);

      try {
        // Check if tmux session is active — never clean up running agents
        try {
          await execAsync(`tmux has-session -t "${dir.name}" 2>/dev/null`);
          continue; // Session exists, skip
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
        if (ageMs < retentionMs) {
          continue; // Not old enough, skip
        }

        // Check for recently processed completion (don't delete if completed recently)
        const completedFile = join(agentDir, 'completed');
        if (existsSync(completedFile)) {
          const completedAge = now - statSync(completedFile).mtimeMs;
          // Keep completed agents for at least 7 days regardless of retention
          if (completedAge < 7 * 24 * 60 * 60 * 1000) {
            continue;
          }
        }

        // Safe to remove
        const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000));
        rmSync(agentDir, { recursive: true, force: true });
        actions.push(`Purged stale agent state: ${dir.name} (${ageDays} days old)`);
        console.log(`[deacon] Purged stale agent state: ${dir.name} (${ageDays} days old)`);
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
    const statuses: Record<string, { reviewStatus?: string; testStatus?: string; readyForMerge?: boolean; history?: Array<{ type: string; status: string }> }> = JSON.parse(content);

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
      // Skip issues that already completed their pipeline — don't reset
      // statuses that the specialist already reported results for.
      // History contains the ground truth; the top-level status fields
      // are just the latest snapshot.
      const hasPassedReview = status.history?.some(
        (h) => h.type === 'review' && h.status === 'passed'
      );
      const hasPassedTest = status.history?.some(
        (h) => h.type === 'test' && (h.status === 'passed' || h.status === 'failed')
      );

      // Check for orphaned reviewing status
      if (status.reviewStatus === 'reviewing' && !reviewAgentActive && !hasPassedReview) {
        console.log(`[deacon] Orphaned review detected: ${issueId} shows 'reviewing' but review-agent is not active`);
        status.reviewStatus = 'pending';
        modified = true;
        actions.push(`Reset orphaned review for ${issueId} (review-agent not active)`);
      }

      // Check for orphaned testing status
      if (status.testStatus === 'testing' && !testAgentActive && !hasPassedTest && !status.readyForMerge) {
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

// ============================================================================
// Ready-for-merge stuck detection (PAN-344)
// ============================================================================

// Minimum age (ms) of a readyForMerge status before deacon considers it stuck.
// Primary trigger fires synchronously in setReviewStatus; 2 min gives it time to start.
const MERGE_STUCK_STALENESS_MS = 2 * 60 * 1000; // 2 minutes
// Minimum wait (ms) between successive auto-merge attempts for the same issue
const MERGE_STUCK_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
// Circuit breaker: stop attempting after this many tries
const MERGE_STUCK_MAX_ATTEMPTS = 3;

// In-memory cooldowns for stuck-merge detection (reset on server restart is acceptable —
// cooldowns are a performance optimisation, not critical state)
const mergeStuckCooldowns = new Map<string, number>();

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
    if (!existsSync(REVIEW_STATUS_FILE)) {
      return actions;
    }

    const content = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    const statuses: Record<string, {
      issueId?: string;
      readyForMerge?: boolean;
      mergeStatus?: string;
      updatedAt?: string;
    }> = JSON.parse(content);

    const now = Date.now();
    const state = loadState();
    const attemptCounts = state.mergeStuckAttempts ?? {};
    let stateModified = false;

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on issues that are ready but not yet merging/merged/failed
      if (!status.readyForMerge) continue;
      if (status.mergeStatus === 'merging' || status.mergeStatus === 'merged' || status.mergeStatus === 'failed') continue;

      // Staleness check: must have been readyForMerge for at least 2 minutes.
      // Skip entries without a timestamp — we cannot determine staleness.
      if (!status.updatedAt) continue;
      const statusAge = now - new Date(status.updatedAt).getTime();
      if (statusAge < MERGE_STUCK_STALENESS_MS) continue;

      // Per-issue cooldown (in-memory — reset on restart is acceptable for a rate-limiter)
      const lastAttempt = mergeStuckCooldowns.get(key);
      if (lastAttempt && (now - lastAttempt) < MERGE_STUCK_COOLDOWN_MS) continue;

      // Circuit breaker (persisted to deacon state so restart doesn't reset the count)
      const attempts = attemptCounts[key] ?? 0;
      if (attempts >= MERGE_STUCK_MAX_ATTEMPTS) {
        console.log(`[deacon] Merge stuck circuit breaker active for ${key} (${attempts}/${MERGE_STUCK_MAX_ATTEMPTS} attempts)`);
        continue;
      }

      const ageMin = Math.round((now - new Date(status.updatedAt).getTime()) / 60000);
      console.warn(`[deacon] readyForMerge stuck for ${key} (age: ${ageMin}m, attempts: ${attempts}) — merge requires manual action via MERGE button`);

      // Record attempt before notifying so a crash doesn't leave us in a retry loop
      mergeStuckCooldowns.set(key, now);
      attemptCounts[key] = attempts + 1;
      stateModified = true;

      // Notify the dashboard via Socket.io so the user knows to click MERGE.
      // Auto-triggering merge was removed in PAN-354; the MERGE button is the sole trigger.
      const msg = `Stuck-merge: ${key} has been readyForMerge for ${ageMin}m — click MERGE to proceed`;
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

// Track per-issue cooldowns for dead-end recovery to avoid spamming
const deadEndCooldowns = new Map<string, number>();

// Minimum time (ms) after status update before dead-end detection intervenes
const DEAD_END_STALENESS_MS = 5 * 60 * 1000; // 5 minutes
// Cooldown between successive dead-end recovery attempts for the same issue
const DEAD_END_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Detect dead-end agents: review blocked or tests failed, but work agent is idle.
 *
 * This happens when:
 * - Review feedback was delivered with a wrong URL (now fixed, but old feedback persists)
 * - Agent forgot how to resubmit (context compaction lost instructions)
 * - Feedback delivery to tmux failed silently
 *
 * Recovery: re-queue the review via the request-review API endpoint and
 * send the agent a nudge message with the correct resubmit command.
 */
export async function checkDeadEndAgents(): Promise<string[]> {
  const actions: string[] = [];

  try {
    if (!existsSync(REVIEW_STATUS_FILE)) {
      return actions;
    }

    const content = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    const statuses: Record<string, {
      issueId?: string;
      reviewStatus?: string;
      testStatus?: string;
      readyForMerge?: boolean;
      mergeStatus?: string;
      updatedAt?: string;
      autoRequeueCount?: number;
      history?: Array<{ type: string; status: string; timestamp?: string }>;
    }> = JSON.parse(content);

    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on blocked reviews or failed tests
      const isReviewBlocked = status.reviewStatus === 'blocked';
      const isTestFailed = status.testStatus === 'failed';
      if (!isReviewBlocked && !isTestFailed) continue;

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
      if (autoRequeueCount >= 7) {
        console.log(`[deacon] Dead-end detected for ${key} but circuit breaker active (${autoRequeueCount}/7 requeues used)`);
        continue;
      }

      // Check if the work agent exists and is idle
      const issueId = status.issueId || key;
      const agentSessionName = `agent-${issueId.toLowerCase()}`;

      if (!sessionExists(agentSessionName)) {
        // No agent session — nothing to recover
        continue;
      }

      // Check if agent is actively working (don't interrupt active agents)
      const isActive = await isAgentActiveInTmux(agentSessionName);
      if (isActive) {
        // Agent is still working on fixes — let it finish
        continue;
      }

      // Agent is idle with a blocked/failed status — this is a dead end
      const statusType = isReviewBlocked ? 'review blocked' : 'tests failed';
      console.log(`[deacon] Dead-end detected: ${key} (${statusType}) with idle agent ${agentSessionName}`);

      // Record cooldown before taking action
      deadEndCooldowns.set(key, now);

      // Send the agent a nudge message with the correct resubmit command
      try {
        const nudgeMessage = isReviewBlocked
          ? `The review agent found issues in your code. Check .planning/feedback/ for details, fix the issues, commit and push, then resubmit with: curl -X POST http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}/api/workspaces/${issueId}/request-review -H "Content-Type: application/json" -d '{}' — or run: pan work done ${issueId} -c "Fixed review issues"`
          : `Tests failed for your changes. Check .planning/feedback/ for details, fix the failures, commit and push, then resubmit with: curl -X POST http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}/api/workspaces/${issueId}/request-review -H "Content-Type: application/json" -d '{}' — or run: pan work done ${issueId} -c "Fixed test failures"`;

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

// Track per-agent cooldowns for first-completion nudges
const firstCompletionCooldowns = new Map<string, number>();
const FIRST_COMPLETION_IDLE_MS = 10 * 60 * 1000; // 10 minutes idle before nudging
const FIRST_COMPLETION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between nudges

/**
 * Detect work agents that finished implementation but never called "pan work done".
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

      // Skip if completion marker already exists
      const completedFile = join(AGENTS_DIR, agent.id, 'completed');
      if (existsSync(completedFile)) continue;

      // Check if agent is idle
      const runtimeState = getAgentRuntimeState(agent.id);
      if (!runtimeState || runtimeState.state !== 'idle') continue;

      // Check idle duration
      const lastActivity = new Date(runtimeState.lastActivity);
      const idleMs = now - lastActivity.getTime();
      if (idleMs < FIRST_COMPLETION_IDLE_MS) continue;

      // Verify agent is at an idle prompt (not computing/thinking)
      // Don't use isAgentActiveInTmux here — it checks last 5 lines which may
      // contain stale tool call names (e.g., "Bash(...)") from prior output.
      // Instead, check the very last line for the Claude Code idle prompt marker.
      try {
        const { stdout: lastLines } = await execAsync(
          `tmux capture-pane -t "${agent.id}" -p -S -3 2>/dev/null || echo ""`,
          { encoding: 'utf-8' }
        );
        // Check the last few non-empty lines for idle prompt indicators
        const lines = lastLines.split('\n').filter(l => l.trim().length > 0);
        const tail = lines.slice(-3).join('\n');
        // Claude Code shows "❯" prompt and "bypass permissions" status bar when idle
        const isAtPrompt = /❯/.test(tail) || /bypass permissions/.test(tail) || /Worked for/.test(tail);
        if (!isAtPrompt) continue; // Agent is actively working
      } catch {
        continue;
      }

      // Check cooldown
      const lastNudge = firstCompletionCooldowns.get(agent.id);
      if (lastNudge && (now - lastNudge) < FIRST_COMPLETION_COOLDOWN_MS) continue;

      // HARD GATE: Never nudge agents that have been through the review pipeline.
      // Check review-status.json — if ANY entry exists for this issue, the agent
      // has entered the specialist pipeline and must NOT receive a "pan work done" nudge.
      // (Dead-end detection handles agents stuck in review/test cycles.)
      const issueId = agent.issueId || agent.id.replace('agent-', '').toUpperCase();
      const issueKey = issueId.toLowerCase();
      if (existsSync(REVIEW_STATUS_FILE)) {
        try {
          const statuses = JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
          // Keys are stored in original case (e.g., "MIN-727") — check all case variants
          const hasStatus = statuses[issueKey] || statuses[issueId] || statuses[issueId.toUpperCase()];
          if (hasStatus) {
            console.log(`[deacon] First-completion gate: skipping ${agent.id} — has review status entry (readyForMerge=${hasStatus.readyForMerge ?? false})`);
            continue;
          }
        } catch { /* parse error, proceed with check */ }
      }

      // HARD GATE: Also check for review feedback files in the workspace.
      // If a feedback directory exists and is non-empty, a review agent has already
      // processed this workspace — never send a "pan work done" nudge.
      const agentStateForGate = getAgentState(agent.id);
      if (agentStateForGate?.workspace) {
        const feedbackDir = join(agentStateForGate.workspace, '.planning', 'feedback');
        if (existsSync(feedbackDir)) {
          try {
            const feedbackFiles = readdirSync(feedbackDir);
            if (feedbackFiles.length > 0) {
              console.log(`[deacon] First-completion gate: skipping ${agent.id} — has ${feedbackFiles.length} review feedback file(s) in .planning/feedback/`);
              continue;
            }
          } catch { /* can't read feedback dir */ }
        }
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

      // All heuristics passed: agent likely forgot pan work done
      const idleMinutes = Math.round(idleMs / 60000);
      console.log(`[deacon] First-completion gap detected: ${agent.id} (${issueId}) idle for ${idleMinutes}m with commits but no completion marker`);

      firstCompletionCooldowns.set(agent.id, now);

      try {
        const nudgeMessage = `You appear to have stopped working without calling "pan work done". If your implementation is complete, run this now:\n\npan work done ${issueId} -c "Implementation complete"\n\nIf you still have remaining tasks, continue working on them.`;
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

/**
 * Patrol work agent resolution fields (PAN-309).
 *
 * For each running work agent:
 * - resolution === 'done' && count >= 2: auto-complete via pan work done
 * - resolution === 'stuck' && count >= 3: send a poke message
 */
export async function patrolWorkAgentResolutions(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgents();
    const specialists = getEnabledSpecialists();
    const specialistNames = new Set(specialists.map(s => getTmuxSessionName(s.name)));

    for (const agent of agents) {
      if (!agent.id.startsWith('agent-') || specialistNames.has(agent.id)) continue;

      const runtimeState = getAgentRuntimeState(agent.id);
      if (!runtimeState?.resolution || runtimeState.resolution === 'working' || runtimeState.resolution === 'completed') continue;

      const resolution = runtimeState.resolution;
      const count = runtimeState.resolutionCount || 0;
      const issueId = (agent.issueId || agent.id.replace('agent-', '')).toUpperCase();

      if (resolution === 'done' && count >= 2) {
        // Agent was nudged twice but still hasn't called pan work done — auto-complete
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
        // Agent is stuck — send a poke to unstick it
        console.log(`[deacon] Poking stuck agent ${agent.id} (${issueId}): count=${count}`);

        try {
          const pokeMsg = `Deacon health check: you appear stuck. Please check your current task status, review any errors, and continue working. If work is complete, run: pan work done ${issueId} -c "Implementation complete"`;
          await sendKeysAsync(agent.id, pokeMsg);
          actions.push(`Deacon poked stuck agent ${agent.id} (${issueId})`);
          addLog('action', `Poked stuck agent ${issueId} (count=${count})`, undefined);
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

  addLog('info', `Patrol cycle ${state.patrolCycle} — checking ${enabled.length} specialists`, state.patrolCycle);
  console.log(`[deacon] Patrol cycle ${state.patrolCycle} - checking ${enabled.length} specialists`);

  for (const specialist of enabled) {
    const result = await checkSpecialistHealth(specialist.name, state);
    results.push(result);

    // Handle stuck specialists
    if (result.shouldForceKill) {
      addLog('warn', `${specialist.name} stuck (${result.consecutiveFailures} failures), force-killing`, state.patrolCycle);
      console.log(`[deacon] ${specialist.name} stuck (${result.consecutiveFailures} failures), force-killing`);
      const killResult = await forceKillSpecialist(specialist.name, state);
      actions.push(`Force-killed ${specialist.name}: ${killResult.message}`);

      // Auto-restart after force-kill (PAN-246: use wakeSpecialist, not initializeSpecialist)
      // Clear session ID so we get a fresh session, not a stale resume of the old context
      // Reset runtime state so queue processing doesn't think the specialist is still busy
      if (killResult.success) {
        console.log(`[deacon] Auto-restarting ${specialist.name} with fresh session...`);
        clearSessionId(specialist.name);
        const specialistSession = getTmuxSessionName(specialist.name);
        saveAgentRuntimeState(specialistSession, { state: 'idle', lastActivity: new Date().toISOString() });
        const wakeResult = await wakeSpecialist(specialist.name, '', {
          waitForReady: true,
          startIfNotRunning: true,
        });
        if (wakeResult.success) {
          actions.push(`Auto-restarted ${specialist.name}`);
          addLog('action', `Auto-restarted ${specialist.name}`, state.patrolCycle);
        } else {
          actions.push(`Failed to restart ${specialist.name}: ${wakeResult.message}`);
          addLog('error', `Failed to restart ${specialist.name}: ${wakeResult.message}`, state.patrolCycle);
        }
      }
    } else if (!result.wasRunning && !result.inCooldown) {
      // Specialist should be running but isn't - auto-start
      // PAN-246: Use wakeSpecialist instead of initializeSpecialist.
      // initializeSpecialist rejects with 'already_initialized' if session file exists
      // (even when tmux session is dead), causing an infinite retry loop.
      // wakeSpecialist handles both fresh starts and resuming dead sessions.
      // Clear session ID so we get a fresh session, not a stale resume of the old context.
      console.log(`[deacon] ${specialist.name} not running, auto-starting with fresh session...`);
      clearSessionId(specialist.name);
      const wakeResult = await wakeSpecialist(specialist.name, '', {
        waitForReady: true,
        startIfNotRunning: true,
      });
      if (wakeResult.success) {
        actions.push(`Auto-started ${specialist.name}`);
        addLog('action', `Auto-started ${specialist.name}`, state.patrolCycle);
      } else {
        actions.push(`Failed to start ${specialist.name}: ${wakeResult.message}`);
        addLog('error', `Failed to start ${specialist.name}: ${wakeResult.message}`, state.patrolCycle);
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
            // Update testStatus when deacon wakes the test-agent for a queued task
            if (specialist.name === 'test-agent' && nextTask.payload.issueId) {
              updateTestStatusToTesting(nextTask.payload.issueId);
            }
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

  // Check and auto-suspend idle agents (PAN-80, fixed in PAN-154)
  const suspendActions = await checkAndSuspendIdleAgents();
  actions.push(...suspendActions);
  for (const a of suspendActions) addLog('action', a, state.patrolCycle);

  // Check for orphaned review/test statuses (PAN-88)
  const orphanActions = await checkOrphanedReviewStatuses();
  actions.push(...orphanActions);
  for (const a of orphanActions) addLog('action', a, state.patrolCycle);

  // Detect dead-end agents: review blocked or tests failed but agent is idle
  const deadEndActions = await checkDeadEndAgents();
  actions.push(...deadEndActions);
  for (const a of deadEndActions) addLog('action', a, state.patrolCycle);

  // Safety-net: trigger merge for issues stuck in readyForMerge state (PAN-344)
  const mergeStuckActions = await checkReadyForMergeStuck();
  actions.push(...mergeStuckActions);
  for (const a of mergeStuckActions) addLog('action', a, state.patrolCycle);

  // Detect work agents that forgot to call "pan work done" (Layer 3 safety net)
  const firstCompletionActions = await checkFirstCompletionAgents();
  actions.push(...firstCompletionActions);
  for (const a of firstCompletionActions) addLog('action', a, state.patrolCycle);

  // Patrol work agent resolution fields: auto-complete done agents, poke stuck agents (PAN-309)
  const resolutionActions = await patrolWorkAgentResolutions();
  actions.push(...resolutionActions);
  for (const a of resolutionActions) addLog('action', a, state.patrolCycle);

  // Check for lazy agent behavior and auto-correct (PAN-80, fixed in PAN-154)
  const lazyActions = await checkAndCorrectLazyAgents();
  actions.push(...lazyActions);
  for (const a of lazyActions) addLog('action', a, state.patrolCycle);

  // Check for work agents stuck in extended thinking loops
  const stuckActions = await checkStuckWorkAgents();
  actions.push(...stuckActions);
  for (const a of stuckActions) addLog('action', a, state.patrolCycle);

  // Periodic agent state cleanup (PAN-154)
  if (Math.random() < 0.003) {
    const cleanupActions = await cleanupStaleAgentState();
    actions.push(...cleanupActions);
    for (const a of cleanupActions) addLog('action', a, state.patrolCycle);
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
  // Patrol only detects stuck sessions and kills them to prevent tmux leaks.
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
        }
        continue;
      }

      const runtimeState = getAgentRuntimeState(projSpec.tmuxSession);
      // A running ephemeral specialist with no runtime state, or active for more than
      // the max specialist timeout (wakeSpecialistWithTask uses 15 min), is considered stuck.
      const isStuck = runtimeState?.state === 'active' && runtimeState.lastActivity
        ? (Date.now() - new Date(runtimeState.lastActivity).getTime()) > 15 * 60 * 1000
        : false;

      if (isStuck) {
        addLog('warn', `Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing`, state.patrolCycle);
        console.log(`[deacon] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing ${projSpec.tmuxSession}`);
        try {
          await execAsync(`tmux kill-session -t "${projSpec.tmuxSession}"`);
          clearSessionId(projSpec.specialistType, projSpec.projectKey);
          saveAgentRuntimeState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date().toISOString() });
          actions.push(`Force-killed stuck per-project ${projSpec.specialistType} (${projSpec.projectKey})`);
        } catch {
          // Non-fatal — session may have already exited
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
