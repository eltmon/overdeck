/** PAN-4499 WI-5: the kickoff door — the only path that sends a held handoff's kickoff. */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { readHeldKickoff } from '../../../lib/overdeck/conversation-kickoff-store.js';
import { startHeldKickoff } from '../../../lib/overdeck/conversation-kickoff.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { validateOrigin } from './origin-validation.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

const getConversationKickoffRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/kickoff',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const text = readHeldKickoff(name);
    return text === null ? jsonResponse({ held: false }) : jsonResponse({ held: true, text });
  }),
);

const postConversationKickoffRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/kickoff',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const body = yield* readJsonBody;
    const result = yield* Effect.promise(() => startHeldKickoff(name, body['text']));
    switch (result.status) {
      case 'started':
        return jsonResponse({ success: true, conversation: result.conversation });
      case 'not-found':
        return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
      case 'not-held':
        return jsonResponse({ error: 'No held kickoff: the conversation was already started or was never held' }, { status: 409 });
      case 'invalid':
        return jsonResponse({ error: result.error }, { status: 400 });
    }
  }),
);

export const conversationKickoffRouteLayer = Layer.mergeAll(getConversationKickoffRoute, postConversationKickoffRoute);
