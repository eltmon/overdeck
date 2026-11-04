/**
 * Pull here routes (PAN-4650 WI-9, D-4650-9/10).
 *
 * Owner side, all scope `operate`: only a linked machine's credential with
 * the `operator` actor may call them, and only for itself — a release names
 * the caller's own environment id as `to`, and transfer, undo and complete
 * need the caller to be the machine the conversation was released to.
 *
 *   POST /api/conversations/:name/release            { to, whenTurnRunning }
 *   GET  /api/conversations/:name/release/transfer/:transferId
 *   POST /api/conversations/:name/release/undo
 *   POST /api/conversations/:name/release/complete
 *
 * Local operator (WI-11, D-4650-10), admin: `pan conv reclaim`.
 *
 *   POST /api/conversations/:name/reclaim   { force }
 *
 * Viewer side (WI-10, D-4650-12), admin (no route-scope row): the Pull here job.
 *
 *   POST /api/linked-conversations/pull   { conversation: '@<machine>/<name>', whenTurnRunning }  → 202 { pullId }
 *   GET  /api/linked-conversations/pull/:pullId
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../http-helpers.js';
import { getPull, startPull } from '../services/conversation-pull.js';
import {
  completeRelease,
  readTransferPack,
  reclaimRelease,
  releaseConversation,
  undoRelease,
  type ReleaseServiceDeps,
  type ServiceAnswer,
  type WhenTurnRunning,
} from '../services/conversation-release-service.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

/** The calling machine's environment id, or the refusal. */
function linkedOperator(credential: DashboardCredential | null): { environmentId: string } | ServiceAnswer {
  if (credential?.kind !== 'machine') return { status: 403, body: { error: 'Pull here is for linked machines only' } };
  if (credential.actor !== 'operator') return { status: 403, body: { error: 'Only the operator can pull a conversation', code: 'agent-fenced' } };
  return { environmentId: credential.environmentId };
}

/** The caller, when it is the machine `name` was released to. */
function releasedToCaller(credential: DashboardCredential | null, name: string): { environmentId: string } | ServiceAnswer {
  const caller = linkedOperator(credential);
  if ('status' in caller) return caller;
  const conv = getConversationByName(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  if (conv.releasedTo && conv.releasedTo !== caller.environmentId) {
    return { status: 403, body: { error: 'This conversation was released to another machine' } };
  }
  return caller;
}

export async function handleRelease(
  credential: DashboardCredential | null,
  name: string,
  body: Record<string, unknown>,
  deps: Partial<ReleaseServiceDeps> = {},
): Promise<ServiceAnswer> {
  const caller = linkedOperator(credential);
  if ('status' in caller) return caller;
  if (typeof body['to'] !== 'string' || body['to'] !== caller.environmentId) {
    return { status: 403, body: { error: 'A machine can only pull a conversation to itself' } };
  }
  const when = body['whenTurnRunning'] ?? 'wait';
  if (when !== 'wait' && when !== 'stop') return { status: 400, body: { error: "whenTurnRunning must be 'wait' or 'stop'" } };
  return releaseConversation(name, { to: caller.environmentId, whenTurnRunning: when as WhenTurnRunning }, deps);
}

export async function handleReleaseUndo(credential: DashboardCredential | null, name: string, deps: Partial<ReleaseServiceDeps> = {}): Promise<ServiceAnswer> {
  const caller = releasedToCaller(credential, name);
  return 'status' in caller ? caller : undoRelease(name, deps);
}

export async function handleReleaseComplete(credential: DashboardCredential | null, name: string, deps: Partial<ReleaseServiceDeps> = {}): Promise<ServiceAnswer> {
  const caller = releasedToCaller(credential, name);
  return 'status' in caller ? caller : completeRelease(name, deps);
}

const answer = (result: ServiceAnswer) => jsonResponse(result.body, { status: result.status });

const releaseRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/release',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const name = decodeURIComponent((yield* HttpRouter.params)['name'] ?? '');
    const body = yield* readJsonBody;
    return answer(yield* Effect.promise(() => handleRelease(resolveRequestCredential(request), name, body)));
  }),
);

const transferRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/release/transfer/:transferId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const caller = releasedToCaller(resolveRequestCredential(request), name);
    if ('status' in caller) return answer(caller);
    const pack = yield* Effect.promise(() => readTransferPack(name, params['transferId'] ?? ''));
    if (!pack) return jsonResponse({ error: 'No such transfer', code: 'transfer-not-found' }, { status: 404 });
    return HttpServerResponse.uint8Array(new Uint8Array(pack), { contentType: 'application/octet-stream' });
  }),
);

const undoRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/release/undo',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const name = decodeURIComponent((yield* HttpRouter.params)['name'] ?? '');
    return answer(yield* Effect.promise(() => handleReleaseUndo(resolveRequestCredential(request), name)));
  }),
);

const completeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/release/complete',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const name = decodeURIComponent((yield* HttpRouter.params)['name'] ?? '');
    return answer(yield* Effect.promise(() => handleReleaseComplete(resolveRequestCredential(request), name)));
  }),
);

const reclaimRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/reclaim',
  Effect.gen(function* () {
    const refused = rejectUnsafeDashboardMutationRequest(yield* HttpServerRequest.HttpServerRequest);
    if (refused) return refused;
    const name = decodeURIComponent((yield* HttpRouter.params)['name'] ?? '');
    const body = yield* readJsonBody;
    return answer(yield* Effect.promise(() => reclaimRelease(name, { force: body['force'] === true })));
  }),
);

const startPullRoute = HttpRouter.add(
  'POST',
  '/api/linked-conversations/pull',
  Effect.gen(function* () {
    const refused = rejectUnsafeDashboardMutationRequest(yield* HttpServerRequest.HttpServerRequest);
    if (refused) return refused;
    const body = yield* readJsonBody;
    const when = body['whenTurnRunning'] ?? 'wait';
    if (typeof body['conversation'] !== 'string') return jsonResponse({ error: 'conversation is required' }, { status: 400 });
    if (when !== 'wait' && when !== 'stop') return jsonResponse({ error: "whenTurnRunning must be 'wait' or 'stop'" }, { status: 400 });
    const started = yield* Effect.promise(() => startPull({ conversation: body['conversation'] as string, whenTurnRunning: when as WhenTurnRunning }));
    if (started.status !== 202) return jsonResponse({ error: started.error, code: started.code }, { status: started.status });
    return jsonResponse({ pullId: started.pullId }, { status: 202 });
  }),
);

const getPullRoute = HttpRouter.add(
  'GET',
  '/api/linked-conversations/pull/:pullId',
  Effect.gen(function* () {
    const job = getPull((yield* HttpRouter.params)['pullId'] ?? '');
    if (!job) return jsonResponse({ error: 'No such pull', code: 'pull-not-found' }, { status: 404 });
    return jsonResponse({
      step: job.step,
      state: job.state,
      mode: job.mode,
      ...(job.error ? { error: job.error, code: job.code } : {}),
      ...(job.result ? { conversation: job.result } : {}),
    });
  }),
);

export const conversationPullRouteLayer = Layer.mergeAll(releaseRoute, transferRoute, undoRoute, completeRoute, reclaimRoute, startPullRoute, getPullRoute);
