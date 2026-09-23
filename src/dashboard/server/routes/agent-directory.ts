/**
 * `GET /api/agent-directory?windowHours=<1..168>` (PAN-3920 W4).
 *
 * Serves the Agents Directory read model: every agent, conversation and
 * subagent the dashboard can show, recomputed on read (memoized 3 s) and never
 * stored. See services/agent-directory.ts.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import {
  DIRECTORY_DEFAULT_WINDOW_HOURS,
  DIRECTORY_MAX_WINDOW_HOURS,
  getAgentDirectory,
} from '../services/agent-directory.js';
import { validateOrigin } from './origin-validation.js';

export const WINDOW_HOURS_ERROR = `windowHours must be an integer from 1 to ${DIRECTORY_MAX_WINDOW_HOURS}`;

/** `null` param → the default window; anything but an integer 1–168 → null (400). */
export function parseWindowHours(raw: string | null): number | null {
  if (raw === null) return DIRECTORY_DEFAULT_WINDOW_HOURS;
  if (!/^\d+$/.test(raw)) return null;
  const hours = Number.parseInt(raw, 10);
  return hours >= 1 && hours <= DIRECTORY_MAX_WINDOW_HOURS ? hours : null;
}

const getAgentDirectoryRoute = HttpRouter.add(
  'GET',
  '/api/agent-directory',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const url = new URL(request.url, 'http://localhost');
    const windowHours = parseWindowHours(url.searchParams.get('windowHours'));
    if (windowHours === null) {
      return jsonResponse({ error: WINDOW_HOURS_ERROR }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await getAgentDirectory(windowHours));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[agent-directory] build failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);

export const agentDirectoryRouteLayer = Layer.mergeAll(getAgentDirectoryRoute);
