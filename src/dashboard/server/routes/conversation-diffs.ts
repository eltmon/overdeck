/**
 * Conversation diff routes (PAN-4501: moved out of routes/conversations.ts).
 * GET /api/conversations/:name/diffs          — per-turn summaries
 * GET /api/conversations/:name/diffs/full     — the conversation's attributed files (PAN-5408)
 * GET /api/conversations/:name/diffs/vs-main  — conversation repo vs the project's default branch
 * GET /api/conversations/:name/diffs/:turnId  — one turn
 * GET /api/conversations/:name/changes        — commits and uncommitted edits (PAN-5288)
 * GET /api/conversations/:name/changes/lines  — lines the conversation changed in one file (PAN-5290)
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { getConversationDiffs, getConversationDiffFull, getConversationDiffTurn, getConversationDiffVsMain, type ConversationDiffFullDependencies } from '../../../lib/overdeck/conversation-diffs.js';
import { getCachedMessages, peekCachedMessages, resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { getConversationChanges, type ConversationChangesDependencies } from '../../../lib/overdeck/conversation-changes.js';
import { getConversationChangedLines } from '../../../lib/overdeck/conversation-change-lines.js';
import { listConversations } from '../../../lib/overdeck/conversations.js';
import type { ChangeScope, ConversationChanges } from '@overdeck/contracts';
import { diffOptionsFromSearchParams } from '../../../lib/diffs/diff-output.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const conversationDiffDependencies = {
  resolveSessionFile,
  getCachedMessages,
};

const conversationChangesDependencies: ConversationChangesDependencies = {
  resolveSessionFile,
  getCachedMessages,
  peekCachedMessages,
  listConversations: () => listConversations(),
  now: Date.now,
};

const conversationDiffFullDependencies: ConversationDiffFullDependencies = {
  ...conversationDiffDependencies,
  conversationChanges: async (name) => {
    const response = await getConversationChanges(name, { scope: 'conversation' }, conversationChangesDependencies);
    return response.status === 200 ? (response.body as ConversationChanges) : null;
  },
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
    const reqUrl = new URL(request.url, 'http://localhost');
    const fileFilter = reqUrl.searchParams.get('file') ?? undefined;
    const diffOptions = diffOptionsFromSearchParams(reqUrl.searchParams);
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffFull(name, fileFilter, conversationDiffFullDependencies, diffOptions);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);

const getConversationDiffVsMainRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs/vs-main',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const reqUrl = new URL(request.url, 'http://localhost');
    const fileFilter = reqUrl.searchParams.get('file') ?? undefined;
    const diffOptions = diffOptionsFromSearchParams(reqUrl.searchParams);
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffVsMain(name, fileFilter, diffOptions);
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

const getConversationChangesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/changes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const reqUrl = new URL(request.url, 'http://localhost');
    // An unknown scope is passed through so getConversationChanges answers 400.
    const scope = (reqUrl.searchParams.get('scope') ?? 'conversation') as ChangeScope;
    const turnId = reqUrl.searchParams.get('turnId') ?? undefined;
    return yield* Effect.promise(async () => {
      const response = await getConversationChanges(
        name,
        turnId === undefined ? { scope } : { scope, turnId },
        conversationChangesDependencies,
      );
      return jsonResponse(response.body, { status: response.status });
    });
  }),
);

const getConversationChangedLinesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/changes/lines',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const reqUrl = new URL(request.url, 'http://localhost');
    // A missing file is passed through as '' so getConversationChangedLines answers 400.
    const file = reqUrl.searchParams.get('file') ?? '';
    return yield* Effect.promise(async () => {
      const response = await getConversationChangedLines(name, file, conversationChangesDependencies);
      return jsonResponse(response.body, { status: response.status });
    });
  }),
);

export const conversationDiffRoutes = Layer.mergeAll(
  getConversationDiffsRoute,
  getConversationDiffFullRoute,
  getConversationDiffVsMainRoute,
  getConversationDiffTurnRoute,
  getConversationChangesRoute,
  getConversationChangedLinesRoute,
);
