import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { listSubstrateBugWeights } from '../../../lib/overdeck/substrate-bug-weights-service.js';

const VALID_WINDOWS = ['7d', '30d', '90d', '365d'] as const;
const DEFAULT_WINDOW = '30d';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampWindow(value: string | null | undefined): typeof VALID_WINDOWS[number] {
  if (value && (VALID_WINDOWS as readonly string[]).includes(value)) return value as typeof VALID_WINDOWS[number];
  return DEFAULT_WINDOW;
}

function parseLimit(value: string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export const getSubstrateBugWeightsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/substrate-bug-weights',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => ({} as URLSearchParams),
      onSome: (url) => url.searchParams,
    }));
    const window = clampWindow(params.get('window'));
    const limit = parseLimit(params.get('limit'));
    const offset = parseOffset(params.get('offset'));
    const rows = yield* Effect.promise(() => listSubstrateBugWeights(window, { limit, offset }));
    return jsonResponse(rows);
  })),
);
