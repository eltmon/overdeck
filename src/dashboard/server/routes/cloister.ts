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
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { loadCloisterConfigSync, saveCloisterConfigSync } from '../../../lib/cloister/config.js';
import { EventStoreService } from '../services/domain-services.js';
import { httpHandler } from './http-handler.js';

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
  httpHandler(Effect.try({
    try: () => {
      const service = getCloisterService();
      return jsonResponse(service.getStatus());
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: POST /api/cloister/start ─────────────────────────────────────────

const postCloisterStartRoute = HttpRouter.add(
  'POST',
  '/api/cloister/start',
  httpHandler(Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => getCloisterService().start(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse({ success: true, message: 'Cloister started' });
  })),
);

// ─── Route: POST /api/cloister/stop ──────────────────────────────────────────

const postCloisterStopRoute = HttpRouter.add(
  'POST',
  '/api/cloister/stop',
  httpHandler(Effect.try({
    try: () => {
      getCloisterService().stop();
      return jsonResponse({ success: true, message: 'Cloister stopped' });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: POST /api/cloister/emergency-stop ────────────────────────────────

const postCloisterEmergencyStopRoute = HttpRouter.add(
  'POST',
  '/api/cloister/emergency-stop',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const killedAgents = yield* Effect.try({
      try: () => getCloisterService().emergencyStop(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    const ts = new Date().toISOString();
    for (const agentId of killedAgents) {
      yield* eventStore.append({
        type: 'agent.stopped',
        timestamp: ts,
        payload: { agentId, issueId: agentId.replace(/^agent-/, '').toUpperCase() },
      });
    }
    return jsonResponse({ success: true, message: 'Emergency stop executed', killedAgents });
  })),
);

// ─── Route: POST /api/cloister/resume-spawns ─────────────────────────────────

const postCloisterResumeSpawnsRoute = HttpRouter.add(
  'POST',
  '/api/cloister/resume-spawns',
  httpHandler(Effect.try({
    try: () => {
      getCloisterService().resumeSpawns();
      return jsonResponse({ success: true, message: 'Agent spawns resumed' });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/cloister/spawn-status ───────────────────────────────────

const getCloisterSpawnStatusRoute = HttpRouter.add(
  'GET',
  '/api/cloister/spawn-status',
  httpHandler(Effect.try({
    try: () => {
      const isPaused = getCloisterService().isSpawnPaused();
      return jsonResponse({ spawnsPaused: isPaused });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/cloister/config ─────────────────────────────────────────

const getCloisterConfigRoute = HttpRouter.add(
  'GET',
  '/api/cloister/config',
  httpHandler(Effect.try({
    try: () => jsonResponse(loadCloisterConfigSync()),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: PUT /api/cloister/config ─────────────────────────────────────────

const putCloisterConfigRoute = HttpRouter.add(
  'PUT',
  '/api/cloister/config',
  httpHandler(Effect.gen(function* () {
    const updates = yield* readJsonBody;
    yield* Effect.try({
      try: () => {
        saveCloisterConfigSync(updates);
        getCloisterService().reloadConfig();
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse({ success: true, config: updates });
  })),
);

// ─── Route: GET /api/cloister/agents/health ──────────────────────────────────

const getCloisterAgentsHealthRoute = HttpRouter.add(
  'GET',
  '/api/cloister/agents/health',
  httpHandler(Effect.try({
    try: () => {
      const agentHealths = getCloisterService().getAllAgentHealth();
      return jsonResponse({ agents: agentHealths });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
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
