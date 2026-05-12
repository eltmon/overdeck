import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { autoPresoSession, type ExcalidrawElementLike } from '../../../autopreso/session.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

function readElements(body: unknown): readonly ExcalidrawElementLike[] {
  if (!body || typeof body !== 'object' || !('elements' in body)) return [];
  const elements = body.elements;
  return Array.isArray(elements) ? elements.filter((element): element is ExcalidrawElementLike => !!element && typeof element === 'object') : [];
}

const startRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/start',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    return jsonResponse(autoPresoSession.start(readElements(body)));
  })),
);

const backToStagingRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/back-to-staging',
  httpHandler(Effect.sync(() => jsonResponse(autoPresoSession.backToStaging()))),
);

const resetRoute = HttpRouter.add(
  'POST',
  '/api/autopreso/session/reset',
  httpHandler(Effect.sync(() => jsonResponse(autoPresoSession.reset()))),
);

export const autopresoRouteLayer = Layer.mergeAll(
  startRoute,
  backToStagingRoute,
  resetRoute,
);
