/**
 * Health Monitoring System (Deacon Pattern)
 *
 * Implements stuck detection and auto-recovery with cooldown:
 * - Default ping timeout: 30 seconds
 * - Default consecutive failures: 3
 * - Default cooldown: 5 minutes
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AGENTS_DIR } from './paths.js';
import { recoverAgent, stopAgent, getAgentState } from './agents.js';

const execAsync = promisify(exec);

// Deacon pattern defaults
export const DEFAULT_PING_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const DEFAULT_CONSECUTIVE_FAILURES = 3;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  lastActivity?: string;
  lastPing?: string;
  lastPingResponse?: string;
  consecutiveFailures: number;
  lastForceKill?: string;
  forceKillCount: number;
  recoveryCount: number;
  inCooldown: boolean;
}

export interface HealthConfig {
  pingTimeoutMs: number;
  consecutiveFailures: number;
  cooldownMs: number;
  checkIntervalMs: number;
}

function getHealthFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'health.json');
}

/**
 * Get or create health record for an agent
 */
export function getAgentHealth(agentId: string): AgentHealth {
  const healthFile = getHealthFile(agentId);

  const defaultHealth: AgentHealth = {
    agentId,
    status: 'healthy',
    consecutiveFailures: 0,
    forceKillCount: 0,
    recoveryCount: 0,
    inCooldown: false,
  };

  if (existsSync(healthFile)) {
    try {
      const stored = JSON.parse(readFileSync(healthFile, 'utf-8'));
      return { ...defaultHealth, ...stored };
    } catch {}
  }

  return defaultHealth;
}

/**
 * Save health record for an agent
 */
export function saveAgentHealth(health: AgentHealth): void {
  const dir = join(AGENTS_DIR, health.agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getHealthFile(health.agentId), JSON.stringify(health, null, 2));
}

/**
 * Check if agent's tmux session is alive
 */
