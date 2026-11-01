/**
 * Trigger delivery route — Effect HttpRouter.Layer (PAN-4648 W-5).
 *
 * POST /hooks/:id/:secret
 *   Receives one webhook event for a trigger. The path is outside `/api`, so
 *   the remote request gate asks for no credential: the URL secret is the
 *   authorization. It is also the only dashboard path a Tailscale Funnel
 *   request may reach (remote-request-gate.ts).
 *
 *   Before reading any body byte, the route refuses a Content-Length over
 *   1 MiB with 413 and an unknown id or wrong URL secret with 404, so an
 *   anonymous sender cannot make the dashboard buffer anything. The body is
 *   then read from `request.stream` as raw bytes (never `request.text`, which
 *   decodes and re-encodes), counting as it goes: the read stops and answers
 *   413 as soon as it passes 1 MiB, so a chunked body with no Content-Length
 *   is bounded too.
 *   Everything else is `deliverTriggerEvent` in `src/lib/triggers/deliver.ts`;
 *   this module only builds its dependencies from the conversation doors.
 */

import { Effect, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import { assessCpuPressure } from '../../../lib/cloister/cpu-pressure.js';
import { handleConversationMessage } from '../../../lib/overdeck/conversation-message.js';
import { generateAiTitle, getConversationRead } from '../../../lib/overdeck/conversation-reads.js';
import { handleConversationCreate } from '../../../lib/overdeck/conversation-runtime.js';
import {
  deliverTriggerEvent,
  findTriggerByUrl,
  logTriggerOutcome,
  TRIGGER_NOT_FOUND,
  type TriggerDeliveryDeps,
} from '../../../lib/triggers/deliver.js';
import { listTriggers } from '../../../lib/triggers/store.js';
import { jsonResponse } from '../http-helpers.js';
import { conversationReadDependencies } from './conversations.js';
import { httpHandler } from './http-handler.js';

export const TRIGGER_HOOK_BODY_MAX_BYTES = 1_048_576;

type RequestHeaders = Record<string, string | string[] | undefined>;

const tooLarge = () => jsonResponse({ error: 'event too large' }, { status: 413 });

/** Status and parsed JSON body of a `jsonResponse` value. */
function readJsonResponse(response: HttpServerResponse.HttpServerResponse): { status: number; body: unknown } {
  const raw = (response.body as { body?: unknown } | null)?.body;
  const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : typeof raw === 'string' ? raw : '';
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: null };
  }
}

function lowerCaseHeaders(headers: RequestHeaders): RequestHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

function contentLengthTooLarge(headers: RequestHeaders): boolean {
  const raw = headers['content-length'];
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  return Number.isFinite(value) && value > TRIGGER_HOOK_BODY_MAX_BYTES;
}

const generateTitle = (name: string, message: string) => generateAiTitle(name, message, conversationReadDependencies);

export const triggerDeliveryDependencies: TriggerDeliveryDeps = {
  readTriggers: listTriggers,
  now: () => Date.now(),
  cpuPressure: assessCpuPressure,
  pendingInputKinds: async (conversationName) => {
    const read = await getConversationRead(conversationName, conversationReadDependencies);
    if (read.status === 404) return null;
    const kinds = (read.body as { pendingInputKinds?: unknown } | null)?.pendingInputKinds;
    return Array.isArray(kinds) ? kinds.filter((kind): kind is string => typeof kind === 'string') : [];
  },
  sendMessage: async (conversationName, message) =>
    readJsonResponse(
      await handleConversationMessage(conversationName, { message }, {
        resolveSessionFile: conversationReadDependencies.resolveSessionFile,
        generateAiTitle: generateTitle,
      }),
    ),
  startConversation: async (body) => readJsonResponse(await handleConversationCreate(body, { generateAiTitle: generateTitle })),
};

/**
 * Core route logic, taking params, headers and raw bytes directly so tests
 * need no Effect request mock (mirrors `runWebhookHandler`).
 */
export async function runTriggerHook(
  params: { id?: string; secret?: string },
  headers: RequestHeaders,
  rawBody: Buffer,
  deps: TriggerDeliveryDeps = triggerDeliveryDependencies,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (rawBody.length > TRIGGER_HOOK_BODY_MAX_BYTES) return tooLarge();
  const result = await deliverTriggerEvent(
    { triggerId: params.id ?? '', urlSecret: params.secret ?? '', headers: lowerCaseHeaders(headers), rawBody },
    deps,
  );
  const responseHeaders = result.retryAfterSeconds === undefined ? undefined : { 'Retry-After': String(result.retryAfterSeconds) };
  return jsonResponse(result.body, { status: result.status, ...(responseHeaders ? { headers: responseHeaders } : {}) });
}

const TOO_LARGE = Symbol('too-large');

/**
 * Read the request body, stopping as soon as it passes `maxBytes`. Returns the
 * bytes, `'too-large'`, or `'unreadable'` when the stream fails.
 */
export const readCappedTriggerBody = (
  request: HttpServerRequest.HttpServerRequest,
  maxBytes = TRIGGER_HOOK_BODY_MAX_BYTES,
): Effect.Effect<Buffer | 'too-large' | 'unreadable'> =>
  Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Failing with TOO_LARGE ends the stream at once. (Stream.runForEachWhile is
    // not used: in this Effect version it stops after the first chunk array.)
    yield* Stream.runForEach(request.stream, (chunk) => {
      total += chunk.length;
      if (total > maxBytes) return Effect.fail(TOO_LARGE);
      chunks.push(chunk);
      return Effect.void;
    });
    return Buffer.concat(chunks);
  }).pipe(Effect.catch((error) => Effect.succeed(error === TOO_LARGE ? ('too-large' as const) : ('unreadable' as const))));

const postTriggerHookRoute = HttpRouter.add(
  'POST',
  '/hooks/:id/:secret',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = lowerCaseHeaders(request.headers as RequestHeaders);
    if (contentLengthTooLarge(headers)) return tooLarge();
    const params = yield* HttpRouter.params;
    const url = { triggerId: params['id'] ?? '', urlSecret: params['secret'] ?? '' };
    if (!(yield* Effect.promise(() => findTriggerByUrl(url, triggerDeliveryDependencies)))) {
      logTriggerOutcome(url.triggerId, TRIGGER_NOT_FOUND);
      return jsonResponse(TRIGGER_NOT_FOUND.body, { status: TRIGGER_NOT_FOUND.status });
    }
    const body = yield* readCappedTriggerBody(request);
    if (body === 'too-large') return tooLarge();
    if (body === 'unreadable') return jsonResponse({ error: 'could not read event body' }, { status: 400 });
    return yield* Effect.promise(() => runTriggerHook({ id: url.triggerId, secret: url.urlSecret }, headers, body));
  })),
);

export const triggerHooksRouteLayer = postTriggerHookRoute;
