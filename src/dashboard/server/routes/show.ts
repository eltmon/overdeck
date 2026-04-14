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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getShadowState } from '../../../lib/shadow-state.js';
import { getAgentHealth } from '../../../lib/cloister/health.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
;

// ─── Route: GET /api/show/:issueId ────────────────────────────────────────────

const getShowRoute = HttpRouter.add(
  'GET',
  '/api/show/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const shadowState = getShadowState(issueId);
    const agentId = `agent-${issueId.toLowerCase()}`;
    const health = yield* Effect.promise(() => getAgentHealth(agentId).catch(() => null));

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

    const shadowState = getShadowState(issueId);
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

    const health = yield* Effect.promise(() => getAgentHealth(agentId).catch((err) => ({
      error: err.message,
    })));

    return jsonResponse({ issueId, agentId, health });
  }))
);

// ─── Route: GET /api/show/:issueId/tldr ───────────────────────────────────────

const getShowTldrRoute = HttpRouter.add(
  'GET',
  '/api/show/:issueId/tldr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const project = resolveProjectFromIssue(issueId);
    const projectPath = project?.path ?? process.cwd();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    return jsonResponse({ available: false, reason: 'Use pan admin tldr for daemon status' });
  }))
);

export const showRouteLayer = Layer.mergeAll(
  getShowRoute,
  getShowShadowRoute,
  getShowHealthRoute,
  getShowTldrRoute,
);

export default showRouteLayer;
