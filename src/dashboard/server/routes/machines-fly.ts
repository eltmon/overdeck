/**
 * Fly machine route (PAN-4652 WI-13, FR-11, D-13, D-14).
 *
 * `POST /api/machines/fly` `{ projectKey?, message?, harness?, model?, effort?,
 * region?, image? }` starts a Fly VM that runs `pan serve`, links it one way
 * from here, and optionally puts a project and a Claude Code conversation on
 * it (`addFlyMachine`). It answers 201 `{ link, record, conversation? }`.
 * The whole flow runs in this one request (3–10 min with a clone), as
 * `POST /api/machines/ssh` does.
 *
 * Like every operator machines route it refuses requests that arrive through a
 * secure channel, so no linked machine can start Fly VMs on this machine's
 * account. It is not in `route-scopes.ts`, so it needs `admin`.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { FLY_MACHINE_ERROR_STATUS, FlyMachineError } from '../../../lib/anywhere/fly/provision.js';
import { displayPath, enableRemoteInConfigToml, RemoteEnableError } from '../../../lib/remote-enabled.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { addFlyMachine, type AddFlyMachineInput } from '../services/fly-machine-service.js';
import { MachineLinkError } from '../services/machine-link-service.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { ERROR_STATUS, notifyLinksChanged } from './machines.js';

/** The same ceiling as `POST /api/conversations`. */
const MAX_MESSAGE_LENGTH = 50_000;
const STRING_FIELDS = ['projectKey', 'message', 'harness', 'model', 'effort', 'region', 'image'] as const;

export function parseFlyAddBody(text: string): AddFlyMachineInput | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  const input: AddFlyMachineInput = {};
  for (const field of STRING_FIELDS) {
    const raw = body[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return `${field} must be a string`;
    if (raw.trim() === '') return `${field} must not be empty`;
    input[field] = field === 'message' ? raw : raw.trim();
  }
  if (input.message !== undefined && input.message.length > MAX_MESSAGE_LENGTH) {
    return `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`;
  }
  return input;
}

function flyErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof FlyMachineError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: FLY_MACHINE_ERROR_STATUS[error.code] });
  }
  if (error instanceof MachineLinkError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: ERROR_STATUS[error.code] });
  }
  return jsonResponse({ error: 'fly-failed', message: (error as Error).message }, { status: 500 });
}

export const machinesFlyRouteLayer = HttpRouter.add(
  'POST',
  '/api/machines/fly',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot start Fly machines here' }, { status: 403 });
    }
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const input = parseFlyAddBody(yield* request.text);
    if (typeof input === 'string') return jsonResponse({ error: input }, { status: 400 });
    const outcome = yield* Effect.promise(() => addFlyMachine(input, { notifyLinksChanged }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
    if (!outcome.ok) return flyErrorResponse(outcome.error);
    const { link, record, conversation } = outcome.value;
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Added Fly machine "${record.label}" (${record.appName}, ${record.region})${conversation ? ` with conversation ${conversation.name}` : ''}`,
      details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, machineId: record.machineId, projectKey: record.projectKey, docker: record.docker }),
    });
    return jsonResponse({ link, record, ...(conversation ? { conversation } : {}) }, { status: 201 });
  }),
);

/**
 * `POST /api/machines/fly/enable-remote` (PAN-4905): sets `[remote] enabled =
 * true` in config.toml via a targeted line edit, then the Add a Fly machine
 * dialog refetches `GET /api/machines` to re-enable Add. Like
 * `POST /api/machines/fly` it refuses a secure-channel request and is not in
 * `route-scopes.ts` (needs `admin`).
 */
export const machinesFlyEnableRemoteRouteLayer = HttpRouter.add(
  'POST',
  '/api/machines/fly/enable-remote',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot change remote settings here' }, { status: 403 });
    }
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const outcome = yield* Effect.promise(() => enableRemoteInConfigToml().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
    if (!outcome.ok) {
      const error = outcome.error;
      const message = error instanceof RemoteEnableError ? error.message : (error as Error).message;
      return jsonResponse({ error: 'remote-enable-failed', message }, { status: error instanceof RemoteEnableError ? 409 : 500 });
    }
    const { changed, path } = outcome.value;
    const configFile = displayPath(path);
    if (changed) {
      emitActivityEntry({ source: 'dashboard', level: 'info', message: `Turned on remote ([remote] enabled = true in ${configFile})` });
    }
    return jsonResponse({ ok: true, changed, configFile }, { status: 200 });
  }),
);
