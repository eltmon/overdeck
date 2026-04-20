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
import { setReviewStatus, loadReviewStatuses, getReviewStatus } from '../review-status.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';

// Review status file location (same as dashboard server)
const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');


import {
  SpecialistType,
  getTmuxSessionName,
  isRunning,
  getAllProjectSpecialistStatuses,
} from './specialists.js';
import { getAgentRuntimeState, saveAgentRuntimeState, saveSessionId, listRunningAgents, getAgentDir, getAgentState, saveAgentState, resumeAgent } from '../agents.js';
import { buildTmuxCommandString, capturePaneAsync, createSessionAsync, killSession, killSessionAsync, listPaneValues, listPaneValuesAsync, listSessionNamesAsync, sessionExists, sessionExistsAsync, sendKeysAsync } from '../tmux.js';

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
  specialists: Record<SpecialistType, SpecialistHealthState>;
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
export async function checkAndSuspendIdleAgents(): Promise<string[]> {
  const actions: string[] = [];
  // Specialist sessions (global or per-project) all start with "specialist-"
  const isSpecialistSession = (id: string) => id.startsWith('specialist-');

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
    const isSpecialist = isSpecialistSession(agent.id);

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
        await killSessionAsync(agent.id).catch(() => { /* no session to kill */ });

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
    const stdout = await capturePaneAsync(sessionName, 20);

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
    await sendKeysAsync(sessionName, ANTI_LAZY_MESSAGE, 'deacon anti-lazy');

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
 * Checks the last 8 non-blank lines of pane output for status indicators.
 * Claude Code's live status bar (◆ Bash, ◆ Thinking, ⏵⏵) appears at the
 * bottom of the pane — only those lines are relevant, not the full visible
 * area which may contain completed tool calls like "● Bash(...)" from prior output.
 */
export async function isAgentActiveInTmux(sessionName: string): Promise<boolean> {
  try {
    const stdout = await capturePaneAsync(sessionName, 5);

    if (!stdout.trim()) return false;

    // Only scan the bottom of the pane where Claude Code's live status bar lives.
    // Scanning the full visible area causes false positives: completed tool calls
    // like "● Bash(npm run typecheck...)" are visible but the agent may be idle.
    const lines = stdout.split('\n').filter(l => l.trim().length > 0);
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
  } catch {
    return false;
  }
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
  // Stale-active: heartbeat hasn't fired in staleActiveThresholdMs (state='active'/'uninitialized')
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
  // Specialist sessions (global or per-project) all start with "specialist-"
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
    if (getReviewStatus(agentIssueId)?.stuck) {
      console.log(`[deacon] Skipping stuck-thinking recovery for ${agent.id} (${agentIssueId}): workspace is stuck`);
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
        await createSessionAsync(agent.id, workspace, `bash ${launcherPath}`);

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

    // Also detect ad-hoc parallel review sessions spawned by dispatchParallelReview.
    // These never register runtime state, so they're invisible to the specialist checks above.
    try {
      const { listSessionNamesAsync } = await import('../tmux.js');
      const { getActiveParallelReviewIssues } = await import('./review-agent.js');
      const allSessions = await listSessionNamesAsync();
      for (const issueId of getActiveParallelReviewIssues(allSessions)) {
        activeReviewSessions.add(issueId);
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
          // Use setReviewStatus (not direct JSON write) so SQLite is updated too
          setReviewStatus(issueId, { reviewStatus: 'pending' });
          status.reviewStatus = 'pending';
          actions.push(`Reset orphaned review for ${issueId} (no review-agent active for this issue)`);
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
        // Check completed.processed marker
        const agentIdForCheck = `agent-${issueId.toLowerCase()}`;
        const completedProcessedFile = join(AGENTS_DIR, agentIdForCheck, 'completed.processed');
        if (existsSync(completedProcessedFile)) {
          const agentState = getAgentState(agentIdForCheck) as (ReturnType<typeof getAgentState> & { stoppedByUser?: boolean }) | null;
          if (agentState?.status === 'stopped' && agentState.stoppedByUser) {
            actions.push(`Skipped pending review for ${issueId}: work agent was explicitly stopped`);
            continue;
          }
          const { resolveProjectFromIssue } = await import('../projects.js');
          const resolved = resolveProjectFromIssue(issueId);
          const issueLower = issueId.toLowerCase();
          const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

          if (workspace && resolved) {
            const branch = `feature/${issueLower}`;
            const { dispatchParallelReview } = await import('./review-agent.js');
            try {
              await dispatchParallelReview({ issueId, workspace, branch });
              // dispatchParallelReview sets reviewStatus='reviewing' internally;
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

        // Re-dispatch using per-project ephemeral specialist (no queue fallback)
        const agentId = `agent-${issueId.toLowerCase()}`;
        const agentState = getAgentState(agentId);
        const { resolveProjectFromIssue } = await import('../projects.js');
        const resolved = resolveProjectFromIssue(issueId);
        const issueLower = issueId.toLowerCase();
        const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

        if (workspace && resolved) {
          const branch = `feature/${issueLower}`;
          const { spawnEphemeralSpecialist } = await import('./specialists.js');
          const result = await spawnEphemeralSpecialist(resolved.projectKey, 'test-agent', {
            issueId,
            workspace,
            branch,
          });
          if (result.success) {
            setReviewStatus(issueId, { testStatus: 'testing' });
            status.testStatus = 'testing';
            actions.push(
              `Re-dispatched orphaned test for ${issueId} via ${resolved.projectKey}/test-agent (deacon-orphan-recovery)`,
            );
            console.log(
              `[deacon] Re-dispatched test for ${issueId} after orphan detection (project: ${resolved.projectKey}, workspace: ${workspace})`,
            );
          } else if (result.error === 'specialist_busy') {
            // Specialist busy — set dispatch_failed so deacon retries next patrol
            setReviewStatus(issueId, { testStatus: 'dispatch_failed' });
            status.testStatus = 'dispatch_failed';
            actions.push(
              `Orphaned test for ${issueId}: specialist busy — set dispatch_failed for next patrol retry`,
            );
            console.log(
              `[deacon] Specialist busy for ${issueId} — set dispatch_failed for next patrol retry`,
            );
          } else {
            setReviewStatus(issueId, { testStatus: 'dispatch_failed' });
            status.testStatus = 'dispatch_failed';
            actions.push(
              `Orphaned test re-dispatch failed for ${issueId}: ${result.error || result.message}`,
            );
            console.log(
              `[deacon] Orphaned test re-dispatch failed for ${issueId}: ${result.error || result.message}`,
            );
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

      // HEAD moved — new commits since review. Reset review pipeline.
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
      });
      // Also clear the CI transient retry counter so the next merge attempt
      // starts fresh. Without this, ciRetryMap retains count=6 from the previous
      // CI failure cycle, permanently blocking transient retries for this issue.
      ciRetryMap.delete(issueId);
      actions.push(
        `Reset review for ${issueId}: new commits after review passed ` +
        `(${status.reviewedAtCommit.substring(0, 8)} → ${currentHead.substring(0, 8)})`,
      );
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

/**
 * Register a callback that deacon will call when it detects an orphaned agent
 * and resets it to stopped. The server layer uses this to emit an agent.stopped
 * domain event so the read model and frontend update in real-time.
 */
export function setAgentStoppedNotifier(fn: (agentId: string) => void): void {
  agentStoppedNotifier = fn;
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
    if (!existsSync(REVIEW_STATUS_FILE)) return actions;

    const content = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    const statuses: Record<string, {
      issueId?: string;
      reviewStatus?: string;
      testStatus?: string;
      mergeStatus?: string;
      mergeNotes?: string;
      readyForMerge?: boolean;
      mergeRetryCount?: number;
      updatedAt?: string;
    }> = JSON.parse(content);

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
            await writeFeedbackFile({
              issueId,
              specialist: 'merge-agent',
              outcome: 'ci-failure',
              summary: 'CI checks still failing after 5 transient retries — merge blocked',
              markdownBody: `## CI Check Failure — Merge Blocked\n\n${ciNotes}\n\n### Action Required\n\nFix the failing CI checks, commit, and push. Panopticon will detect the new commits and re-run the review pipeline automatically.\n\nAlternatively:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
            }).catch((err: Error) => console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message));
            const agentSession = `agent-${issueId.toLowerCase()}`;
            if (sessionExists(agentSession)) {
              await sendKeysAsync(agentSession,
                `CI checks are failing on the PR after 5 retries. Read .planning/feedback/ for details, fix the failures, commit, then run: pan done ${issueId}`
              );
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
        await writeFeedbackFile({
          issueId,
          specialist: 'merge-agent',
          outcome: 'ci-failure',
          summary: 'CI checks failed at merge — re-submit to re-enter merge queue',
          markdownBody: `## CI Check Failure\n\n${ciNotes}\n\nCI checks failed at merge time. This may be transient (pending checks, GitHub status lag). Re-submit to re-enter the merge queue:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
        }).catch((err: Error) => console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err.message));
        const agentSessionCi = `agent-${issueId.toLowerCase()}`;
        if (sessionExists(agentSessionCi)) {
          await sendKeysAsync(agentSessionCi,
            `CI checks failed on the PR for ${issueId}. This may be transient. Read .planning/feedback/ for details, fix any failures, commit, then run: pan done ${issueId}`
          );
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
 * Remove stale CI-failure feedback files from a workspace's .planning/feedback/ dir.
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
  const candidateFeedbackDir = join(repoDir, 'workspaces', `feature-${issueLower}`, '.planning', 'feedback');

  try {
    if (!existsSync(candidateFeedbackDir)) return;
    const files = await readdir(candidateFeedbackDir);
    for (const file of files) {
      if (file.includes('merge-agent') && file.includes('ci-failure') && file.endsWith('.md')) {
        await rm(join(candidateFeedbackDir, file));
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
      mergeNotes?: string;
      mergeRetryCount?: number;
      updatedAt?: string;
      autoRequeueCount?: number;
      history?: Array<{ type: string; status: string; timestamp?: string }>;
    }> = JSON.parse(content);

    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on blocked/failed reviews, failed tests, or CI-blocked merges.
      // 'failed' covers verification gate errors (e.g. JSON parse error in plan.vbrief.json)
      // that prevent the review specialist from running at all.
      const isReviewBlocked = status.reviewStatus === 'blocked' || status.reviewStatus === 'failed';
      const isTestFailed = status.testStatus === 'failed';
      const isMergeCiFailed = status.mergeStatus === 'failed' &&
        typeof status.mergeNotes === 'string' &&
        status.mergeNotes.includes('failing required checks');
      if (!isReviewBlocked && !isTestFailed && !isMergeCiFailed) continue;

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

      // CI-blocked merges have their own retry circuit breaker in checkFailedMergeRetry().
      // Once that counter is saturated, only a new commit should reset the merge path.
      if (isMergeCiFailed && (status.mergeRetryCount || 0) >= FAILED_MERGE_MAX_RETRIES) {
        console.log(`[deacon] Dead-end detected for ${key} but merge retry ceiling is saturated (${status.mergeRetryCount}/${FAILED_MERGE_MAX_RETRIES})`);
        continue;
      }

      // Check if the work agent exists and is idle
      const issueId = status.issueId || key;
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

      // Send the agent a nudge message with the correct resubmit command
      try {
        const nudgeMessage = status.reviewStatus === 'failed'
          ? `Review verification failed for ${issueId}. Check .planning/feedback/ for details. Common cause: merge conflict markers in .planning/plan.vbrief.json — fix by resolving conflicts in that file, then run: pan review request ${issueId} -m "Fixed verification error"`
          : isReviewBlocked
            ? `The review agent found issues in your code. Read .planning/feedback/ for the latest blocked feedback, fix every issue listed, commit all changes, then run: pan review request ${issueId} -m "Fixed review issues". Do NOT stop until pan review request completes successfully.`
            : `Tests failed for your changes. Read .planning/feedback/ for details, fix the failures, commit, then run: pan review request ${issueId} -m "Fixed test failures". Do NOT stop until pan review request completes successfully.`;

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
 * - resolution === 'done' && count >= 2: auto-complete via pan work done
 * - resolution === 'stuck' && count >= 3: send a poke (rate-limited, capped — PAN-650)
 */
export async function patrolWorkAgentResolutions(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgents();
    // Specialist sessions (global or per-project) all start with "specialist-"
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
      if (getReviewStatus(issueId)?.stuck) {
        console.log(`[deacon] Skipping stuck workspace ${issueId} in patrolWorkAgentResolutions`);
        continue;
      }

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
          const pokeMsg = `Deacon health check (${pokeState.pokes + 1}/${STUCK_POKE_MAX}): you appear stuck. Please check your current task status, review any errors, and continue working. If work is complete, run: pan work done ${issueId} -c "Implementation complete"`;
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
    const safePids = pids.filter(p => !protectedPids.has(p));

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

  // Kill orphaned planning sessions whose issue has already progressed past planning.
  // PAN-682 pattern: `planning-pan-<id>` tmux session survives hours after `complete-planning`
  // because either (a) `skipKill=true` was set or (b) complete-planning was never invoked
  // (work agent was started via a different path). If the corresponding work agent session
  // `agent-pan-<id>` is alive, planning is definitively over — kill the planning session.
  const planningCleanupActions = await cleanupOrphanedPlanningSessions();
  actions.push(...planningCleanupActions);
  for (const a of planningCleanupActions) addLog('action', a, state.patrolCycle);

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

  // Safety-net: trigger merge for issues stuck in readyForMerge state (PAN-344)
  const mergeStuckActions = await checkReadyForMergeStuck();
  actions.push(...mergeStuckActions);
  for (const a of mergeStuckActions) addLog('action', a, state.patrolCycle);

  // Auto-retry merges that failed due to transient post-rebase verification failures
  const failedMergeRetryActions = await checkFailedMergeRetry();
  actions.push(...failedMergeRetryActions);
  for (const a of failedMergeRetryActions) addLog('action', a, state.patrolCycle);

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
      // the max specialist timeout (wakeSpecialistWithTask uses 15 min), is considered stuck.
      const isStuck = runtimeState?.state === 'active' && runtimeState.lastActivity
        ? (Date.now() - new Date(runtimeState.lastActivity).getTime()) > 15 * 60 * 1000
        : false;

      if (isStuck) {
        addLog('warn', `Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing`, state.patrolCycle);
        console.log(`[deacon] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing ${projSpec.tmuxSession}`);
        try {
          await killSessionAsync(projSpec.tmuxSession);
          // Do NOT clearSessionId — the Claude session still exists in storage
          // and should be resumed on next dispatch. Clearing causes --session-id
          // "already in use" errors.
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
/**
 * On startup, detect agents whose state.json claims 'running' or 'starting' but have
 * no live tmux session — this happens after a system crash where tmux was killed but
 * state.json was never updated. Reset them to 'stopped' so resume/re-plan works correctly.
 */
async function recoverOrphanedAgents(context?: string): Promise<string[]> {
  if (!existsSync(AGENTS_DIR)) return [];
  let dirs: string[];
  try { dirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-') || d.startsWith('planning-')); }
  catch { return []; }

  const actions: string[] = [];
  for (const dir of dirs) {
    const stateFile = join(AGENTS_DIR, dir, 'state.json');
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (state.status !== 'running' && state.status !== 'starting') continue;
      if (sessionExists(dir)) {
        // Planning sessions use remain-on-exit, so the tmux session persists after
        // Claude exits. Check if the pane's process is actually dead.
        if (dir.startsWith('planning-')) {
          try {
            const result = (await listPaneValuesAsync(dir, '#{pane_dead}'))[0]?.trim() ?? '';
            if (result !== '1') continue; // pane is alive — truly still running
            // Pane is dead — kill the zombie tmux session and fall through to recovery
            try { await killSessionAsync(dir); } catch { /* ignore */ }
          } catch {
            continue; // can't check — assume alive
          }
        } else {
          continue; // truly still running
        }
      }
      // Orphaned — crashed agent with no tmux session
      const oldStatus = state.status;
      state.status = 'stopped';
      state.stoppedAt = new Date().toISOString();
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      const msg = `Recovered orphaned agent ${dir} (${oldStatus}→stopped)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
      // Notify server layer so the read model and frontend update
      if (agentStoppedNotifier) {
        try { agentStoppedNotifier(dir); } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }
  if (actions.length > 0 && context) {
    console.log(`[deacon] ${context}: ${actions.length} orphaned agent(s) reset to stopped`);
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

  for (const planningSession of planningSessions) {
    // planning-pan-596 → agent-pan-596
    const workAgentSession = planningSession.replace(/^planning-/, 'agent-');
    if (!sessionExists(workAgentSession)) continue;

    try {
      await killSessionAsync(planningSession).catch(() => {});
    } catch { /* non-fatal */ }

    // Mark planning agent state as stopped so the UI doesn't show a "running" pill.
    try {
      const stateFile = join(AGENTS_DIR, planningSession, 'state.json');
      if (existsSync(stateFile)) {
        const agentState = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (agentState.status === 'running' || agentState.status === 'starting') {
          agentState.status = 'stopped';
          agentState.stoppedAt = new Date().toISOString();
          writeFileSync(stateFile, JSON.stringify(agentState, null, 2));
          if (agentStoppedNotifier) {
            try { agentStoppedNotifier(planningSession); } catch { /* non-fatal */ }
          }
        }
      }
    } catch { /* non-fatal */ }

    const msg = `Killed orphaned ${planningSession} (work agent ${workAgentSession} is running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
  }

  return actions;
}

/**
 * Auto-resume work agents that were stopped by a system crash/reboot
 * but still have incomplete work. Scans all agent state directories for
 * stopped implementation-phase agents and resumes them if they were not
 * deliberately stopped by a user (detected via runtime.state === 'stopped').
 */
async function autoResumeStoppedWorkAgents(): Promise<string[]> {
  const resumed: string[] = [];
  if (!existsSync(AGENTS_DIR)) return resumed;

  let dirs: string[];
  try {
    dirs = readdirSync(AGENTS_DIR).filter(d => d.startsWith('agent-'));
  } catch { return resumed; }

  for (const agentId of dirs) {
    const state = getAgentState(agentId);
    if (!state) continue;
    if (state.status !== 'stopped') continue;
    if (state.phase !== 'implementation') continue;

    // Skip if the agent has a completed marker (or processed completion) — unless
    // review or test found issues that need fixing (blocked / failed).
    const completedFile = join(getAgentDir(agentId), 'completed');
    const processedFile = join(getAgentDir(agentId), 'completed.processed');
    if (existsSync(completedFile) || existsSync(processedFile)) {
      const review = getReviewStatus(state.issueId);
      if (
        review?.reviewStatus === 'blocked' ||
        review?.reviewStatus === 'failed' ||
        review?.testStatus === 'failed'
      ) {
        // Agent needs to fix review/test issues — resume it
      } else {
        continue;
      }
    }

    // Skip if workspace is missing
    if (!state.workspace || !existsSync(state.workspace)) continue;

    // Skip if already merge-ready (review+test passed) or already merged
    const review = getReviewStatus(state.issueId);
    if (review?.readyForMerge && review.reviewStatus === 'passed' && review.testStatus === 'passed') continue;
    if (review?.mergeStatus === 'merged') continue;

    // Skip if the agent was deliberately stopped by a user (runtime state is 'stopped')
    const runtimeState = getAgentRuntimeState(agentId);
    if (runtimeState?.state === 'stopped' || runtimeState?.state === 'idle') continue;

    try {
      const result = await resumeAgent(agentId);
      if (result.success) {
        resumed.push(agentId);
        console.log(`[deacon] Auto-resumed ${agentId} (was orphaned by system event)`);
      } else {
        console.warn(`[deacon] Failed to auto-resume ${agentId}: ${result.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[deacon] Auto-resume error for ${agentId}: ${msg}`);
    }
  }
  if (resumed.length > 0) {
    console.log(`[deacon] Auto-resumed ${resumed.length} work agent(s): ${resumed.join(', ')}`);
  }
  return resumed;
}

export function startDeacon(): void {
  if (deaconInterval) {
    console.log('[deacon] Already running');
    return;
  }

  config = loadConfig();
  console.log(`[deacon] Starting health monitor (patrol every ${config.patrolIntervalMs / 1000}s)`);

  // Recover agents whose tmux sessions were killed by a system crash
  recoverOrphanedAgents('Startup recovery').catch((err) => console.error('[deacon] Startup recovery error:', err));

  // Auto-resume work agents that were stopped by a crash/reboot
  void autoResumeStoppedWorkAgents();

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
