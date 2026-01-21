/**
 * Cloister Health Evaluator
 *
 * Evaluates agent health based on heartbeats and activity timestamps.
 */

import type { HealthState, Heartbeat, AgentRuntime } from '../runtimes/types.js';
import type { HealthThresholds } from './config.js';
import { getHealthThresholdsMs } from './config.js';

/**
 * Agent health status
 */
export interface AgentHealth {
  agentId: string;
  state: HealthState;
  lastActivity: Date | null;
  timeSinceActivity: number | null; // milliseconds
  heartbeat: Heartbeat | null;
  isRunning: boolean;
}

/**
 * Health summary for all agents
 */
export interface HealthSummary {
  active: number;
  stale: number;
  warning: number;
  stuck: number;
  total: number;
}

/**
 * Evaluate health state based on time since last activity
 *
 * @param timeSinceActivityMs - Milliseconds since last activity
 * @param thresholds - Health thresholds in milliseconds
 * @returns Health state
 */
export function evaluateHealthState(
  timeSinceActivityMs: number,
  thresholds: { stale: number; warning: number; stuck: number }
): HealthState {
  if (timeSinceActivityMs < thresholds.stale) {
    return 'active';
  } else if (timeSinceActivityMs < thresholds.warning) {
    return 'stale';
  } else if (timeSinceActivityMs < thresholds.stuck) {
    return 'warning';
  } else {
    return 'stuck';
  }
}

/**
 * Get health status for a single agent
 *
 * @param agentId - Agent identifier
 * @param runtime - Runtime to query for heartbeat
 * @param thresholds - Health thresholds (optional, uses config if not provided)
 * @returns Agent health status
 */
export function getAgentHealth(
  agentId: string,
  runtime: AgentRuntime,
  thresholds?: { stale: number; warning: number; stuck: number }
): AgentHealth {
  const thresholdsMs = thresholds || getHealthThresholdsMs();

  // Check if agent is running
  const isRunning = runtime.isRunning(agentId);

  if (!isRunning) {
    return {
      agentId,
      state: 'stuck',
      lastActivity: null,
      timeSinceActivity: null,
      heartbeat: null,
      isRunning: false,
    };
  }

  // Get heartbeat
  const heartbeat = runtime.getHeartbeat(agentId);

  if (!heartbeat) {
    // No heartbeat available - agent might be starting up
    return {
      agentId,
      state: 'active', // Assume active if no heartbeat yet
      lastActivity: null,
      timeSinceActivity: null,
      heartbeat: null,
      isRunning: true,
    };
  }

  // Calculate time since last activity
  const now = new Date();
  const timeSinceActivity = now.getTime() - heartbeat.timestamp.getTime();

  // Evaluate health state
  const state = evaluateHealthState(timeSinceActivity, thresholdsMs);

  return {
    agentId,
    state,
    lastActivity: heartbeat.timestamp,
    timeSinceActivity,
    heartbeat,
    isRunning: true,
  };
}

/**
 * Get health status for multiple agents
 *
 * @param agentIds - Array of agent identifiers
 * @param runtime - Runtime to query for heartbeats
 * @param thresholds - Health thresholds (optional, uses config if not provided)
 * @returns Array of agent health statuses
 */
export function getMultipleAgentHealth(
  agentIds: string[],
  runtime: AgentRuntime,
  thresholds?: { stale: number; warning: number; stuck: number }
): AgentHealth[] {
  return agentIds.map((agentId) => getAgentHealth(agentId, runtime, thresholds));
}

/**
 * Generate health summary from agent health statuses
 *
 * @param agentHealths - Array of agent health statuses
 * @returns Health summary with counts by state
 */
export function generateHealthSummary(agentHealths: AgentHealth[]): HealthSummary {
  const summary: HealthSummary = {
    active: 0,
    stale: 0,
    warning: 0,
    stuck: 0,
    total: agentHealths.length,
  };

  for (const health of agentHealths) {
    summary[health.state]++;
  }

  return summary;
}

/**
 * Check if an agent needs attention (warning or stuck)
 *
 * @param health - Agent health status
 * @returns True if agent needs attention
 */
export function needsAttention(health: AgentHealth): boolean {
  return health.state === 'warning' || health.state === 'stuck';
}

/**
 * Check if an agent should be poked (warning state)
 *
 * @param health - Agent health status
 * @returns True if agent should be poked
 */
export function shouldPoke(health: AgentHealth): boolean {
  return health.state === 'warning';
}

/**
 * Check if an agent should be killed (stuck state)
 *
 * @param health - Agent health status
 * @returns True if agent should be killed
 */
export function shouldKill(health: AgentHealth): boolean {
  return health.state === 'stuck';
}

/**
 * Get agents that need attention
 *
 * @param agentHealths - Array of agent health statuses
 * @returns Array of agents needing attention
 */
export function getAgentsNeedingAttention(agentHealths: AgentHealth[]): AgentHealth[] {
  return agentHealths.filter(needsAttention);
}

/**
 * Get agents that should be poked
 *
 * @param agentHealths - Array of agent health statuses
 * @returns Array of agents to poke
 */
export function getAgentsToPoke(agentHealths: AgentHealth[]): AgentHealth[] {
  return agentHealths.filter(shouldPoke);
}

/**
 * Get agents that should be killed
 *
 * @param agentHealths - Array of agent health statuses
 * @returns Array of agents to kill
 */
export function getAgentsToKill(agentHealths: AgentHealth[]): AgentHealth[] {
  return agentHealths.filter(shouldKill);
}

/**
 * Format time duration in human-readable format
 *
 * @param ms - Milliseconds
 * @returns Human-readable duration (e.g., "5m", "2h", "1d")
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return 'unknown';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get health emoji for a health state
 *
 * @param state - Health state
 * @returns Emoji representing the state
 */
export function getHealthEmoji(state: HealthState): string {
  switch (state) {
    case 'active':
      return '🟢';
    case 'stale':
      return '🟡';
    case 'warning':
      return '🟠';
    case 'stuck':
      return '🔴';
  }
}

/**
 * Get health label for a health state
 *
 * @param state - Health state
 * @returns Human-readable label
 */
export function getHealthLabel(state: HealthState): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'stale':
      return 'Stale';
    case 'warning':
      return 'Warning';
    case 'stuck':
      return 'Stuck';
  }
}
