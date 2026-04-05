import { jsonResponse } from "../http-helpers.js";
/**
 * Cloister route module — Effect HttpRouter.Layer (PAN-428 B11)
 *
 * Implements all /api/cloister/* endpoints from the Express server:
 *   GET  /api/cloister/status
 *   POST /api/cloister/start
 *   POST /api/cloister/stop
 *   POST /api/cloister/emergency-stop
 *   POST /api/cloister/resume-spawns
 *   GET  /api/cloister/spawn-status
 *   GET  /api/cloister/config
 *   PUT  /api/cloister/config
 *   GET  /api/cloister/agents/health
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { loadCloisterConfig, saveCloisterConfig } from '../../../lib/cloister/config.js';
import { EventStoreService } from '../services/domain-services.js';

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/cloister/status ─────────────────────────────────────────

const getCloisterStatusRoute = HttpRouter.add(
  'GET',
  '/api/cloister/status',
  Effect.sync(() => {
    try {
      const service = getCloisterService();
      const status = service.getStatus();
      return jsonResponse(status);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting Cloister status:', error);
      return jsonResponse({ error: 'Failed to get Cloister status: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Route: POST /api/cloister/start ─────────────────────────────────────────

const postCloisterStartRoute = HttpRouter.add(
  'POST',
  '/api/cloister/start',
  Effect.promise(async () => {
      try {
        const service = getCloisterService();
        await service.start();
        return jsonResponse({ success: true, message: 'Cloister started' });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error starting Cloister:', error);
        return jsonResponse({ error: 'Failed to start Cloister: ' + msg }, { status: 500 });
      }
    })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error stopping Cloister:', error);
      return jsonResponse({ error: 'Failed to stop Cloister: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Route: POST /api/cloister/emergency-stop ────────────────────────────────

const postCloisterEmergencyStopRoute = HttpRouter.add(
  'POST',
  '/api/cloister/emergency-stop',
  Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    return yield* Effect.sync(() => {
      try {
        const service = getCloisterService();
        const killedAgents = service.emergencyStop();
        const ts = new Date().toISOString();
        for (const agentId of killedAgents) {
          Effect.runSync(eventStore.append({
            type: 'agent.stopped',
            timestamp: ts,
            payload: { agentId, issueId: agentId.replace(/^agent-/, '').toUpperCase() },
          }));
        }
        return jsonResponse({
          success: true,
          message: 'Emergency stop executed',
          killedAgents,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error executing emergency stop:', error);
        return jsonResponse({ error: 'Failed to execute emergency stop: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/cloister/resume-spawns ─────────────────────────────────

const postCloisterResumeSpawnsRoute = HttpRouter.add(
  'POST',
  '/api/cloister/resume-spawns',
  Effect.sync(() => {
    try {
      const service = getCloisterService();
      service.resumeSpawns();
      return jsonResponse({ success: true, message: 'Agent spawns resumed' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error resuming spawns:', error);
      return jsonResponse({ error: 'Failed to resume spawns: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Route: GET /api/cloister/spawn-status ───────────────────────────────────

const getCloisterSpawnStatusRoute = HttpRouter.add(
  'GET',
  '/api/cloister/spawn-status',
  Effect.sync(() => {
    try {
      const service = getCloisterService();
      const isPaused = service.isSpawnPaused();
      return jsonResponse({ spawnsPaused: isPaused });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error checking spawn status:', error);
      return jsonResponse({ error: 'Failed to check spawn status: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Route: GET /api/cloister/config ─────────────────────────────────────────

const getCloisterConfigRoute = HttpRouter.add(
  'GET',
  '/api/cloister/config',
  Effect.sync(() => {
    try {
      const config = loadCloisterConfig();
      return jsonResponse(config);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error loading Cloister config:', error);
      return jsonResponse({ error: 'Failed to load Cloister config: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Route: PUT /api/cloister/config ─────────────────────────────────────────

const putCloisterConfigRoute = HttpRouter.add(
  'PUT',
  '/api/cloister/config',
  Effect.gen(function* () {
    const updates = yield* readJsonBody;
    return yield* Effect.sync(() => {
      try {
        const service = getCloisterService();
        saveCloisterConfig(updates);
        service.reloadConfig();
        return jsonResponse({ success: true, config: updates });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error updating Cloister config:', error);
        return jsonResponse({ error: 'Failed to update Cloister config: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: GET /api/cloister/agents/health ──────────────────────────────────

const getCloisterAgentsHealthRoute = HttpRouter.add(
  'GET',
  '/api/cloister/agents/health',
  Effect.sync(() => {
    try {
      const service = getCloisterService();
      const agentHealths = service.getAllAgentHealth();
      return jsonResponse({ agents: agentHealths });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting agents health:', error);
      return jsonResponse({ error: 'Failed to get agents health: ' + msg }, { status: 500 });
    }
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const cloisterRouteLayer = Layer.mergeAll(
  getCloisterStatusRoute,
  postCloisterStartRoute,
  postCloisterStopRoute,
  postCloisterEmergencyStopRoute,
  postCloisterResumeSpawnsRoute,
  getCloisterSpawnStatusRoute,
  getCloisterConfigRoute,
  putCloisterConfigRoute,
  getCloisterAgentsHealthRoute,
);

export default cloisterRouteLayer;
