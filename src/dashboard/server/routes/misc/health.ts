import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AgentRuntimeSnapshot,
  AgentSnapshot,
  ReviewStatusSnapshot,
  type AgentHealthSnapshot,
} from '@overdeck/contracts';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  classifyAgentHealth,
  type AgentHealthObservations,
  type AgentHealthRuntimeState,
} from '../../../../lib/agents/health.js';
import {
  isRoleTerminal,
  type AdvancingRole,
  type ReapableStatus,
} from '../../../../lib/cloister/reap-terminal-sessions.js';
import { getOverdeckHome } from '../../../../lib/paths.js';
import { listSessionNames } from '../../../../lib/tmux.js';
import { checkAgentHealth } from '../../../lib/health-filtering.js';
import { ReadModelService } from '../../read-model.js';
import { getSystemHealthSnapshot } from '../../services/system-health-service.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';

// ─── Route: GET /api/system/health ───────────────────────────────────────────

const getSystemHealthRoute = HttpRouter.add(
  'GET',
  '/api/system/health',
  httpHandler(Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    return jsonResponse(health);
  })),
);

// ─── Route: GET /api/godview/system-health ───────────────────────────────────

const getGodviewSystemHealthRoute = HttpRouter.add(
  'GET',
  '/api/godview/system-health',
  httpHandler(Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    return jsonResponse({
      cpu: health.summary.cpuPercent,
      memPercent: health.summary.memoryUsedPercent,
      memUsed: health.summary.usedMemoryBytes,
      memTotal: health.summary.totalMemoryBytes,
      updatedAt: health.updatedAt,
    });
  })),
);

// ─── Route: GET /api/health/agents ───────────────────────────────────────────

type HealthAgentsRouteSnapshot = {
  agents: readonly unknown[];
  agentRuntimeById?: unknown;
  reviewStatuses?: readonly unknown[];
};

interface HealthAgentsRouteDependencies {
  snapshot: Effect.Effect<unknown, unknown>;
  sessionNames: Effect.Effect<readonly string[], unknown>;
  readObservations?: (agentId: string) => Promise<AgentHealthObservations>;
  nowMs?: number;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function readAgentHealthObservations(
  agentId: string,
): Promise<AgentHealthObservations> {
  if (!/^[A-Za-z0-9._-]+$/.test(agentId) || agentId.includes('..')) return {};

  const agentDir = join(getOverdeckHome(), 'agents', agentId);
  const observations: AgentHealthObservations = {};
  try {
    const stored: unknown = JSON.parse(await readFile(join(agentDir, 'health.json'), 'utf-8'));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const record = stored as Record<string, unknown>;
      const consecutiveFailures = finiteNumber(record['consecutiveFailures']);
      const killCount = finiteNumber(record['killCount']);
      if (consecutiveFailures !== undefined) observations.consecutiveFailures = consecutiveFailures;
      if (killCount !== undefined) observations.killCount = killCount;
    }
  } catch {}

  try {
    const raw = (await readFile(join(agentDir, 'context-pct'), 'utf-8')).trim();
    const contextPercent = raw === '' ? Number.NaN : Number(raw);
    if (Number.isFinite(contextPercent)) observations.contextPercent = contextPercent;
  } catch {}

  return observations;
}

