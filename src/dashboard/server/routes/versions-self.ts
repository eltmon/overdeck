/**
 * This machine's version report and update job (PAN-4654 FR-3, FR-10).
 *
 * GET /api/versions/self — Overdeck version, install mode, link protocol, one
 * entry per installed harness CLI with its version and update plan, and the
 * current update job. A linked machine reads it over its channel with the
 * `read:state` scope row; the fleet table on the viewing machine joins it with
 * its own report. `?refresh=1` bypasses the 60 s `--version` cache.
 *
 * POST /api/versions/self/update `{ mode?: 'when-idle' | 'now' }` starts the
 * update job (or escalates a waiting one); DELETE cancels a waiting job. Both
 * are fenced (D-10): through a channel only an operator-level link acting for
 * the operator may call them; locally the mutation guard applies and a device
 * or token credential needs `admin`. The body never names a version, package
 * or command (NFR-3).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import { type FleetUpdateJob, type FleetUpdateMode, type HarnessVersionView, LINK_PROTOCOL_VERSION, type MachineVersionsReport } from '@overdeck/contracts';

import { listActiveRecordsOfKind, scopeSatisfies } from '../../../lib/access-tokens.js';
import { hostsMachineLinks } from '../../../lib/boot-gates.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { listInstalledHarnessClis } from '../../../lib/fleet/harness-versions.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { type FleetUpdateService, fleetUpdateService } from '../services/fleet-update-service.js';
import { credentialScopes, type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { getOverdeckVersion } from './misc/shared.js';
import { currentInstallMode } from './misc/updates.js';

export interface VersionsReportDeps {
  listHarnessClis: (opts: { refresh: boolean }) => Promise<HarnessVersionView[]>;
  currentJob: () => FleetUpdateJob | null;
}

const defaultDeps: VersionsReportDeps = {
  listHarnessClis: listInstalledHarnessClis,
  currentJob: () => fleetUpdateService().current(),
};

export async function buildVersionsReport(
  opts: { refresh: boolean },
  deps: VersionsReportDeps = defaultDeps,
): Promise<MachineVersionsReport> {
  const [identity, version, harnesses] = await Promise.all([
    ensureEnvironmentIdentity(),
    getOverdeckVersion(),
    deps.listHarnessClis(opts),
  ]);
  return {
    environmentId: identity.environmentId,
    label: identity.label,
    overdeck: { version, installMode: currentInstallMode(), linkProtocol: LINK_PROTOCOL_VERSION },
    harnesses,
    job: deps.currentJob(),
  };
}

const getVersionsSelfRoute = HttpRouter.add(
  'GET',
  '/api/versions/self',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refresh = new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1';
    return yield* Effect.promise(() => buildVersionsReport({ refresh }).then(
      (report) => jsonResponse(report),
      // A corrupt environment-id.json answers 503 naming the file, as GET /api/environment does.
      (error: unknown) => jsonResponse({ error: (error as Error).message }, 503),
    ));
  }),
);

/** What the update handler needs from one HTTP request. */
export interface FleetUpdateRequest {
  method: 'POST' | 'DELETE';
  bodyText: string;
  viaChannel: boolean;
  credential: DashboardCredential | null;
  /** The local mutation guard's answer; only consulted outside a channel. */
  localRejection: HttpServerResponse.HttpServerResponse | null;
}

export interface FleetUpdateRouteDeps {
  service: Pick<FleetUpdateService, 'start' | 'cancel' | 'current'>;
  primary: () => boolean;
  /** The inbound machine token's name (`machine:<label>`), or null. */
  machineName: (tokenId: string) => string | null;
}

const FORBIDDEN = {
  error: 'fleet-update-forbidden',
  message: 'Only an operator-level link acting for the operator may update this machine',
};

/** D-10: who may start, escalate or cancel an update here; null when allowed. */
function rejectFleetUpdate(request: FleetUpdateRequest): HttpServerResponse.HttpServerResponse | null {
  const { credential } = request;
  if (request.viaChannel) {
    const operator = credential?.kind === 'machine' && credential.actor === 'operator' && credential.access === 'operator';
    return operator ? null : jsonResponse(FORBIDDEN, { status: 403 });
  }
  if (request.localRejection) return request.localRejection;
  if (!credential) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if ((credential.kind === 'device' || credential.kind === 'token') && !scopeSatisfies(credentialScopes(credential), 'admin')) {
    return jsonResponse(FORBIDDEN, { status: 403 });
  }
  return null;
}

function parseMode(bodyText: string): FleetUpdateMode | null {
  if (bodyText.trim() === '') return 'when-idle';
  let mode: unknown;
  try {
    mode = (JSON.parse(bodyText) as { mode?: unknown } | null)?.mode;
  } catch {
    return null;
  }
  if (mode === undefined) return 'when-idle';
  return mode === 'when-idle' || mode === 'now' ? mode : null;
}

export async function handleFleetUpdate(request: FleetUpdateRequest, deps: FleetUpdateRouteDeps): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = rejectFleetUpdate(request);
  if (refused) return refused;
  if (!deps.primary()) return jsonResponse({ error: 'not-primary' }, { status: 409 });

  if (request.method === 'DELETE') {
    const job = await deps.service.cancel();
    return job ? jsonResponse({ job }) : jsonResponse({ error: 'not-waiting', job: deps.service.current() }, { status: 409 });
  }

  const mode = parseMode(request.bodyText);
  if (!mode) return jsonResponse({ error: 'mode must be when-idle or now' }, { status: 400 });
  const { credential } = request;
  const requestedBy = credential?.kind === 'machine'
    ? deps.machineName(credential.tokenId) ?? `machine:${credential.environmentId}`
    : 'operator';
  const { outcome, job } = await deps.service.start(mode, requestedBy);
  if (outcome === 'started') return jsonResponse({ job }, { status: 202 });
  if (outcome === 'escalated') return jsonResponse({ job });
  return jsonResponse({ error: 'update-in-progress', job }, { status: 409 });
}

const routeDeps = (): FleetUpdateRouteDeps => ({
  service: fleetUpdateService(),
  primary: () => hostsMachineLinks(),
  machineName: (tokenId) => listActiveRecordsOfKind('machine').find((record) => record.id === tokenId)?.name ?? null,
});

function updateRoute(method: 'POST' | 'DELETE') {
  return HttpRouter.add(
    method,
    '/api/versions/self/update',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const viaChannel = channelOfRequest(request) !== null;
      const fleetRequest: FleetUpdateRequest = {
        method,
        bodyText: method === 'POST' ? yield* request.text : '',
        viaChannel,
        credential: resolveRequestCredential(request),
        localRejection: viaChannel ? null : rejectUnsafeDashboardMutationRequest(request),
      };
      return yield* Effect.promise(() => handleFleetUpdate(fleetRequest, routeDeps()));
    }),
  );
}

export const versionsSelfRouteLayer = Layer.mergeAll(getVersionsSelfRoute, updateRoute('POST'), updateRoute('DELETE'));
