import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { listSubstrateBugWeights } from '../../../lib/overdeck/substrate-bug-weights-service.js';

export const getSubstrateBugWeightsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/substrate-bug-weights',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const window = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => url.searchParams.get('window'),
    }));
    const rows = yield* Effect.promise(() => listSubstrateBugWeights(window ?? '30d'));
    return jsonResponse(rows);
  })),
);
