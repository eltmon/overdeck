import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getBackendPanes } from '../../services/backend-inventory.js';
import { jsonResponse, jsonStringResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { getAgentStatsSnapshotEffect } from './agents-stats.js';
import { getCoreServicesSnapshot } from './core-services.js';
import { buildCapacityForecast } from './forecast.js';
import { getHostProcessesSnapshot } from './host-processes.js';
import { buildHostVitalsSnapshot } from './host-vitals.js';
import { enrichContainersWithLimits } from './limits.js';
import { buildReclaimPayload, listReclaimVenvIssueIds, loadClosedIssueIds } from './reclaim.js';
import { getCurrentDockerStats } from './shared.js';
import {
  getResourcesHealthEvidenceEffect,
  getSpawnGatePayloadEffect,
} from './spawn-gate.js';
import { buildResourceStacks, loadStackIssueStates } from './stacks.js';

export const RESOURCES_SNAPSHOT_INTERVAL_MS = 3_000;

let resourcesSnapshotJson: string | null = null;
let resourcesSnapshotRefresh: Promise<void> | null = null;
let resourcesSnapshotTimer: ReturnType<typeof setInterval> | null = null;

/** Build the resources payload from cached collectors and the live backend inventory. */
export function buildResourcesPayloadEffect() {
  return Effect.gen(function* () {
    const containers = enrichContainersWithLimits(getCurrentDockerStats());
    const agentStats = yield* getAgentStatsSnapshotEffect();
    const healthEvidence = yield* getResourcesHealthEvidenceEffect();
    const spawnGate = yield* getSpawnGatePayloadEffect(healthEvidence);
    const stoppedContainers: unknown[] = [];

    // PAN-3917 FR-12: the agent inventory is the terminal backend's, read
    // live. There is no agents table and no tmux cross-check — a pane in the
    // inventory is the agent, and its state is the backend's answer.
    const panes = (yield* Effect.promise(() => getBackendPanes()))
      .filter((pane) => pane.state !== 'exited');
    const agents = panes.map((pane) => ({
      id: pane.id,
      issueId: pane.issue,
      role: pane.role,
      harness: pane.harness,
      model: pane.model,
      state: pane.state,
      workspace: pane.workspace,
      terminalId: pane.terminalId,
      lastActivity: pane.stateSince === undefined ? undefined : new Date(pane.stateSince).toISOString(),
    }));
    const agentStatsById = new Map(agentStats.agents.map((agent) => [agent.id, agent]));
    const baseHostVitals = buildHostVitalsSnapshot({
      hostMetrics: healthEvidence.accepted?.host.metrics,
      containers,
      agents: agents.map((agent) => ({
        id: agent.id,
        lastActivity: agent.lastActivity,
        hasLiveTmuxSession: true,
      })),
      agentFleet: agentStats.hostVitals.agents,
    });
    const stacks = buildResourceStacks(containers, yield* Effect.promise(() => loadStackIssueStates(containers)));
    // Only the venv candidates need a derived read: a stack already carries
    // its own state.
    const closedIssueIds = yield* Effect.promise(() => loadClosedIssueIds(listReclaimVenvIssueIds()));
    const reclaim = buildReclaimPayload(
      stacks,
      agents.map((agent) => ({ issueId: agent.issueId, hasLiveTmuxSession: true })),
      { closedIssueIds },
    );
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
        resourceStats: agentStatsById.get(agent.id) ?? null,
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
