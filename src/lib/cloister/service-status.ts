/** Cloister status and health snapshot seam. */
import type { CloisterConfig } from './config.js';
import { getDeaconStatus, assessDeaconPatrolFreshness } from './deacon.js';
import {
  getAgentHealth,
  generateHealthSummary,
  getAgentsNeedingAttention,
  type AgentHealth,
  type HealthSummary,
} from './health.js';
import { listRunningAgentsSync } from '../agents.js';
import { getRuntimeForAgent } from '../runtimes/index.js';

/**
 * Cloister service status
 */
export interface CloisterStatus {
  running: boolean;
  lastCheck: Date | null;
  config: CloisterConfig;
  summary: HealthSummary;
  agentsNeedingAttention: string[];
  patrol: ReturnType<typeof assessDeaconPatrolFreshness> & {
    loopRunning: boolean;
    patrolIntervalMs: number;
  };
}

export interface StatusHost {
  statusCache: CloisterStatus | null;
  statusCacheAt: number;
  statusCacheTtlMs: number;
  lastCheck: Date | null;
  config: CloisterConfig;
  isRunning(): boolean;
}

/**
 * Get current status
 *
 * Uses a 3-second TTL cache to avoid blocking the event loop on repeated
 * dashboard polls. The underlying computation does sync file I/O and tmux
 * calls for every agent, which scales poorly with agent count.
 */
export function getStatus(host: StatusHost): CloisterStatus {
  const now = Date.now();
  if (host.statusCache && now - host.statusCacheAt < host.statusCacheTtlMs) {
    return host.statusCache;
  }

  const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
  const agentIds = runningAgents.map((a) => a.id);

  const agentHealths: AgentHealth[] = [];

  for (const agentId of agentIds) {
    const runtime = getRuntimeForAgent(agentId);
    if (runtime) {
      const health = getAgentHealth(agentId, runtime);
      agentHealths.push(health);
    }
  }

  const summary = generateHealthSummary(agentHealths);
  const needsAttention = getAgentsNeedingAttention(agentHealths).map((h) => h.agentId);

  const deaconStatus = getDeaconStatus();
  const patrol = assessDeaconPatrolFreshness({
    isRunning: deaconStatus.isRunning,
    lastPatrol: deaconStatus.state.lastPatrol,
    patrolIntervalMs: deaconStatus.config.patrolIntervalMs,
  });

  const status: CloisterStatus = {
    running: host.isRunning(),
    lastCheck: host.lastCheck,
    config: host.config,
    summary,
    agentsNeedingAttention: needsAttention,
    patrol: {
      ...patrol,
      loopRunning: deaconStatus.isRunning,
      patrolIntervalMs: deaconStatus.config.patrolIntervalMs,
    },
  };

  host.statusCache = status;
  host.statusCacheAt = now;
  return status;
}

/**
 * Get health for a specific agent
 */
export function getServiceAgentHealth(_host: StatusHost, agentId: string): AgentHealth | null {
  const runtime = getRuntimeForAgent(agentId);
  if (!runtime) {
    return null;
  }

  return getAgentHealth(agentId, runtime);
}

/**
 * Get health for all running agents
 */
export function getAllAgentHealth(_host: StatusHost): AgentHealth[] {
  const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
  const agentHealths: AgentHealth[] = [];

  for (const agent of runningAgents) {
    const runtime = getRuntimeForAgent(agent.id);
    if (runtime) {
      const health = getAgentHealth(agent.id, runtime);
      agentHealths.push(health);
    }
  }

  return agentHealths;
}
