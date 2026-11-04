/**
 * SSH machine routes (PAN-4404 WI-8, FR-1, FR-9, FR-10).
 *
 * - `POST /api/machines/ssh` `{ host, panPath?, bothWays?, access? }` links the
 *   machine at `host` over SSH (D-4404-3) and answers its link view with an
 *   `ssh` block.
 * - `POST /api/machines/ssh/test` `{ host, panPath? }` runs only the version
 *   probe. Failures are in the body; only `bad-destination` (400) and `busy`
 *   (409) change the status.
 * - `GET /api/machines/ssh/config-hosts` lists the concrete `Host` aliases of
 *   this machine's `~/.ssh/config` as suggestions.
 *
 * Like every operator machines route, they refuse requests that arrive through
 * a secure channel and need the operator credential (D-4404-11). They are not
 * in `route-scopes.ts`, so a machine token can never call them.
 */
import { homedir } from 'node:os';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import type { LinkAccess } from '@overdeck/contracts';

import { MACHINE_ACCESS_LEVELS } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { listSshConfigAliases, nodeSshConfigIo, SshMachineError } from '../../../lib/anywhere/ssh/target.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { MachineLinkError } from '../services/machine-link-service.js';
import { addSshMachine, SSH_MACHINE_ERROR_STATUS, testSshHost } from '../services/ssh-machine-service.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { ERROR_STATUS, notifyLinksChanged } from './machines.js';

interface SshHostBody {
  host: string;
  panPath: string | null;
}

interface SshAddBody extends SshHostBody {
  bothWays: boolean;
  access: LinkAccess;
}

function parseObject(text: string): Record<string, unknown> | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  return value as Record<string, unknown>;
}

function parseHostBody(body: Record<string, unknown>): SshHostBody | string {
  if (typeof body.host !== 'string' || body.host.trim() === '') return 'host must be a non-empty string';
  if (body.panPath !== undefined && body.panPath !== null && typeof body.panPath !== 'string') return 'panPath must be a string';
  const panPath = typeof body.panPath === 'string' && body.panPath.trim() !== '' ? body.panPath.trim() : null;
  return { host: body.host, panPath };
}

export function parseSshAddBody(text: string): SshAddBody | string {
  const body = parseObject(text);
  if (typeof body === 'string') return body;
  const base = parseHostBody(body);
  if (typeof base === 'string') return base;
  if (body.bothWays !== undefined && typeof body.bothWays !== 'boolean') return 'bothWays must be a boolean';
  if (body.access !== undefined && !(MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(body.access)) {
    return `access must be one of ${MACHINE_ACCESS_LEVELS.join(', ')}`;
  }
  return { ...base, bothWays: body.bothWays ?? true, access: (body.access as LinkAccess | undefined) ?? 'operator' };
}

export function parseSshTestBody(text: string): SshHostBody | string {
  const body = parseObject(text);
  return typeof body === 'string' ? body : parseHostBody(body);
}

/** Map a service failure to `{ error, message, detail }` with the status of D-4404-9. */
export function sshErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof SshMachineError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: SSH_MACHINE_ERROR_STATUS[error.code] });
  }
  if (error instanceof MachineLinkError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: ERROR_STATUS[error.code] });
  }
  return jsonResponse({ error: 'ssh-failed', message: (error as Error).message }, { status: 500 });
}

function refuseChannel(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null {
  return channelOfRequest(request) !== null
    ? jsonResponse({ error: 'a linked machine cannot manage SSH machines here' }, { status: 403 })
    : null;
}

function settle<T>(run: () => Promise<T>): Effect.Effect<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return Effect.promise(() => run().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  ));
}

const addRoute = HttpRouter.add(
  'POST',
  '/api/machines/ssh',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const body = parseSshAddBody(yield* request.text);
    if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });
    const outcome = yield* settle(() => addSshMachine(body));
    if (!outcome.ok) return sshErrorResponse(outcome.error);
    const { link, view, record } = outcome.value;
    notifyLinksChanged();
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Added SSH machine "${link.label}" (${record.destination}, ${record.launch})`,
      details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, destination: record.destination, launch: record.launch, access: link.access }),
    });
    return jsonResponse(view);
  }),
);

const testRoute = HttpRouter.add(
  'POST',
  '/api/machines/ssh/test',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const body = parseSshTestBody(yield* request.text);
    if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });
    const outcome = yield* settle(() => testSshHost(body));
    return outcome.ok ? jsonResponse(outcome.value) : sshErrorResponse(outcome.error);
  }),
);

const configHostsRoute = HttpRouter.add(
  'GET',
  '/api/machines/ssh/config-hosts',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    const hosts = yield* Effect.promise(() => listSshConfigAliases(nodeSshConfigIo, homedir()).catch(() => [] as string[]));
    return jsonResponse({ hosts });
  }),
);

export const machinesSshRouteLayer = Layer.mergeAll(addRoute, testRoute, configHostsRoute);
