/**
 * Pull requests linked to a conversation (PAN-3822).
 *
 *   GET    /api/conversations/:name/pull-requests          → { links, effective }
 *   POST   /api/conversations/:name/pull-requests          { ref, source? } → 201 link
 *   DELETE /api/conversations/:name/pull-requests?ref=<ref> → { unlinked, link }
 *   POST   /api/conversations/:name/pull-requests/sync     → { links, effective } after a forced refresh
 *   GET    /api/pull-requests?state=&project=              → { links } across conversations
 *   GET    /api/pull-requests/conversations?url=<pr url>   → { pullRequest, conversations } (reverse index)
 *
 * `ref` is a PR/MR URL, `#42`, or `owner/repo#42`. Errors carry a `code`:
 * `invalid_ref`, `foreign_repository`, `invalid_filter` (400), `not_found`,
 * `not_linked` (404).
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import {
  getConversationPullRequests,
  getPullRequestConversations,
  linkPullRequestToConversation,
  listPullRequestLinks,
  syncConversationPullRequests,
  unlinkPullRequestFromConversation,
  type PullRequestCommandResult,
} from '../../../lib/overdeck/conversation-pull-request-commands.js';
import { jsonResponse } from '../http-helpers.js';
import { refreshPullRequestLinkNow } from '../services/pull-request-sync-service.js';
import { validateOrigin } from './origin-validation.js';

function respond<T>(result: PullRequestCommandResult<T>) {
  return jsonResponse(result.body, { status: result.status });
}

function conversationName(params: Readonly<Record<string, string | undefined>>): string {
  return decodeURIComponent(params['name'] ?? '');
}

const getRoute = HttpRouter.add('GET', '/api/conversations/:name/pull-requests', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const params = yield* HttpRouter.params;
  return respond(getConversationPullRequests(conversationName(params)));
}));

const postRoute = HttpRouter.add('POST', '/api/conversations/:name/pull-requests', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const params = yield* HttpRouter.params;
  const text = yield* request.text;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body', code: 'invalid_ref' }, { status: 400 });
  }
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const source = body.source === 'agent' ? 'agent' : 'manual';
  const name = conversationName(params);
  return yield* Effect.promise(async () => {
    const result = await linkPullRequestToConversation(name, ref, source, {
      refreshLink: async (link) => {
        await refreshPullRequestLinkNow(link);
        invalidateConversationListEnrichmentCache();
      },
    });
    if (result.ok) invalidateConversationListEnrichmentCache();
    return respond(result);
  });
}));

const deleteRoute = HttpRouter.add('DELETE', '/api/conversations/:name/pull-requests', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const params = yield* HttpRouter.params;
  const ref = new URL(request.url, 'http://localhost').searchParams.get('ref') ?? '';
  const name = conversationName(params);
  return yield* Effect.promise(async () => {
    const result = await unlinkPullRequestFromConversation(name, ref);
    if (result.ok) invalidateConversationListEnrichmentCache();
    return respond(result);
  });
}));

const syncRoute = HttpRouter.add('POST', '/api/conversations/:name/pull-requests/sync', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const params = yield* HttpRouter.params;
  const name = conversationName(params);
  return yield* Effect.promise(async () => {
    const result = await syncConversationPullRequests(name, (link) => refreshPullRequestLinkNow(link));
    if (result.ok) invalidateConversationListEnrichmentCache();
    return respond(result);
  });
}));

const listAllRoute = HttpRouter.add('GET', '/api/pull-requests', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const query = new URL(request.url, 'http://localhost').searchParams;
  return respond(listPullRequestLinks({ state: query.get('state'), project: query.get('project') }));
}));

const reverseIndexRoute = HttpRouter.add('GET', '/api/pull-requests/conversations', Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  const url = new URL(request.url, 'http://localhost').searchParams.get('url') ?? '';
  return respond(getPullRequestConversations(url));
}));

export const conversationPullRequestRoutes = Layer.mergeAll(
  getRoute,
  postRoute,
  deleteRoute,
  syncRoute,
  listAllRoute,
  reverseIndexRoute,
);
