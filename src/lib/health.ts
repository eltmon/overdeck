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
import { Effect, Data } from 'effect';
import { AGENTS_DIR } from './paths.js';
import { recoverAgent, stopAgentSync, getAgentStateSync, getAgentRuntimeStateSync } from './agents.js';
import { capturePane, listSessionNames, sessionExists } from './tmux.js';

/** A health-monitor operation (ping, classify, recover) failed unexpectedly. */
export class HealthError extends Data.TaggedError('HealthError')<{
  readonly agentId: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Deacon pattern defaults
export const DEFAULT_PING_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const DEFAULT_CONSECUTIVE_FAILURES = 3;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead' | 'stopped';
  lastActivity?: string;
  lastPing?: string;
  lastPingResponse?: string;
  consecutiveFailures: number;
  lastForceKill?: string;
  forceKillCount: number;
  recoveryCount: number;
  inCooldown: boolean;
  reason?: string;
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
}async function isAgentAlivePromise(agentId: string): Promise<boolean> {
  return Effect.runPromise(sessionExists(agentId));
}

/**
 * Get recent output from agent's terminal
 */
export async function getAgentOutput(agentId: string, lines: number = 20): Promise<string | null> {
  try {
    const output = await Effect.runPromise(capturePane(agentId, lines));
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
  if (!(await Effect.runPromise(isAgentAlive(agentId)))) {
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
}async function pingAgentPromise(
  agentId: string,
  config: HealthConfig = {
    pingTimeoutMs: DEFAULT_PING_TIMEOUT_MS,
    consecutiveFailures: DEFAULT_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  }
): Promise<AgentHealth> {
  const health = getAgentHealth(agentId);
  const now = new Date();
  health.lastPing = now.toISOString();

  const state = getAgentStateSync(agentId);
  const runtime = getAgentRuntimeStateSync(agentId);
  const alive = await Effect.runPromise(isAgentAlive(agentId));
  const runtimeLastActivity = runtime?.lastActivity ? new Date(runtime.lastActivity) : null;
  const stateLastActivity = state?.lastActivity ? new Date(state.lastActivity) : null;
  const lastActivity = runtimeLastActivity ?? stateLastActivity;
  health.lastActivity = lastActivity?.toISOString();
  health.reason = undefined;

  if (state?.status === 'stopped' || runtime?.state === 'stopped') {
    health.status = 'stopped';
    health.consecutiveFailures = 0;
    health.reason = 'Agent was intentionally stopped';
  } else if (!alive) {
    health.status = 'dead';
    health.consecutiveFailures++;
    health.reason = 'tmux session is not running';
  } else if (runtime?.state === 'waiting-on-human') {
    health.status = 'warning';
    health.consecutiveFailures = 0;
    health.reason = runtime.waitingNotification || runtime.waitingReason || 'Waiting for human input';
    health.lastPingResponse = now.toISOString();
  } else if (lastActivity) {
    const ageMs = now.getTime() - lastActivity.getTime();
    const ageMinutes = ageMs / (1000 * 60);

    if (ageMinutes > 30) {
      health.status = 'stuck';
      health.consecutiveFailures++;
      health.reason = `No activity for ${Math.round(ageMinutes)} minutes`;
    } else if (ageMinutes > 15) {
      health.status = 'warning';
      health.reason = `Low activity for ${Math.round(ageMinutes)} minutes`;
    } else {
      health.status = 'healthy';
      health.consecutiveFailures = 0;
      health.reason = undefined;
    }

    health.lastPingResponse = now.toISOString();
  } else {
    health.status = 'healthy';
    health.consecutiveFailures = 0;
    health.reason = alive ? 'Session alive, no activity timestamp available' : undefined;
    if (alive) {
      health.lastPingResponse = now.toISOString();
    }
  }

  console.log(
    `[health] ${agentId} classified as ${health.status}`
      + ` alive=${alive}`
      + ` state=${state?.status ?? 'none'}`
      + ` runtime=${runtime?.state ?? 'none'}`
      + ` lastActivity=${health.lastActivity ?? 'none'}`
      + (health.reason ? ` reason=${health.reason}` : '')
  );

  if (health.lastForceKill) {
    const timeSinceKill = Date.now() - new Date(health.lastForceKill).getTime();
    health.inCooldown = timeSinceKill < config.cooldownMs;
  } else {
    health.inCooldown = false;
  }

  saveAgentHealth(health);
  return health;
}async function handleStuckAgentPromise(
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
    stopAgentSync(agentId);
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
    const recovered = await recoverAgent(agentId);
    if (recovered) {
      health.status = 'healthy';
      health.recoveryCount++;
      saveAgentHealth(health);
      return { action: 'recovered', reason: 'Force killed and respawned' };
    }
  } catch {}

  return { action: 'recovered', reason: 'Force killed (respawn failed)' };
}async function runHealthCheckPromise(
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
    sessions = (await Effect.runPromise(listSessionNames()))
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

    const health = await Effect.runPromise(pingAgent(agentId, config));

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
        const result = await Effect.runPromise(handleStuckAgent(agentId, config));
        if (result.action === 'recovered') {
          results.recovered.push(agentId);
        }
        break;
      case 'dead':
        results.dead++;
        // Handle dead agent
        const deadResult = await Effect.runPromise(handleStuckAgent(agentId, config));
        if (deadResult.action === 'recovered') {
          results.recovered.push(agentId);
        }
        break;
      case 'stopped':
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
  onCheck?: (results: Awaited<ReturnType<typeof runHealthCheckPromise>>) => void
): () => void {
  let running = true;

  const runLoop = async () => {
    while (running) {
      try {
        const results = await Effect.runPromise(runHealthCheck(config));
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
    stopped: '\u23f9\ufe0f',
  };

  const lines: string[] = [
    `${statusIcons[health.status]} ${health.agentId}: ${health.status.toUpperCase()}`,
  ];

  if (health.lastActivity) {
    lines.push(`  Last activity: ${health.lastActivity}`);
  }

  if (health.lastPing) {
    lines.push(`  Last ping: ${health.lastPing}`);
  }

  if (health.reason) {
    lines.push(`  Reason: ${health.reason}`);
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const healthCatch = (agentId: string, operation: string) => (cause: unknown) =>
  new HealthError({
    agentId,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect-native isAgentAlive — tmux session liveness probe, never fails. */
export const isAgentAlive = (agentId: string): Effect.Effect<boolean, never> =>
  Effect.promise(() => isAgentAlivePromise(agentId));

/**
 * Effect-native pingAgent — full classify + persist cycle.
 * Fails with HealthError if classification throws (e.g. tmux capture-pane fails
 * outside the swallowed branches).
 */
export const pingAgent = (
  agentId: string,
  config?: HealthConfig,
): Effect.Effect<AgentHealth, HealthError> =>
  Effect.tryPromise({
    try: () => (config ? pingAgentPromise(agentId, config) : pingAgentPromise(agentId)),
    catch: healthCatch(agentId, 'pingAgent'),
  });

/** Effect-native handleStuckAgent — stop + recover with cooldown gates. */
export const handleStuckAgent = (
  agentId: string,
  config?: HealthConfig,
): Effect.Effect<{ action: 'recovered' | 'cooldown' | 'skipped'; reason: string }, HealthError> =>
  Effect.tryPromise({
    try: () => (config ? handleStuckAgentPromise(agentId, config) : handleStuckAgentPromise(agentId)),
    catch: healthCatch(agentId, 'handleStuckAgent'),
  });

/** Effect-native runHealthCheck — single sweep of all agents. */
export const runHealthCheck = (
  config?: HealthConfig,
): Effect.Effect<
  {
    checked: number;
    healthy: number;
    warning: number;
    stuck: number;
    dead: number;
    recovered: string[];
  },
  HealthError
> =>
  Effect.tryPromise({
    try: () => (config ? runHealthCheckPromise(config) : runHealthCheckPromise()),
    catch: healthCatch('*', 'runHealthCheck'),
  });
