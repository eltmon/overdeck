/**
 * The lanes API (.pan/drafts/pan-4223.md WI-5 step 3): the HTTP door of the
 * lane core. `pan lane start` calls `POST /api/lanes`, so there is one creation
 * path (FR-2). Every handler checks the Origin first, like routes/conversations.ts.
 *
 * - `POST /api/lanes` → `launchLane(body)`; 201 with the LaneLaunchResult, a
 *   LaneLaunchError maps to its status with `{ error }`.
 * - `GET /api/lanes?run=&parent=&key=&role=` → `{ generatedAt, lanes }`.
 * - `GET /api/lanes/:name` → one LaneView, or 404 when the name is not a lane.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { launchLane } from '../../../lib/lanes/launch.js';
import { LaneLaunchError, type LaneLaunchRequest } from '../../../lib/lanes/types.js';
import { invalidateLaneViews, listLaneViews, type LaneViewFilter } from '../../../lib/lanes/views.js';
import { getConversationByName, LANE_ROLES, type LaneRole } from '../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const STRING_FIELDS = ['parent', 'run', 'key', 'role', 'project', 'model', 'harness', 'effort', 'brief', 'briefSource', 'title', 'branch', 'from', 'at'] as const;
const BOOLEAN_FIELDS = ['reuse', 'replace'] as const;

/** Validate a POST /api/lanes body into a launch request; the core validates values. */
export function parseLaneLaunchBody(body: unknown): { ok: true; request: LaneLaunchRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const raw = body as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') return { ok: false, error: `${field} must be a string` };
  }
  for (const field of BOOLEAN_FIELDS) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') return { ok: false, error: `${field} must be a boolean` };
  }
  for (const field of ['parent', 'key', 'role', 'brief'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') return { ok: false, error: `${field} is required` };
  }
  return { ok: true, request: raw as unknown as LaneLaunchRequest };
}

function laneFilter(url: URL): LaneViewFilter {
  const filter: LaneViewFilter = {};
  const run = url.searchParams.get('run');
  const parent = url.searchParams.get('parent');
  const key = url.searchParams.get('key');
  const role = url.searchParams.get('role');
  if (run) filter.run = run;
  if (parent) filter.parentName = parent.startsWith('conv-') ? parent.slice('conv-'.length) : parent;
  if (key) filter.key = key;
  if (role && (LANE_ROLES as readonly string[]).includes(role)) filter.role = role as LaneRole;
  return filter;
}

function errorResponse(error: unknown, context: string) {
  if (error instanceof LaneLaunchError) return jsonResponse({ error: error.message }, { status: error.status });
  console.error(`[lanes] ${context} failed:`, error instanceof Error ? error.message : String(error));
  return jsonResponse({ error: 'Internal server error' }, { status: 500 });
}

const postLaneRoute = HttpRouter.add(
  'POST',
  '/api/lanes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const text = yield* request.text;
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    const parsed = parseLaneLaunchBody(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    return yield* Effect.promise(async () => {
      try {
        const result = await launchLane(parsed.request);
        invalidateLaneViews();
        return jsonResponse(result, { status: 201 });
      } catch (error: unknown) {
        return errorResponse(error, 'launch');
      }
    });
  }),
);

const listLanesRoute = HttpRouter.add(
  'GET',
  '/api/lanes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const filter = laneFilter(new URL(request.url, 'http://localhost'));
    return yield* Effect.promise(async () => {
      try {
        const lanes = await listLaneViews(filter);
        return jsonResponse({ generatedAt: new Date().toISOString(), lanes });
      } catch (error: unknown) {
        return errorResponse(error, 'list');
      }
    });
  }),
);

const getLaneRoute = HttpRouter.add(
  'GET',
  '/api/lanes/:name',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const rawName = params['name'] ?? '';
    const name = rawName.startsWith('conv-') ? rawName.slice('conv-'.length) : rawName;
    return yield* Effect.promise(async () => {
      try {
        const row = getConversationByName(name);
        if (!row?.gauntletRun || !row.laneKey || !row.laneRole) {
          return jsonResponse({ error: `${rawName} is not a lane` }, { status: 404 });
        }
        const lanes = await listLaneViews({ run: row.gauntletRun, key: row.laneKey, role: row.laneRole });
        const lane = lanes.find((view) => view.name === name);
        return lane ? jsonResponse(lane) : jsonResponse({ error: `${rawName} is not a lane` }, { status: 404 });
      } catch (error: unknown) {
        return errorResponse(error, 'get');
      }
    });
  }),
);

export const lanesRouteLayer = Layer.mergeAll(postLaneRoute, listLanesRoute, getLaneRoute);
