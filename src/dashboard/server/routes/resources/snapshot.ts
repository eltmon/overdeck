import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { listAgentStates, type AgentState } from '../../../../lib/agents.js';
import { listSessions } from '../../../../lib/tmux.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { getAgentStatsSnapshotEffect } from './agents-stats.js';
import { getCoreServicesSnapshot } from './core-services.js';
import { buildCapacityForecast } from './forecast.js';
import { getHostProcessesSnapshot } from './host-processes.js';
import { buildHostVitalsSnapshot } from './host-vitals.js';
import { enrichContainersWithLimits } from './limits.js';
import { buildReclaimPayload } from './reclaim.js';
import { getCurrentDockerStats } from './shared.js';
import { getSpawnGatePayloadEffect } from './spawn-gate.js';
import { getResourceStacks } from './stacks.js';

/** Build the GET /api/resources response from the SQLite agents table. */
export function getResourcesEffect(): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return Effect.gen(function* () {
    const containers = enrichContainersWithLimits(getCurrentDockerStats());
    const agentStats = yield* getAgentStatsSnapshotEffect();
    const spawnGate = yield* getSpawnGatePayloadEffect();
    const stoppedContainers: unknown[] = [];

    // PAN-1908: authoritative agent registry is the SQLite agents table.
    // Read active agent states from the table and cross-check tmux liveness.
    const sessions = yield* listSessions().pipe(
      Effect.catch(() => Effect.succeed([])),
    );
    const tmuxSessionNames = new Set(sessions.map(s => s.name));
    const agents: Record<string, unknown>[] = listAgentStates()
      .filter((state: AgentState) => state.status !== 'stopped')
      .map((state: AgentState) => ({
        ...state,
        hasLiveTmuxSession: tmuxSessionNames.has(state.id),
      }));
    const agentStatsById = new Map(agentStats.agents.map((agent) => [agent.id, agent]));
    const baseHostVitals = buildHostVitalsSnapshot({
      containers,
      agents: agents.map((agent) => ({
        id: String(agent.id),
        lastActivity: typeof agent.lastActivity === 'string' ? agent.lastActivity : undefined,
        hasLiveTmuxSession: agent.hasLiveTmuxSession === true,
      })),
      agentFleet: agentStats.hostVitals.agents,
    });
    const stacks = getResourceStacks(containers);
    const reclaim = buildReclaimPayload(stacks, agents);
    const hostVitals = {
      ...baseHostVitals,
      disk: {
        ...baseHostVitals.disk,
        reclaimableBytes: reclaim.reclaimTotals.diskBytes,
      },
    };

    return jsonResponse({
      agents: agents.map((agent) => ({
        ...agent,
        resourceStats: agentStatsById.get(String(agent.id)) ?? null,
      })),
      coreServices: getCoreServicesSnapshot(),
      containers,
      forecast: buildCapacityForecast(stacks, { hostVitals }),
      hostVitals,
      hostProcesses: getHostProcessesSnapshot(),
      stoppedContainers,
      networks: [],
      reclaimCandidates: reclaim.reclaimCandidates,
      reclaimThresholdBytes: reclaim.reclaimThresholdBytes,
      reclaimTotals: reclaim.reclaimTotals,
      spawnGate,
      stacks,
      volumes: [],
      updatedAt: new Date().toISOString(),
    });
  });
}

export const getResourcesRoute = HttpRouter.add(
  'GET',
  '/api/resources',
  httpHandler(getResourcesEffect()),
);
