import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { conversationSubagentInput } from '../../../lib/overdeck/conversation-subagent-input.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const inputHandler = (send: boolean) => Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const params = yield* HttpRouter.params;
  let body: Record<string, unknown> | undefined;
  if (send) {
    const text = yield* request.text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  const response = yield* Effect.promise(() => conversationSubagentInput(
    params['name'] ?? '', params['agentId'] ?? '', { resolveSessionFile }, body,
  ));
  return jsonResponse(response.body, { status: response.status ?? 200 });
});

export const conversationSubagentInputRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/api/conversations/:name/subagents/:agentId/input', inputHandler(false)),
  HttpRouter.add('POST', '/api/conversations/:name/subagents/:agentId/input', inputHandler(true)),
);
