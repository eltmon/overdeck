import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
/**
 * Show route module — observation endpoints
 *
 * Implements /api/show/* endpoints mirroring the `pan show <id>` CLI verb:
 *   GET /api/show/:issueId          — combined summary (shadow state + health)
 *   GET /api/show/:issueId/shadow   — shadow state details
 *   GET /api/show/:issueId/health   — health + heartbeat only
 */

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getShadowState } from '../../../lib/shadow-state.js';
import { getAgentHealth } from '../../../lib/cloister/health.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';

// ─── Route: GET /api/show/:issueId ────────────────────────────────────────────

const getShowRoute = HttpRouter.add(
  'GET',
  '/api/show/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const shadowState = yield* getShadowState(issueId);
    const agentId = `agent-${issueId.toLowerCase()}`;
    const runtime = getRuntimeForAgent(agentId);
    const health = runtime ? getAgentHealth(agentId, runtime) : null;

    return jsonResponse({
      issueId,
      shadow: shadowState,
      health,
    });
  }))
);

// ─── Route: GET /api/show/:issueId/shadow ─────────────────────────────────────

const getShowShadowRoute = HttpRouter.add(
  'GET',
  '/api/show/:issueId/shadow',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const shadowState = yield* getShadowState(issueId);
    if (!shadowState) {
      return jsonResponse({ error: 'No shadow state found' }, { status: 404 });
    }
    return jsonResponse(shadowState);
  }))
);

// ─── Route: GET /api/show/:issueId/health ─────────────────────────────────────

const getShowHealthRoute = HttpRouter.add(
  'GET',
  '/api/show/:issueId/health',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const agentId = `agent-${issueId.toLowerCase()}`;
    const runtime = getRuntimeForAgent(agentId);
    let health: ReturnType<typeof getAgentHealth> | { error: string } | null = null;
    if (runtime) {
      try {
        health = getAgentHealth(agentId, runtime);
      } catch (err: any) {
        health = { error: err.message };
      }
    }

    return jsonResponse({ issueId, agentId, health });
  }))
);

export const showRouteLayer = Layer.mergeAll(
  getShowRoute,
  getShowShadowRoute,
  getShowHealthRoute,
);

export default showRouteLayer;
