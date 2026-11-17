/**
 * Conversation skill routes (PAN-5465 WI-5): add skill packs to a running conversation.
 *
 * - `GET /api/conversations/:name/skills` (`read:conversations`, FR-7) →
 *   `{ conversation, harness, running, skillOverrides }` for the `/clear`
 *   chain head, so the dashboard dialog can preselect current values.
 * - `POST /api/conversations/:name/skills { skills?, packs?, off?, restart? }`
 *   (`operate`, FR-2) → `applyConversationSkills`; answers
 *   `{ outcome, added, warnings }`.
 * - `POST /api/self/skills` (`operate`, FR-8) → the same body for the calling
 *   conversation, taken from its agent token. An agent-kind caller gets 409
 *   `not-a-conversation`; `restart: true` is refused with 400, because a
 *   conversation cannot restart itself mid-turn.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  applyConversationSkills,
  parseSkillApplyBody,
  readConversationSkills,
  type SkillApplyRequest,
} from '../../../lib/overdeck/conversation-skill-apply.js';
import { ConversationSkillFlagError } from '../../../lib/skill-overrides/conversation-flags.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

export const NOT_A_CONVERSATION = {
  code: 'not-a-conversation',
  error: 'add_skills without a conversation works only inside a conversation',
} as const;

export interface ConversationSkillRouteResult {
  status: number;
  body: unknown;
}

/** A body → request, or the 400 answer for it. An empty body is `{}`. */
function parseRequest(raw: unknown): { ok: true; request: SkillApplyRequest } | { ok: false; result: ConversationSkillRouteResult } {
  const body = raw ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) return { ok: false, result: { status: 400, body: { error: 'body must be a JSON object' } } };
  try {
    return { ok: true, request: parseSkillApplyBody(body as Record<string, unknown>) };
  } catch (error) {
    if (error instanceof ConversationSkillFlagError) return { ok: false, result: { status: 400, body: { error: error.message } } };
    throw error;
  }
}

/** `POST /api/conversations/:name/skills`. */
export async function handleConversationSkillsAdd(name: string, raw: unknown): Promise<ConversationSkillRouteResult> {
  const parsed = parseRequest(raw);
  if (!parsed.ok) return parsed.result;
  return applyConversationSkills(name, parsed.request, { self: false });
}

/** `POST /api/self/skills`: the calling conversation, from its token only. */
export async function handleSelfSkillsAdd(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: { caller?: SelfCallerDeps } = {},
): Promise<ConversationSkillRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  if (resolved.caller.agentKind !== 'conversation') return { status: 409, body: NOT_A_CONVERSATION };
  const parsed = parseRequest(raw);
  if (!parsed.ok) return parsed.result;
  return applyConversationSkills(resolved.caller.agentId, parsed.request, { self: true });
}

/** The JSON body of a request; `undefined` when it is not JSON, `null` when empty. */
const readJsonBody = (request: HttpServerRequest.HttpServerRequest) => Effect.gen(function* () {
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return undefined;
  }
});

const getConversationSkillsRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/skills',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const result = yield* Effect.promise(() => readConversationSkills(name));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const addConversationSkillsRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/skills',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody(request);
    if (body === undefined) return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    const result = yield* Effect.promise(() => handleConversationSkillsAdd(name, body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const addSelfSkillsRoute = HttpRouter.add(
  'POST',
  '/api/self/skills',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readJsonBody(request);
    if (body === undefined) return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    const credential = resolveRequestCredential(request);
    const result = yield* Effect.promise(() => handleSelfSkillsAdd(credential, body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

export const conversationSkillRoutes = Layer.mergeAll(
  getConversationSkillsRoute,
  addConversationSkillsRoute,
  addSelfSkillsRoute,
);
