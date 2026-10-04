/**
 * Conversation diff routes (PAN-4501: moved out of routes/conversations.ts).
 * GET /api/conversations/:name/diffs          — per-turn summaries
 * GET /api/conversations/:name/diffs/full     — whole conversation
 * GET /api/conversations/:name/diffs/:turnId  — one turn
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { getConversationDiffs, getConversationDiffFull, getConversationDiffTurn } from '../../../lib/overdeck/conversation-diffs.js';
import { getCachedMessages, resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { diffOptionsFromSearchParams } from '../../../lib/diffs/diff-output.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const conversationDiffDependencies = {
  resolveSessionFile,
  getCachedMessages,
};

const getConversationDiffsRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffs(name, conversationDiffDependencies);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);

const getConversationDiffFullRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs/full',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const diffOptions = diffOptionsFromSearchParams(new URL(request.url, 'http://localhost').searchParams);
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffFull(name, conversationDiffDependencies, diffOptions);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);

const getConversationDiffTurnRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs/:turnId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const turnId = params['turnId'] ?? '';
    const reqUrl = new URL(request.url, 'http://localhost');
    const fileFilter = reqUrl.searchParams.get('file') ?? undefined;
    const diffOptions = diffOptionsFromSearchParams(reqUrl.searchParams);
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffTurn(name, turnId, fileFilter, conversationDiffDependencies, diffOptions);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);

export const conversationDiffRoutes = Layer.mergeAll(
  getConversationDiffsRoute,
  getConversationDiffFullRoute,
  getConversationDiffTurnRoute,
);
