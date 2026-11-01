/**
 * Fleet work routes (PAN-4651 D-4651-10, D-4651-12): this machine's browser,
 * CLI and MCP start work on any machine through them. Every fleet route
 * refuses a request that arrives through a secure channel (no chained hops,
 * `refuseFleetRequest`) and then applies the usual dashboard auth.
 *
 * - `POST /api/fleet/placement { gitOrigin: string | null, needs: string[] }`
 *   → Auto placement over this machine and its links: `{ ok: true,
 *   environmentId, label, self, reason, rejections }` or `{ ok: false, rejections }`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { TAG_PATTERN } from '../../../lib/anywhere/machine-capabilities.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { defaultFleetTargetDeps, type FleetTargetDeps, placeAuto } from '../services/fleet-target.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

/** `needs` as a list of capability tags; a comma-separated string is accepted too. */
export function parseNeeds(raw: unknown): string[] | string {
  if (raw === undefined || raw === null) return [];
  const list = typeof raw === 'string' ? raw.split(',') : raw;
  if (!Array.isArray(list) || !list.every((tag) => typeof tag === 'string')) return 'needs must be a list of tags';
  const tags = [...new Set(list.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))];
  const invalid = tags.find((tag) => !TAG_PATTERN.test(tag));
  return invalid === undefined ? tags : `needs: ${JSON.stringify(invalid)} is not a valid tag`;
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

/** `POST /api/fleet/placement`. */
export async function handleFleetPlacement(raw: unknown, deps: FleetTargetDeps = defaultFleetTargetDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const body = asObject(raw) ?? {};
  const gitOrigin = body['gitOrigin'] ?? null;
  if (gitOrigin !== null && typeof gitOrigin !== 'string') return jsonResponse({ error: 'gitOrigin must be a repository slug or null' }, { status: 400 });
  const needs = parseNeeds(body['needs']);
  if (typeof needs === 'string') return jsonResponse({ error: needs }, { status: 400 });
  return jsonResponse(await placeAuto(gitOrigin, needs, deps));
}

export const readFleetBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
});

/** The gate every fleet write route shares: no channel caller, then auth with CSRF for cookies. */
export const fleetWriteGate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnsafeDashboardMutationRequest(request));
});

const placementRoute = HttpRouter.add(
  'POST',
  '/api/fleet/placement',
  Effect.gen(function* () {
    const refused = yield* fleetWriteGate;
    if (refused) return refused;
    const body = yield* readFleetBody;
    return yield* Effect.promise(() => handleFleetPlacement(body));
  }),
);

export const fleetWorkRouteLayer = Layer.mergeAll(placementRoute);
