/**
 * Shared Sessions host routes — Effect HttpRouter.Layer (PRD PAN-4473 WI-5).
 *
 * GET    /api/shares                 → 200 { shares: ShareView[] } | 500 share_record_unreadable
 * POST   /api/shares                 → 201 ShareView (new room) | 200 ShareView (already live) | 400 | 404 | 409 | 412 | 429 | 500 | 502
 * POST   /api/shares/:code/commands  → 202 { ok: true } | 400 invalid_command | 404 | 409 share_not_connected
 *                                       | 409 not_controller | unknown_participant (PAN-4478)
 * POST   /api/shares/:code/prompts   → 202 { ok: true, position } | 400 invalid_request | invalid_prompt | too_long
 *                                       | 404 share_not_found | 409 share_not_live | 429 queue_full (PAN-4476)
 *                                       | 409 not_controller (PAN-4478)
 * DELETE /api/shares/:code           → 204 | 404 | 500 | 502
 *
 * The share manager (`services/share-host.ts`) owns the rooms and host sockets; the host token
 * never appears in a response. These stay behind the remote request gate at the default `admin`
 * scope, and every response is `Cache-Control: no-store`.
 */
import type { SendSharePromptRequest, ShareCommand } from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { conversationWriteRefusalBody } from '../../../lib/overdeck/conversation-release.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { normalizeShareCode } from '../../../lib/sharing/share-code.js';
import { jsonResponse } from '../http-helpers.js';
import { getShareManager } from '../services/share-host.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

export { normalizeShareCode };

type Answer = { status: number; json?: unknown };

const MAX_CONVERSATION_NAME = 200;
const COMMAND_TYPES = new Set(['admit', 'kick', 'revoke', 'unrevoke', 'set-contributor', 'set-controller']);

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function respond(answer: Answer): HttpServerResponse.HttpServerResponse {
  if (answer.json === undefined) return noStore(HttpServerResponse.empty({ status: answer.status }));
  return noStore(jsonResponse(answer.json, { status: answer.status }));
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(Effect.map(parseJsonObject), Effect.orElseSucceed(() => null));

/** Validates a browser command; null unless it is one of the share commands. */
export function parseShareCommand(body: Record<string, unknown> | null): ShareCommand | null {
  if (!body || typeof body.type !== 'string' || !COMMAND_TYPES.has(body.type)) return null;
  const githubId = body.githubId;
  if (typeof githubId !== 'number' || !Number.isSafeInteger(githubId) || githubId <= 0) return null;
  const contributor = body.contributor;
  if (contributor !== undefined && typeof contributor !== 'boolean') return null;
  switch (body.type) {
    case 'admit':
      return contributor === undefined ? { type: 'admit', githubId } : { type: 'admit', githubId, contributor };
    case 'set-contributor':
      return contributor === undefined ? null : { type: 'set-contributor', githubId, contributor };
    case 'kick':
    case 'revoke':
    case 'unrevoke':
    case 'set-controller':
      return { type: body.type, githubId };
    default:
      return null;
  }
}

/** Validates a controller send; null unless `text` is a string and `draftGithubId` is absent or a positive id. */
export function parseSendPrompt(body: Record<string, unknown> | null): SendSharePromptRequest | null {
  if (!body || typeof body.text !== 'string') return null;
  const draftGithubId = body.draftGithubId;
  if (draftGithubId === undefined) return { text: body.text };
  if (typeof draftGithubId !== 'number' || !Number.isSafeInteger(draftGithubId) || draftGithubId <= 0) return null;
  return { text: body.text, draftGithubId };
}

export async function listSharesResponse(): Promise<Answer> {
  try {
    return { status: 200, json: { shares: await getShareManager().list() } };
  } catch (error) {
    return { status: 500, json: { error: 'share_record_unreadable', message: (error as Error).message } };
  }
}

export async function createShareFromBody(body: Record<string, unknown> | null): Promise<Answer> {
  const name = body?.conversationName;
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_CONVERSATION_NAME) {
    return { status: 400, json: { error: 'invalid_request', message: 'conversationName must be a non-empty string' } };
  }
  // The frontend's runsHere gate is a convenience; this is the check (D-4). Linked `@<env>/…`
  // conversations are never in the local database, so they are 404 here too.
  const conversation = getConversationByName(name);
  if (!conversation) return { status: 404, json: { error: 'conversation_not_found' } };
  const refusal = conversationWriteRefusalBody(conversation);
  if (refusal) return { status: 409, json: refusal };
  const outcome = await getShareManager().create({ kind: 'conversation', conversationId: name });
  if (outcome.kind === 'error') return { status: outcome.status, json: outcome.body };
  return { status: outcome.kind === 'created' ? 201 : 200, json: outcome.view };
}

export async function commandShareFromBody(rawCode: string, body: Record<string, unknown> | null): Promise<Answer> {
  const command = parseShareCommand(body);
  if (!command) return { status: 400, json: { error: 'invalid_command' } };
  const code = normalizeShareCode(rawCode);
  if (!code) return { status: 404, json: { error: 'share_not_found' } };
  try {
    const result = await getShareManager().command(code, command);
    return { status: result.status, json: result.body };
  } catch (error) {
    return { status: 500, json: { error: 'share_record_unreadable', message: (error as Error).message } };
  }
}

export async function sendPromptFromBody(rawCode: string, body: Record<string, unknown> | null): Promise<Answer> {
  const request = parseSendPrompt(body);
  if (!request) return { status: 400, json: { error: 'invalid_request' } };
  const code = normalizeShareCode(rawCode);
  if (!code) return { status: 404, json: { error: 'share_not_found' } };
  try {
    const result = await getShareManager().sendPrompt(code, request);
    return { status: result.status, json: result.body };
  } catch (error) {
    return { status: 500, json: { error: 'share_record_unreadable', message: (error as Error).message } };
  }
}

export async function endShareByCode(rawCode: string): Promise<Answer> {
  const code = normalizeShareCode(rawCode);
  if (!code) return { status: 404, json: { error: 'share_not_found' } };
  try {
    const result = await getShareManager().end(code);
    return { status: result.status, json: result.body };
  } catch (error) {
    return { status: 500, json: { error: 'share_record_unreadable', message: (error as Error).message } };
  }
}

const listSharesRoute = HttpRouter.add(
  'GET',
  '/api/shares',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    return respond(yield* Effect.promise(() => listSharesResponse()));
  }),
);

const createShareRoute = HttpRouter.add(
  'POST',
  '/api/shares',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const body = yield* readBody(request);
    return respond(yield* Effect.promise(() => createShareFromBody(body)));
  }),
);

const commandShareRoute = HttpRouter.add(
  'POST',
  '/api/shares/:code/commands',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const code = (yield* HttpRouter.params)['code'] ?? '';
    const body = yield* readBody(request);
    return respond(yield* Effect.promise(() => commandShareFromBody(code, body)));
  }),
);

const sendPromptRoute = HttpRouter.add(
  'POST',
  '/api/shares/:code/prompts',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const code = (yield* HttpRouter.params)['code'] ?? '';
    const body = yield* readBody(request);
    return respond(yield* Effect.promise(() => sendPromptFromBody(code, body)));
  }),
);

const endShareRoute = HttpRouter.add(
  'DELETE',
  '/api/shares/:code',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const code = (yield* HttpRouter.params)['code'] ?? '';
    return respond(yield* Effect.promise(() => endShareByCode(code)));
  }),
);

export const sharesRouteLayer = Layer.mergeAll(
  listSharesRoute,
  createShareRoute,
  commandShareRoute,
  sendPromptRoute,
  endShareRoute,
);