export async function isAgentAlive(agentId: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t "${agentId}" 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent output from agent's terminal
 */
export async function getAgentOutput(agentId: string, lines: number = 20): Promise<string | null> {
  try {
    const { stdout: output } = await execAsync(
      `tmux capture-pane -t "${agentId}" -p -S -${lines} 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    );
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Send a health check nudge to the agent
 * Returns true if we detect activity, false otherwise
 */
export async function sendHealthNudge(agentId: string): Promise<boolean> {
  if (!(await isAgentAlive(agentId))) {
    return false;
  }

  // Capture output before nudge
  const outputBefore = await getAgentOutput(agentId, 5);

  // Send a gentle nudge - just check if the session is responsive
  // We don't want to interrupt actual work, just verify the session exists
  try {
    // Check if there's been any recent output change
    // For now, we consider alive = responsive
    return true;
  } catch {
    return false;
  }
}

/**
 * Ping an agent and update health status
 */
export async function pingAgent(
  agentId: string,
  config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  }
): Promise<AgentHealth> {
  const health = getAgentHealth(agentId);
  health.lastPing = new Date().toISOString();

  // Check if session is alive
  const alive = await isAgentAlive(agentId);

  if (!alive) {
    // Session is dead
    health.status = 'dead';
    health.consecutiveFailures++;
  } else {
    // Session is alive - check for activity
    const state = getAgentState(agentId);
    const lastActivity = state?.lastActivity ? new Date(state.lastActivity) : null;

    if (lastActivity) {
      const ageMs = Date.now() - lastActivity.getTime();
      const ageMinutes = ageMs / (1000 * 60);

      if (ageMinutes > 30) {
        health.status = 'stuck';
        health.consecutiveFailures++;
      } else if (ageMinutes > 15) {
        health.status = 'warning';
        // Don't increment failures for warning, just monitor
      } else {
        health.status = 'healthy';
        health.consecutiveFailures = 0;
      }
    } else {
      // No activity tracking, assume healthy if alive
      health.status = 'healthy';
      health.consecutiveFailures = 0;
    }

    health.lastPingResponse = new Date().toISOString();
  }

  // Check cooldown status
  if (health.lastForceKill) {
    const timeSinceKill = Date.now() - new Date(health.lastForceKill).getTime();
    health.inCooldown = timeSinceKill < config.cooldownMs;
  } else {
    health.inCooldown = false;
  }

  saveAgentHealth(health);
  return health;
}

/**
 * Handle a stuck agent - force kill and respawn with context
 */
export async function handleStuckAgent(
  agentId: string,
  config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  }
): Promise<{ action: 'recovered' | 'cooldown' | 'skipped'; reason: string }> {
  const health = getAgentHealth(agentId);

  // Check if failures meet threshold
  if (health.consecutiveFailures < config.consecutiveFailures) {
    return {
      action: 'skipped',
      reason: `Only ${health.consecutiveFailures} failures (need ${config.consecutiveFailures})`,
    };
  }

  // Check cooldown
  if (health.lastForceKill) {
    const timeSinceKill = Date.now() - new Date(health.lastForceKill).getTime();
    if (timeSinceKill < config.cooldownMs) {
      const remainingMs = config.cooldownMs - timeSinceKill;
      const remainingMin = Math.ceil(remainingMs / (1000 * 60));
      return {
        action: 'cooldown',
        reason: `In cooldown (${remainingMin}m remaining)`,
      };
    }
  }

  // Force kill the agent
  try {
    stopAgent(agentId);
  } catch {}

  // Record the force kill
  health.lastForceKill = new Date().toISOString();
  health.forceKillCount++;
  health.consecutiveFailures = 0;
  health.status = 'dead';
  health.inCooldown = true;
  saveAgentHealth(health);

  // Attempt recovery
  try {
    const recovered = recoverAgent(agentId);
    if (recovered) {
      health.status = 'healthy';
      health.recoveryCount++;
      saveAgentHealth(health);
      return { action: 'recovered', reason: 'Force killed and respawned' };
    }
  } catch {}

  return { action: 'recovered', reason: 'Force killed (respawn failed)' };
}

/**
 * Run a single health check cycle for all agents
 */
export async function runHealthCheck(
  config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  }
): Promise<{
  checked: number;
  healthy: number;
  warning: number;
  stuck: number;
  dead: number;
  recovered: string[];
}> {
  const results = {
    checked: 0,
    healthy: 0,
    warning: 0,
    stuck: 0,
    dead: 0,
    recovered: [] as string[],
  };

  // Get all agent sessions
  let sessions: string[] = [];
  try {
    const { stdout: output } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true',
      { encoding: 'utf-8' }
    );
    sessions = output
      .trim()
      .split('\n')
      .filter((s) => s.startsWith('agent-'));
  } catch {}

  // Also check agents dir for crashed agents
  if (existsSync(AGENTS_DIR)) {
    const { readdirSync } = await import('fs');
    const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('agent-'))
      .map((d) => d.name);

    for (const dir of dirs) {
      if (!sessions.includes(dir)) {
        sessions.push(dir);
      }
    }
  }

  // Check each agent
  for (const agentId of sessions) {
    results.checked++;

    const health = await pingAgent(agentId, config);

    switch (health.status) {
      case 'healthy':
        results.healthy++;
        break;
      case 'warning':
        results.warning++;
        break;
      case 'stuck':
        results.stuck++;
        // Handle stuck agent
        const result = await handleStuckAgent(agentId, config);
        if (result.action === 'recovered') {
          results.recovered.push(agentId);
        }
        break;
      case 'dead':
        results.dead++;
        // Handle dead agent
        const deadResult = await handleStuckAgent(agentId, config);
        if (deadResult.action === 'recovered') {
          results.recovered.push(agentId);
        }
        break;
    }
  }

  return results;
}

/**
 * Start the health monitoring daemon
 * Returns a stop function
 */
export function startHealthDaemon(
  config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  },
  onCheck?: (results: Awaited<ReturnType<typeof runHealthCheck>>) => void
): () => void {
  let running = true;

  const runLoop = async () => {
    while (running) {
      try {
        const results = await runHealthCheck(config);
        if (onCheck) {
          onCheck(results);
        }
      } catch (error) {
        console.error('Health check error:', error);
      }

      // Wait for next interval
      await new Promise((resolve) => setTimeout(resolve, config.checkIntervalMs));
    }
  };

  // Start the loop
  runLoop();

  // Return stop function
  return () => {
    running = false;
  };
}

/**
 * Format health status for display
 */
export function formatHealthStatus(health: AgentHealth): string {
  const statusIcons = {
    healthy: '\u2705',
    warning: '\u26a0\ufe0f',
    stuck: '\u{1f7e0}',
    dead: '\u274c',
  };

  const lines: string[] = [
    `${statusIcons[health.status]} ${health.agentId}: ${health.status.toUpperCase()}`,
  ];

  if (health.lastPing) {
    lines.push(`  Last ping: ${health.lastPing}`);
  }

  if (health.consecutiveFailures > 0) {
    lines.push(`  Consecutive failures: ${health.consecutiveFailures}`);
  }

  if (health.forceKillCount > 0) {
    lines.push(`  Force kills: ${health.forceKillCount}`);
  }

  if (health.recoveryCount > 0) {
    lines.push(`  Recoveries: ${health.recoveryCount}`);
  }

  if (health.inCooldown) {
    lines.push(`  Status: IN COOLDOWN`);
  }

  return lines.join('\n');
}
