/**
 * POST /api/conversations/retrospective — start a No-project pipeline
 * retrospective conversation (PAN-3841).
 *
 * The route validates the origin, delegates body validation and kickoff
 * rendering to `handleRetrospectiveConversationCreate`, and funnels the
 * actual creation through `handleConversationCreate` — the single
 * conversation write door.
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';
import { readJsonBody } from './specialists/shared.js';
import { conversationReadDependencies } from './conversations.js';
import { generateAiTitle } from '../../../lib/overdeck/conversation-reads.js';
import { handleConversationCreate } from '../../../lib/overdeck/conversation-runtime.js';
import { handleRetrospectiveConversationCreate } from '../../../lib/overdeck/conversation-retrospective.js';

const postConversationRetrospectiveRoute = HttpRouter.add(
  'POST',
  '/api/conversations/retrospective',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const body = yield* readJsonBody;
    return yield* Effect.promise(() =>
      handleRetrospectiveConversationCreate(body as Record<string, unknown>, {
        createConversation: (createBody) =>
          handleConversationCreate(createBody, {
            generateAiTitle: (name, message) =>
              generateAiTitle(name, message, conversationReadDependencies),
          }),
      }),
    );
  }),
);
export const conversationsRetrospectiveRouteLayer = Layer.mergeAll(postConversationRetrospectiveRoute);
export default conversationsRetrospectiveRouteLayer;
