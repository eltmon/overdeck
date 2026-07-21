import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { listAgentStates, type AgentState } from '../../../../lib/agents.js';
import { getRuntimeCensus } from '../../../../lib/runtime-census.js';
import { jsonResponse, jsonStringResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { getAgentStatsSnapshotEffect } from './agents-stats.js';
import { getCoreServicesSnapshot } from './core-services.js';
import { buildCapacityForecast } from './forecast.js';
import { getHostProcessesSnapshot } from './host-processes.js';
import { buildHostVitalsSnapshot } from './host-vitals.js';
import { enrichContainersWithLimits } from './limits.js';
import { buildReclaimPayload } from './reclaim.js';
import { getCurrentDockerStats } from './shared.js';
import {
  getResourcesHealthEvidenceEffect,
  getSpawnGatePayloadEffect,
} from './spawn-gate.js';
import { getResourceStacks } from './stacks.js';

export const RESOURCES_SNAPSHOT_INTERVAL_MS = 3_000;

let resourcesSnapshotJson: string | null = null;
let resourcesSnapshotRefresh: Promise<void> | null = null;
let resourcesSnapshotTimer: ReturnType<typeof setInterval> | null = null;

/** Build the resources payload from cached collectors and the SQLite agents table. */
export function buildResourcesPayloadEffect() {
  return Effect.gen(function* () {
    const containers = enrichContainersWithLimits(getCurrentDockerStats());
    const agentStats = yield* getAgentStatsSnapshotEffect();
    const healthEvidence = yield* getResourcesHealthEvidenceEffect();
    const spawnGate = yield* getSpawnGatePayloadEffect(healthEvidence);
    const stoppedContainers: unknown[] = [];

    // PAN-1908: authoritative agent registry is the SQLite agents table.
    // Read active agent states from the table and cross-check tmux liveness.
    const runtimeCensus = yield* Effect.promise(() => getRuntimeCensus()).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const tmuxSessionNames = runtimeCensus?.sessionNames ?? new Set<string>();
    const agents: Record<string, unknown>[] = listAgentStates()
      .filter((state: AgentState) => state.status !== 'stopped')
      .map((state: AgentState) => ({
        ...state,
        hasLiveTmuxSession: tmuxSessionNames.has(state.id),
      }));
    const agentStatsById = new Map(agentStats.agents.map((agent) => [agent.id, agent]));
    const baseHostVitals = buildHostVitalsSnapshot({
      hostMetrics: healthEvidence.accepted?.host.metrics,
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

    return {
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
    };
  });
}

/** Explicit fresh builder retained for focused tests and diagnostics. */
export function getResourcesEffect(): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return buildResourcesPayloadEffect().pipe(Effect.map((payload) => jsonResponse(payload)));
}

export function refreshResourcesSnapshot(): Promise<void> {
  if (resourcesSnapshotRefresh) return resourcesSnapshotRefresh;
  resourcesSnapshotRefresh = Effect.runPromise(buildResourcesPayloadEffect())
    .then((payload) => {
      resourcesSnapshotJson = JSON.stringify(payload);
    })
    .finally(() => {
      resourcesSnapshotRefresh = null;
    });
  return resourcesSnapshotRefresh;
}

export function getResourcesSnapshotEffect(): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return Effect.sync(() => resourcesSnapshotJson
    ? jsonStringResponse(resourcesSnapshotJson)
    : jsonResponse({ error: 'Resources snapshot is warming' }, 503));
}

export function startResourcesSnapshotService(): () => void {
  if (resourcesSnapshotTimer) return stopResourcesSnapshotService;
  void refreshResourcesSnapshot().catch((error) => {
    console.warn('[resources-snapshot] initial refresh failed:', error instanceof Error ? error.message : error);
  });
  resourcesSnapshotTimer = setInterval(() => {
    void refreshResourcesSnapshot().catch((error) => {
      console.warn('[resources-snapshot] refresh failed; keeping last-good snapshot:', error instanceof Error ? error.message : error);
    });
  }, RESOURCES_SNAPSHOT_INTERVAL_MS);
  resourcesSnapshotTimer.unref?.();
  return stopResourcesSnapshotService;
}

export function stopResourcesSnapshotService(): void {
  if (resourcesSnapshotTimer) clearInterval(resourcesSnapshotTimer);
  resourcesSnapshotTimer = null;
}

export function resetResourcesSnapshotForTests(): void {
  stopResourcesSnapshotService();
  resourcesSnapshotJson = null;
  resourcesSnapshotRefresh = null;
}

export const getResourcesRoute = HttpRouter.add(
  'GET',
  '/api/resources',
  httpHandler(getResourcesSnapshotEffect()),
);
