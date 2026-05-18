import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { autoPresoSession } from '../../../autopreso/session.js';
import {
  MAX_AUTOPRESO_START_BODY_BYTES,
  readElementLikes,
  validateAutoPresoCanvasElements,
} from '../../../autopreso/limits.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';
import { loadVoiceSettings } from './voice.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTOPRESO_START_BODY_BYTES) {
    return { ok: false as const, error: `AutoPreso start body exceeds ${MAX_AUTOPRESO_START_BODY_BYTES} bytes` };
  }
  const text = yield* request.text;
  if (Buffer.byteLength(text, 'utf8') > MAX_AUTOPRESO_START_BODY_BYTES) {
    return { ok: false as const, error: `AutoPreso start body exceeds ${MAX_AUTOPRESO_START_BODY_BYTES} bytes` };
  }
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: true as const, body: {} };
  }
});

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
}

const startRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const parsed = yield* readJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 413 });
    const elements = readElementLikes(parsed.body);
    const validation = validateAutoPresoCanvasElements(elements);
    if (!validation.ok) return jsonResponse({ error: validation.error }, { status: 413 });
    const settings = yield* Effect.promise(loadVoiceSettings);
    return jsonResponse(autoPresoSession.start(elements, settings));
  })),
);

const backToStagingRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/back-to-staging',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    return jsonResponse(autoPresoSession.backToStaging());
  })),
);

const resetRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/session/reset',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    return jsonResponse(autoPresoSession.reset());
  })),
);

export const autopresoRouteLayer = Layer.mergeAll(
  startRoute,
  backToStagingRoute,
  resetRoute,
);
