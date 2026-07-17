import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import type { WeightedSubstrateBug } from '../../../lib/overdeck/substrate-bug-weights-service.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';
import { parseFlywheelStatsWindow } from '../services/flywheel-telemetry.js';

const DEFAULT_WINDOW = '30d';
const MAX_WINDOW = '365d';
const MAX_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseWindow(value: string | null | undefined): string {
  if (!value) return DEFAULT_WINDOW;
  try {
    const parsed = parseFlywheelStatsWindow(value);
    return parsed.ms > MAX_WINDOW_MS ? MAX_WINDOW : parsed.input;
  } catch {
    return DEFAULT_WINDOW;
  }
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
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const params = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => ({} as URLSearchParams),
      onSome: (url) => url.searchParams,
    }));
    const window = parseWindow(params.get('window'));
    const limit = parseLimit(params.get('limit'));
    const offset = parseOffset(params.get('offset'));
    const rows = yield* Effect.promise(() => runDashboardDbJob<WeightedSubstrateBug[]>(
      'listSubstrateBugWeights',
      { window, limit, offset },
    ));
    return jsonResponse(rows);
  })),
);
