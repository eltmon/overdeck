/**
 * PAN-5353: Send now — press Claude Code's send-now chord in an agent's or a
 * conversation's pane. The request body is ignored.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { sendNowToAgent, type SendNowResult } from '../../../lib/agents/send-now.js';
import { sendNowToConversation } from '../../../lib/overdeck/conversation-send-now.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

export function sendNowResponse(result: SendNowResult) {
  return result.ok
    ? jsonResponse({ ok: true })
    : jsonResponse({ error: result.error, code: result.code }, { status: result.status });
}

export const conversationSendNowRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/send-now',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => sendNowToConversation(params['name'] ?? ''));
    return sendNowResponse(result);
  }),
);

export const agentSendNowRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/send-now',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => sendNowToAgent(params['id'] ?? ''));
    return sendNowResponse(result);
  }),
);

export const sendNowRouteLayer = Layer.mergeAll(conversationSendNowRoute, agentSendNowRoute);
