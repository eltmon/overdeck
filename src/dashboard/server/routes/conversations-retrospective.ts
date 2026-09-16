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
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
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
    // Established mutation contract: a trusted Origin alone is not enough to
    // launch a model session. Callers must additionally present either the
    // server-side internal token OR a browser session cookie with a matching
    // CSRF header. The companion button sends the CSRF header via
    // dashboardMutationJsonHeaders(); non-browser callers without the internal
    // token get rejected here before any work runs.
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    return yield* Effect.promise(() =>
      handleRetrospectiveConversationCreate(body, {
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
