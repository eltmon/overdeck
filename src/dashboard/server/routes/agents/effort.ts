/**
 * POST /api/agents/:id/effort — live effort change for a claude-code agent
 * (PAN-4255). Body: `{ level }`. The handler lives in
 * `src/lib/agents/agent-live-effort.ts`.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { handleAgentLiveEffort } from '../../../../lib/agents/agent-live-effort.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateAgentMessageOrigin } from './messaging.js';
import { readJsonBody } from './shared.js';

export const postAgentEffortRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/effort',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateAgentMessageOrigin(request);
    if (!originCheck.ok) return originCheck.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const result = yield* Effect.promise(() => handleAgentLiveEffort(id, body));
    return jsonResponse(result.body, { status: result.status });
  })),
);
