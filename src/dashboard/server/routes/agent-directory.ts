/**
 * `GET /api/agent-directory?windowHours=<1..168>` (PAN-3920 W4) and
 * `GET /api/agent-directory?scope=live` (PAN-4197).
 *
 * Serves the Agents Directory read model: every agent, conversation and
 * subagent the dashboard can show, recomputed on read (memoized 3 s) and never
 * stored. With no `scope` it answers the time window; `scope=live` answers
 * what is running or waiting now and ignores `windowHours`; any other `scope`
 * is a 400. See services/agent-directory.ts.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import type { DirectoryScope } from '@overdeck/contracts';

import { jsonResponse } from '../http-helpers.js';
import {
  DIRECTORY_DEFAULT_WINDOW_HOURS,
  DIRECTORY_MAX_WINDOW_HOURS,
  getAgentDirectory,
  getLiveAgentDirectory,
} from '../services/agent-directory.js';
import { validateOrigin } from './origin-validation.js';

export const WINDOW_HOURS_ERROR = `windowHours must be an integer from 1 to ${DIRECTORY_MAX_WINDOW_HOURS}`;

export const SCOPE_ERROR = 'scope must be "live" when given';

/** `null` param → the window answer; `live` → the live scope; anything else → null (400). */
export function parseDirectoryScope(raw: string | null): DirectoryScope | null {
  if (raw === null) return 'window';
  return raw === 'live' ? 'live' : null;
}

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
    const scope = parseDirectoryScope(url.searchParams.get('scope'));
    if (scope === null) {
      return jsonResponse({ error: SCOPE_ERROR }, { status: 400 });
    }
    const windowHours = scope === 'live' ? 0 : parseWindowHours(url.searchParams.get('windowHours'));
    if (windowHours === null) {
      return jsonResponse({ error: WINDOW_HOURS_ERROR }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await (scope === 'live' ? getLiveAgentDirectory() : getAgentDirectory(windowHours)));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[agent-directory] build failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);

export const agentDirectoryRouteLayer = Layer.mergeAll(getAgentDirectoryRoute);
