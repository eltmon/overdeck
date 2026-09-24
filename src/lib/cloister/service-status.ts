/** Cloister status and health snapshot seam. */
import { Effect } from 'effect';
import type { CloisterConfig } from './config.js';
import { getDeaconLiteStatus, type DeaconLiteStatus } from './deacon-lite.js';
import {
  getAgentHealth,
  generateHealthSummary,
  getAgentsNeedingAttention,
  type AgentHealth,
  type HealthSummary,
} from './health.js';
import { listRunningAgents } from '../agents.js';
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
  /** PAN-3917: deacon-lite's own loop state — there is no patrol ledger left. */
  patrol: DeaconLiteStatus;
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
 * Uses a 3-second TTL cache for repeated dashboard polls: the computation
 * lists running agents and reads every agent's health, which scales poorly
 * with agent count.
 */
export async function getStatus(host: StatusHost): Promise<CloisterStatus> {
  const now = Date.now();
  if (host.statusCache && now - host.statusCacheAt < host.statusCacheTtlMs) {
    return host.statusCache;
  }

  const runningAgents = (await Effect.runPromise(listRunningAgents())).filter((a) => a.tmuxActive);
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

  const patrol = getDeaconLiteStatus();

  const status: CloisterStatus = {
    running: host.isRunning(),
    lastCheck: host.lastCheck,
    config: host.config,
    summary,
    agentsNeedingAttention: needsAttention,
    patrol,
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
export async function getAllAgentHealth(_host: StatusHost): Promise<AgentHealth[]> {
  const runningAgents = (await Effect.runPromise(listRunningAgents())).filter((a) => a.tmuxActive);
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
