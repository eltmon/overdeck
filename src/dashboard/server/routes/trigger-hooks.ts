/**
 * Trigger delivery route — Effect HttpRouter.Layer (PAN-4648 W-5).
 *
 * POST /hooks/:id/:secret
 *   Receives one webhook event for a trigger. The path is outside `/api`, so
 *   the remote request gate asks for no credential: the URL secret is the
 *   authorization. It is also the only dashboard path a Tailscale Funnel
 *   request may reach (remote-request-gate.ts).
 *
 *   The body is read as raw bytes (never `request.text`, which decodes and
 *   re-encodes) so signatures verify over the exact bytes sent. Requests over
 *   1 MiB get 413, by Content-Length before reading and by byte length after.
 *   Everything else is `deliverTriggerEvent` in `src/lib/triggers/deliver.ts`;
 *   this module only builds its dependencies from the conversation doors.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import { assessCpuPressure } from '../../../lib/cloister/cpu-pressure.js';
import { handleConversationMessage } from '../../../lib/overdeck/conversation-message.js';
import { generateAiTitle, getConversationRead } from '../../../lib/overdeck/conversation-reads.js';
import { handleConversationCreate } from '../../../lib/overdeck/conversation-runtime.js';
import { deliverTriggerEvent, type TriggerDeliveryDeps } from '../../../lib/triggers/deliver.js';
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

const postTriggerHookRoute = HttpRouter.add(
  'POST',
  '/hooks/:id/:secret',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = lowerCaseHeaders(request.headers as RequestHeaders);
    if (contentLengthTooLarge(headers)) return tooLarge();
    const params = yield* HttpRouter.params;
    const bytes = yield* request.arrayBuffer.pipe(Effect.orElseSucceed(() => null));
    if (bytes === null) return jsonResponse({ error: 'could not read event body' }, { status: 400 });
    return yield* Effect.promise(() => runTriggerHook({ id: params['id'], secret: params['secret'] }, headers, Buffer.from(bytes)));
  })),
);

export const triggerHooksRouteLayer = postTriggerHookRoute;
