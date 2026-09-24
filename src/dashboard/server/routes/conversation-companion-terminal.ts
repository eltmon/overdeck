/**
 * Companion terminal routes (PAN-3974).
 *
 *   POST /api/conversations/:name/companion-terminal/open   body: {}
 *   POST /api/conversations/:name/companion-terminal/close  body: { generation }
 *
 * Both are dashboard mutations: `rejectUnsafeDashboardMutationRequest` requires
 * dashboard auth, a JSON body, a trusted Origin, and the CSRF header. The
 * caller names only the conversation. Everything that decides what runs — the
 * owner session, cwd, server port, session id, binary, and companion session
 * name — is resolved server-side from the conversation record and the files
 * its runtime recorded. Any other body key or any query parameter is rejected
 * as target injection before the lifecycle runs.
 *
 * The response body is a `CompanionTerminalState`; the browser streams an
 * attached companion through `/ws/terminal?session=<sessionName>` like any
 * other terminal. Opening never touches the owner conversation.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import {
  COMPANION_TERMINAL_CLOSE_BODY_KEYS,
  COMPANION_TERMINAL_OPEN_BODY_KEYS,
  type CompanionTerminalState,
} from '@overdeck/contracts';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import {
  getCompanionTerminalLifecycle,
  type CompanionCloseOutcome,
  type CompanionOwner,
} from '../../../lib/overdeck/companion-terminal/index.js';

type ParsedBody =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/** Parse a mutation body, rejecting anything outside `allowedKeys`. */
export function parseCompanionBody(
  text: string,
  requestUrl: string,
  allowedKeys: ReadonlyArray<string>,
): ParsedBody {
  const url = new URL(requestUrl, 'http://localhost');
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.length > 0) {
    return { ok: false, error: `Unexpected query parameter: ${queryKeys[0]}. The server resolves the terminal target.` };
  }
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Body must be a JSON object' };
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const body = parsed as Record<string, unknown>;
  const extra = Object.keys(body).find((key) => !allowedKeys.includes(key));
  if (extra !== undefined) {
    return { ok: false, error: `Unexpected field: ${extra}. The server resolves the terminal target.` };
  }
  return { ok: true, body };
}

function ownerFor(name: string): CompanionOwner | null {
  const conv = getConversationByName(name);
  if (!conv) return null;
  return {
    conversationName: conv.name,
    ownerSession: conv.tmuxSession,
    cwd: conv.cwd,
    harness: conv.harness ?? null,
  };
}

function stateStatus(state: CompanionTerminalState | CompanionCloseOutcome): number {
  if (state.status === 'stale-generation') return 409;
  if (state.status !== 'unavailable') return 200;
  if (state.reason === 'unsupported') return 400;
  if (state.reason === 'owner-changed') return 409;
  return 200;
}

async function runLifecycle(
  work: () => Promise<CompanionTerminalState | CompanionCloseOutcome>,
  label: string,
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const state = await work();
    return jsonResponse(state, { status: stateStatus(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[companion-terminal] ${label} failed: ${message}`);
    return jsonResponse({ error: `Could not ${label} the terminal: ${message}` }, { status: 500 });
  }
}

const postCompanionTerminalOpenRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/companion-terminal/open',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const parsed = parseCompanionBody(yield* request.text, request.url, COMPANION_TERMINAL_OPEN_BODY_KEYS);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const owner = ownerFor(params['name'] ?? '');
    if (!owner) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    return yield* Effect.promise(() => runLifecycle(() => getCompanionTerminalLifecycle().open(owner), 'open'));
  }),
);

const postCompanionTerminalCloseRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/companion-terminal/close',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const parsed = parseCompanionBody(yield* request.text, request.url, COMPANION_TERMINAL_CLOSE_BODY_KEYS);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const generation = parsed.body['generation'];
    if (typeof generation !== 'string' || !/^[a-f0-9]{24}$/.test(generation)) {
      return jsonResponse({ error: 'generation is required' }, { status: 400 });
    }
    const owner = ownerFor(params['name'] ?? '');
    if (!owner) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    return yield* Effect.promise(() => runLifecycle(() => getCompanionTerminalLifecycle().close(owner, generation), 'close'));
  }),
);

export const conversationCompanionTerminalRouteLayer = Layer.mergeAll(
  postCompanionTerminalOpenRoute,
  postCompanionTerminalCloseRoute,
);

export default conversationCompanionTerminalRouteLayer;