function runtimeHealthState(
  runtime: typeof AgentRuntimeSnapshot.Type | null,
): AgentHealthRuntimeState | null {
  if (!runtime) return null;
  switch (runtime.activity) {
    case 'working':
    case 'thinking':
      return {
        state: 'active',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'waiting':
      return {
        state: 'waiting-on-human',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'idle':
      return {
        state: 'idle',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'stopped':
      return {
        state: 'stopped',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
  }
}

function decodeReviewStatuses(value: readonly unknown[] | undefined): Map<string, ReapableStatus> {
  const statuses = new Map<string, ReapableStatus>();
  for (const candidate of value ?? []) {
    const decoded = Schema.decodeUnknownResult(ReviewStatusSnapshot)(candidate);
    if (decoded._tag === 'Success') {
      statuses.set(decoded.success.issueId.toUpperCase(), decoded.success);
    }
  }
  return statuses;
}

function reviewLifecycle(
  agent: typeof AgentSnapshot.Type,
  statuses: ReadonlyMap<string, ReapableStatus>,
): 'active' | 'warm' | 'unknown' {
  if (agent.role !== 'review' && agent.role !== 'test' && agent.role !== 'ship') {
    return 'unknown';
  }
  const status = statuses.get(agent.issueId.toUpperCase());
  if (!status) return 'unknown';
  return isRoleTerminal(agent.role as AdvancingRole, status) ? 'warm' : 'active';
}

function snapshotSource(value: unknown): HealthAgentsRouteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The canonical read model did not return an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate['agents'])) {
    throw new Error('The canonical read model did not return an agent array.');
  }
  return {
    agents: candidate['agents'],
    agentRuntimeById: candidate['agentRuntimeById'],
    reviewStatuses: Array.isArray(candidate['reviewStatuses'])
      ? candidate['reviewStatuses']
      : undefined,
  };
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function projectAgentHealth(
  snapshotValue: unknown,
  sessionNames: readonly string[],
  readObservations: (agentId: string) => Promise<AgentHealthObservations>,
  nowMs: number,
): Promise<AgentHealthSnapshot[]> {
  const snapshot = snapshotSource(snapshotValue);
  const liveSessions = new Set(sessionNames);
  const runtimes = runtimeRecord(snapshot.agentRuntimeById);
  const reviewStatuses = decodeReviewStatuses(snapshot.reviewStatuses);

  return Promise.all(snapshot.agents.map(async (candidate, index) => {
    const decoded = Schema.decodeUnknownResult(AgentSnapshot)(candidate);
    if (decoded._tag === 'Failure') {
      const candidateId = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)['id']
        : undefined;
      return classifyAgentHealth({
        agentId: typeof candidateId === 'string' ? candidateId : `unavailable-agent-${index + 1}`,
        persisted: {
          status: 'unavailable',
          reason: 'The canonical agent snapshot could not be decoded.',
        },
        runtime: null,
        liveSessions,
        reviewLifecycle: 'unknown',
        nowMs,
      });
    }

    const agent = decoded.success;
    const runtimeCandidate = Schema.decodeUnknownResult(AgentRuntimeSnapshot)(runtimes[agent.id]);
    const runtime = runtimeCandidate._tag === 'Success' ? runtimeCandidate.success : null;
    const observations = await readObservations(agent.id).catch(() => ({}));
    return classifyAgentHealth({
      agentId: agent.id,
      persisted: {
        status: 'available',
        value: {
          id: agent.id,
          issueId: agent.issueId,
          role: agent.role,
          status: agent.status,
          startedAt: agent.startedAt,
          lastActivity: agent.lastActivity,
          paused: agent.paused,
          stoppedByUser: agent.stoppedByUser,
          consecutiveFailures: agent.consecutiveFailures,
        },
      },
      runtime: runtimeHealthState(runtime),
      liveSessions,
      reviewLifecycle: reviewLifecycle(agent, reviewStatuses),
      observations,
      nowMs,
    });
  }));
}

export function buildHealthAgentsResponse(
  dependencies: HealthAgentsRouteDependencies,
) {
  return Effect.all({
    snapshot: dependencies.snapshot,
    sessionNames: dependencies.sessionNames,
  }).pipe(
    Effect.flatMap(({ snapshot, sessionNames }) => Effect.promise(async () =>
      jsonResponse(await projectAgentHealth(
        snapshot,
        sessionNames,
        dependencies.readObservations ?? readAgentHealthObservations,
        dependencies.nowMs ?? Date.now(),
      ))
    )),
    Effect.catchCause(() => Effect.succeed(jsonResponse({
      status: 'unavailable',
      reasons: [{
        code: 'agent.health_snapshot.unavailable',
        domain: 'agent',
        severity: 'critical',
        message: 'The canonical agent health snapshot could not be loaded.',
      }],
    }, { status: 503 }))),
  );
}

const getHealthAgentsRoute = HttpRouter.add(
  'GET',
  '/api/health/agents',
  Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    return yield* buildHealthAgentsResponse({
      snapshot: readModel.getSnapshot,
      sessionNames: listSessionNames(),
    });
  }),
);

// ─── Route: POST /api/health/agents/:id/ping ─────────────────────────────────

const postHealthAgentPingRoute = HttpRouter.add(
  'POST',
  '/api/health/agents/:id/ping',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/health/agents/:id/ping → parts[4] = id
    const id = parts[4] || '';

    return yield* Effect.promise(async () => {
    try {
        const health = await Effect.runPromise(checkAgentHealth(id));

        if (!health.alive) {
          return jsonResponse({ success: false, status: 'dead' });
        }

        return jsonResponse({
          success: true,
          status: 'healthy',
          hasOutput: !!health.lastOutput,
        });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to ping agent: ' + msg }, { status: 500 });
        }})
  }),
);

export const healthRouteLayer = Layer.mergeAll(
  getSystemHealthRoute,
  getGodviewSystemHealthRoute,
  getHealthAgentsRoute,
  postHealthAgentPingRoute,
);
