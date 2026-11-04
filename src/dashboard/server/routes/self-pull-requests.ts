/**
 * `/api/self/pull-request-watches` and `/api/self/pull-requests` (PAN-4943
 * W-PR1, FR-2 server half, FR-4): an agent watches a GitHub pull request, or
 * links one to a conversation, without needing a conversation row of its own
 * (most work agents have none, PAN-4943 Fact 3).
 *
 * Auth: the route-scope table maps the create/delete/link routes to `tell`
 * and the list route to `read:state`; every handler then requires an agent
 * token (`self-caller.ts`) — bearer only, no origin check, as in
 * `self-requests.ts`. Every caller's watches and links are scoped to its own
 * `agentId`/`agentKind` (D-1); nothing here ever touches another owner's row.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { linkPullRequestToConversation } from '../../../lib/overdeck/conversation-pull-request-commands.js';
import { emitConversationPullRequestsChanged, setPullRequestLinkSnapshot } from '../../../lib/overdeck/conversation-pull-requests.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import {
  addPullRequestWatch,
  baselineFromSnapshot,
  listPullRequestWatches,
  PR_WATCH_LIMIT_PER_OWNER,
  PR_WATCH_LIMIT_TOTAL,
  removePullRequestWatch,
  type PullRequestWatch,
} from '../../../lib/overdeck/pull-request-watches.js';
import { jsonResponse } from '../http-helpers.js';
import { githubPullRequestKeyFromUrl, readPullRequestSnapshotNow, refreshPullRequestLinkNow } from '../services/pull-request-sync-service.js';
import { type SelfCaller, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { SelfRouteResult } from './self-jobs.js';

export interface SelfPullRequestsRouteDeps {
  caller?: SelfCallerDeps;
  readSnapshot?: typeof readPullRequestSnapshotNow;
}

const BAD_BODY = { error: 'body must be a JSON object', code: 'bad-body' } as const;
const BAD_URL = { error: 'url must be a GitHub pull request URL', code: 'invalid-url' } as const;
const TOO_MANY_WATCHES = { error: `this agent already has ${PR_WATCH_LIMIT_PER_OWNER} pull request watches`, code: 'too-many-watches' } as const;
const WATCH_LIMIT = { error: `${PR_WATCH_LIMIT_TOTAL} pull request watches already exist`, code: 'watch-limit' } as const;
const READ_FAILED = { error: 'could not read the pull request from GitHub', code: 'pr-read-failed' } as const;
const UNKNOWN_WATCH = { error: 'no such watch', code: 'unknown-watch' } as const;
export const NO_CONVERSATION = {
  error: 'this agent has no conversation; pass conversation to link_pull_request',
  code: 'no-conversation',
} as const;

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function watchView(watch: PullRequestWatch): Record<string, unknown> {
  return { id: watch.id, url: watch.url, repository: watch.repository, number: watch.number, createdAt: watch.createdAt, wakes: watch.wakes, quietWakes: watch.quietWakes, last: watch.last };
}

/** C-3: a conversation token links to its own name; an agent token only when a specialist conversation row exists for it (Fact 3). */
function conversationNameForCaller(caller: SelfCaller): string | null {
  if (caller.agentKind === 'conversation') return caller.agentId;
  return getConversationByName(caller.agentId) ? caller.agentId : null;
}

/** D-10: best-effort link to the caller's own conversation, never failing the watch. */
async function linkBestEffort(
  caller: SelfCaller,
  key: { host: string; repository: string; number: number; url: string },
  snapshot: Parameters<typeof baselineFromSnapshot>[0],
): Promise<{ linked: boolean; linkError?: string }> {
  const name = conversationNameForCaller(caller);
  if (!name) return { linked: false, linkError: 'no-conversation' };
  const result = await linkPullRequestToConversation(name, key.url, 'agent');
  if (!result.ok) return { linked: false, linkError: result.body.code };
  const changed = setPullRequestLinkSnapshot(key, snapshot);
  for (const changedName of changed) emitConversationPullRequestsChanged(changedName);
  if (changed.length > 0) invalidateConversationListEnrichmentCache();
  return { linked: true };
}

