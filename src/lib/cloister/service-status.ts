/** Cloister status and health snapshot seam. */
import { Effect } from 'effect';
import type { CloisterConfig } from './config.js';
import { type DeaconLiteStatus } from './deacon-lite.js';
import {
  getAgentHealth,
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
  lastCheck: Date | null;
  config: CloisterConfig;
  isRunning(): boolean;
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
