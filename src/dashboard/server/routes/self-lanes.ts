/**
 * Self lane routes (PAN-4938, PAN-4927 W-DEL1, D-11, D-12): a conversation
 * launches gauntlet lanes under itself.
 *
 * - `POST /api/self/lanes { role, brief, key?, for?, run?, project?, model?, harness?, effort?, title?, branch?, from?, at?, machine?, needs?, reuse?, replace? }`
 *   (`operate`, D-11) → `lanes.handleLaneLaunch` with `parent` = the calling
 *   conversation. Any `parent` and `force` in the body are dropped. An
 *   agent-kind caller gets 409 `not-a-conversation`: a lane's parent must be a
 *   conversation, and an agent delegates with `delegate_task`.
 *
 * Auth: the route-scope table judges the scope; the handler then requires an
 * agent token (`self-caller.ts`), so every other credential gets 403
 * `not-an-agent-token` and a token whose conversation is gone gets 404
 * `agent-gone`. The parent comes from the token only.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { fleetCaller } from './fleet-work.js';
import { httpHandler } from './http-handler.js';
import { handleLaneLaunch, parseLaneLaunchBody } from './lanes.js';
import { readJsonResponse } from './machines-work.js';
import { validateOrigin } from './origin-validation.js';
import type { SelfRouteResult } from './self-jobs.js';

export const NOT_A_CONVERSATION = {
  code: 'not-a-conversation',
  error: 'lane_start needs a launching conversation; an agent delegates with delegate_task',
} as const;

export interface SelfLaneStartDeps {
  caller?: SelfCallerDeps;
  launch?: typeof handleLaneLaunch;
}

/** `POST /api/self/lanes`. */
export async function handleSelfLaneStart(
  credential: DashboardCredential | null,
  raw: unknown,
  viaChannel: boolean,
  deps: SelfLaneStartDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;
  if (caller.agentKind !== 'conversation') return { status: 409, body: NOT_A_CONVERSATION };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { status: 400, body: { error: 'body must be a JSON object' } };
  const { parent: _parent, force: _force, ...rest } = raw as Record<string, unknown>;
  const parsed = parseLaneLaunchBody({ ...rest, parent: caller.agentId });
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  // A token credential always yields a fleet caller.
  return readJsonResponse(await (deps.launch ?? handleLaneLaunch)(parsed.request, { viaChannel, caller: fleetCaller(credential, undefined)! }));
}

export function makeSelfLanesRouteLayer() {
  const startSelfLaneRoute = HttpRouter.add(
    'POST',
    '/api/self/lanes',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
      const text = yield* request.text;
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
      }
      const credential = resolveRequestCredential(request);
      const viaChannel = channelOfRequest(request) !== null;
      const result = yield* Effect.promise(() => handleSelfLaneStart(credential, body, viaChannel));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(startSelfLaneRoute);
}

export const selfLanesRouteLayer = makeSelfLanesRouteLayer();