/** `POST /api/self/pull-request-watches` `{ url }`. */
export async function handlePullRequestWatchCreate(
  credential: DashboardCredential | null,
  bodyText: string,
  deps: SelfPullRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;

  const body = parseJsonObject(bodyText);
  if (body === null) return { status: 400, body: BAD_BODY };
  const url = typeof body.url === 'string' ? body.url : '';
  const key = githubPullRequestKeyFromUrl(url);
  if (!key) return { status: 400, body: BAD_URL };

  const owner = { agentId: caller.agentId, agentKind: caller.agentKind };
  const [owned, all] = await Promise.all([listPullRequestWatches(owner), listPullRequestWatches()]);
  const existing = owned.find((watch) => watch.host === key.host && watch.repository === key.repository && watch.number === key.number);
  if (existing) return { status: 200, body: { watch: watchView(existing), created: false } };
  // D-9 caught the duplicate above without a read; these are advisory (a race is still caught atomically below).
  if (owned.length >= PR_WATCH_LIMIT_PER_OWNER) return { status: 429, body: TOO_MANY_WATCHES };
  if (all.length >= PR_WATCH_LIMIT_TOTAL) return { status: 429, body: WATCH_LIMIT };

  const snapshot = await (deps.readSnapshot ?? readPullRequestSnapshotNow)(key);
  if (!snapshot) return { status: 502, body: READ_FAILED };
  if (snapshot.state === 'merged' || snapshot.state === 'closed') return { status: 409, body: { code: 'pr-finished', state: snapshot.state } };

  const link = await linkBestEffort(caller, key, snapshot);
  const added = await addPullRequestWatch({ ...owner, key, last: baselineFromSnapshot(snapshot) });
  if (!added.ok) return { status: 429, body: added.code === 'owner-limit' ? TOO_MANY_WATCHES : WATCH_LIMIT };

  return {
    status: added.created ? 201 : 200,
    body: { watch: watchView(added.watch), created: added.created, linked: link.linked, ...(link.linkError ? { linkError: link.linkError } : {}) },
  };
}

/** `GET /api/self/pull-request-watches`. */
export async function handlePullRequestWatchList(
  credential: DashboardCredential | null,
  deps: SelfPullRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const watches = await listPullRequestWatches({ agentId: resolved.caller.agentId, agentKind: resolved.caller.agentKind });
  return { status: 200, body: { watches: watches.map(watchView) } };
}

/** `DELETE /api/self/pull-request-watches/:id`. */
export async function handlePullRequestWatchDelete(
  credential: DashboardCredential | null,
  id: string,
  deps: SelfPullRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const removed = await removePullRequestWatch(id, { agentId: resolved.caller.agentId, agentKind: resolved.caller.agentKind });
  return removed ? { status: 200, body: { removed: true, id } } : { status: 404, body: UNKNOWN_WATCH };
}

/** `POST /api/self/pull-requests` `{ ref }` (C-3). */
export async function handleSelfPullRequestLink(
  credential: DashboardCredential | null,
  bodyText: string,
  deps: SelfPullRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const body = parseJsonObject(bodyText);
  if (body === null) return { status: 400, body: BAD_BODY };
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const name = conversationNameForCaller(resolved.caller);
  if (!name) return { status: 404, body: NO_CONVERSATION };
  const result = await linkPullRequestToConversation(name, ref, 'agent', {
    refreshLink: async (link) => {
      await refreshPullRequestLinkNow(link);
      invalidateConversationListEnrichmentCache();
    },
  });
  if (result.ok) invalidateConversationListEnrichmentCache();
  return { status: result.status, body: result.body };
}

export function makeSelfPullRequestsRouteLayer(deps: SelfPullRequestsRouteDeps = {}) {
  const createWatchRoute = HttpRouter.add(
    'POST',
    '/api/self/pull-request-watches',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bodyText = yield* request.text;
      const result = yield* Effect.promise(() => handlePullRequestWatchCreate(resolveRequestCredential(request), bodyText, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const listWatchesRoute = HttpRouter.add(
    'GET',
    '/api/self/pull-request-watches',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const result = yield* Effect.promise(() => handlePullRequestWatchList(resolveRequestCredential(request), deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const deleteWatchRoute = HttpRouter.add(
    'DELETE',
    '/api/self/pull-request-watches/:id',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const id = decodeURIComponent(params['id'] ?? '');
      const result = yield* Effect.promise(() => handlePullRequestWatchDelete(resolveRequestCredential(request), id, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const linkRoute = HttpRouter.add(
    'POST',
    '/api/self/pull-requests',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bodyText = yield* request.text;
      const result = yield* Effect.promise(() => handleSelfPullRequestLink(resolveRequestCredential(request), bodyText, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(createWatchRoute, listWatchesRoute, deleteWatchRoute, linkRoute);
}

export const selfPullRequestsRouteLayer = makeSelfPullRequestsRouteLayer();
