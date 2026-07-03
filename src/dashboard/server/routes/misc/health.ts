import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentStateFilePath } from '../../../../lib/agents.js';
import { checkAgentHealth, determineHealthStatus } from '../../../lib/health-filtering.js';
import { listSessionNames } from '../../../../lib/tmux.js';
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

const getHealthAgentsRoute = HttpRouter.add(
  'GET',
  '/api/health/agents',
  Effect.promise(async () => {
    try {
      const agentsDir = join(homedir(), '.overdeck', 'agents');
      if (!existsSync(agentsDir)) {
        return jsonResponse([]);
      }

      const agentNames = (await readdir(agentsDir)).filter(
        name =>
          name.startsWith('agent-') ||
          name.startsWith('planning-') ||
          name.startsWith('specialist-'),
      );

      // Fetch the live tmux session set ONCE for the whole request — per-agent
      // liveness checks used to fork once per agent dir (~150 forks per poll).
      const liveSessions = new Set(await Effect.runPromise(listSessionNames()));

      const agents = await Promise.all(
        agentNames.map(async name => {
          const stateFile = getAgentStateFilePath(name);
          const healthFile = join(agentsDir, name, 'health.json');

          const healthStatus = await Effect.runPromise(determineHealthStatus(name, stateFile, liveSessions));
          if (!healthStatus) return null;

          // Only read health.json for agents that survive the status filter —
          // most agent dirs are stopped/completed and bail out above.
          let storedHealth = { consecutiveFailures: 0, killCount: 0 };
          try {
            const healthContent = await readFile(healthFile, 'utf-8');
            storedHealth = { ...storedHealth, ...JSON.parse(healthContent) };
          } catch {}

          let contextPercent: number | null = null;
          try {
            const ctxFile = join(agentsDir, name, 'context-pct');
            const ctxContent = await readFile(ctxFile, 'utf-8');
            contextPercent = parseInt(ctxContent.trim(), 10) || null;
          } catch {}

          return {
            agentId: name,
            status: healthStatus.status,
            reason: healthStatus.reason,
            lastPing: new Date().toISOString(),
            consecutiveFailures: storedHealth.consecutiveFailures,
            killCount: storedHealth.killCount,
            contextPercent,
          };
        }),
      );

      const visibleAgents = agents.filter(agent => agent !== null);
      return jsonResponse(visibleAgents);
    } catch (error: unknown) {
      console.error('Error fetching health:', error);
      return jsonResponse([]);
    }
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
