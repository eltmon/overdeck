/**
 * The fleet table and Update all (PAN-4654 FR-4, FR-5, D-3, D-11, D-12).
 *
 * GET /api/machines/versions — one row per machine: this machine first, then
 * every outbound link in link-store order. Online links are asked for their
 * version report in parallel; a `404`, or the older gate's `403 insufficient_scope
 * (admin)`, means the peer predates fleet updates.
 *
 * POST /api/machines/update `{ mode?, environmentIds?, cancel? }` — sends one
 * start (or cancel) request to each online linked machine, then starts this
 * machine's job last, and answers with what started and what was skipped. The
 * viewing machine keeps no fleet state: each machine's job lives on that
 * machine and comes back in its report.
 *
 * Both routes keep the default `admin` scope and refuse any request that
 * arrives through a secure channel (no chained hops, FR-4 of PAN-4645).
 */
import { Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import {
  type FleetUpdateJob,
  FleetUpdateJobSchema,
  type FleetUpdateMode,
  type FleetUpdateResponse,
  type FleetVersionRow,
  type FleetVersionsResponse,
  MachineVersionsReportSchema,
  type MachineVersionsReport,
  overdeckInstallCommand,
} from '@overdeck/contracts';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { hostsMachineLinks } from '../../../lib/boot-gates.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { type FleetUpdateService, fleetUpdateService } from '../services/fleet-update-service.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getOverdeckVersion } from './misc/shared.js';
import { buildVersionsReport } from './versions-self.js';

/** A linked machine gets this long to answer for the fleet table (NFR-2). */
export const PEER_REPORT_TIMEOUT_MS = 2_500;
/** A start request detects the peer's CLIs before it answers, so it gets longer. */
export const PEER_UPDATE_TIMEOUT_MS = 30_000;

type PeerFetch = (
  environmentId: string,
  path: string,
  init: { method?: string; body?: unknown; actor: 'operator'; timeoutMs: number },
) => Promise<{ status: number; json: unknown }>;

export interface FleetDeps {
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  fetchPeer: PeerFetch;
  selfReport: () => Promise<MachineVersionsReport>;
  self: () => Promise<{ environmentId: string; label: string }>;
  localVersion: () => Promise<string>;
  service: Pick<FleetUpdateService, 'start' | 'cancel'>;
  primary: () => boolean;
}

const decodeReport = Schema.decodeUnknownOption(MachineVersionsReportSchema);
const decodeJob = Schema.decodeUnknownOption(FleetUpdateJobSchema);

function errorCode(json: unknown): string | null {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : null;
}

/**
 * D-11: a peer that predates fleet updates. Routing answers `404`, but a machine
 * credential reaches routing only for paths in the peer's scope table; an older
 * peer has no row for `/api/versions/self*`, so its remote request gate answers
 * `403 insufficient_scope (admin)` first. A current peer never does: the report
 * needs `read:state` and the update routes `operate`, which every machine token holds.
 */
function predatesFleetUpdates(status: number, json: unknown): boolean {
  if (status === 404) return true;
  const body = json as { error?: unknown; missingScope?: unknown } | null;
  return status === 403 && body?.error === 'insufficient_scope' && body.missingScope === 'admin';
}

function linkState(link: MachineLink, status: ReturnType<LinkStatusSource['status']>): FleetVersionRow['state'] {
  return link.revokedAt ? 'revoked' : status.state;
}

async function linkRow(link: MachineLink, deps: FleetDeps, localVersion: string): Promise<FleetVersionRow> {
  const live = deps.status(link.id);
  const state = linkState(link, live);
  const row: FleetVersionRow = {
    environmentId: link.environmentId,
    label: link.label,
    self: false,
    state,
    stateDetail: live.stateDetail,
    peerVersion: live.peerVersion,
    report: null,
    updateSupported: false,
    install: null,
    error: null,
  };
  if (state === 'unsupported' && live.unsupported) {
    row.install = { ...live.unsupported, command: overdeckInstallCommand(live.unsupported.version) };
    return row;
  }
  if (state !== 'online') return row;
  try {
    const { status, json } = await deps.fetchPeer(link.environmentId, '/api/versions/self', { actor: 'operator', timeoutMs: PEER_REPORT_TIMEOUT_MS });
    if (status === 200) {
      const report = decodeReport(json);
      if (Option.isNone(report)) return { ...row, error: `${link.label} sent a version report this machine cannot read` };
      return { ...row, report: report.value as MachineVersionsReport, updateSupported: true };
    }
    if (predatesFleetUpdates(status, json)) {
      // D-11: no capability flag; the peer predates fleet updates.
      return {
        ...row,
        install: { version: localVersion, on: 'peer', command: overdeckInstallCommand(localVersion) },
        error: `Overdeck ${live.peerVersion ?? '(unknown version)'} on ${link.label} predates fleet updates. Install ${localVersion}: ${overdeckInstallCommand(localVersion)}`,
      };
    }
    return { ...row, error: `${link.label} answered ${status}${errorCode(json) ? `: ${errorCode(json)}` : ''}` };
  } catch (error) {
    return { ...row, error: (error as Error).message };
  }
}

export async function buildFleetVersions(deps: FleetDeps): Promise<FleetVersionsResponse> {
  const [links, selfReport, localVersion] = await Promise.all([deps.links(), deps.selfReport(), deps.localVersion()]);
  const selfRow: FleetVersionRow = {
    environmentId: selfReport.environmentId,
    label: selfReport.label,
    self: true,
    state: 'self',
    stateDetail: null,
    peerVersion: selfReport.overdeck.version,
    report: selfReport,
    updateSupported: true,
    install: null,
    error: null,
  };
  const linkRows = await Promise.all(links.map((link) => linkRow(link, deps, localVersion)));
  return { rows: [selfRow, ...linkRows] };
}

export interface FleetUpdateBody {
  mode: FleetUpdateMode;
  environmentIds: string[] | null;
  cancel: boolean;
}

export function parseFleetUpdateBody(text: string): FleetUpdateBody | string {
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      return 'body is not JSON';
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'body must be a JSON object';
  const { mode = 'when-idle', environmentIds, cancel = false } = raw as Record<string, unknown>;
  if (mode !== 'when-idle' && mode !== 'now') return 'mode must be when-idle or now';
  if (environmentIds !== undefined && (!Array.isArray(environmentIds) || !environmentIds.every((id) => typeof id === 'string'))) {
    return 'environmentIds must be an array of environment ids';
  }
  if (typeof cancel !== 'boolean') return 'cancel must be true or false';
  return { mode, environmentIds: environmentIds === undefined ? null : environmentIds as string[], cancel };
}

type Outcome = { started: { environmentId: string; label: string; job: FleetUpdateJob } } | { skipped: { environmentId: string; label: string; reason: string } };

async function updatePeer(link: MachineLink, body: FleetUpdateBody, deps: FleetDeps): Promise<Outcome> {
  const target = { environmentId: link.environmentId, label: link.label };
  const live = deps.status(link.id);
  const state = linkState(link, live);
  if (state !== 'online') {
    const detail = state === 'unsupported' && live.stateDetail ? `: ${live.stateDetail}` : '';
    return { skipped: { ...target, reason: `${link.label} is ${state}${detail}` } };
  }
  try {
    const { status, json } = await deps.fetchPeer(link.environmentId, '/api/versions/self/update', {
      method: body.cancel ? 'DELETE' : 'POST',
      ...(body.cancel ? {} : { body: { mode: body.mode } }),
      actor: 'operator',
      timeoutMs: PEER_UPDATE_TIMEOUT_MS,
    });
    if (status === 200 || status === 202) {
      const job = decodeJob((json as { job?: unknown } | null)?.job);
      if (Option.isSome(job)) return { started: { ...target, job: job.value as FleetUpdateJob } };
      return { skipped: { ...target, reason: `${link.label} answered ${status} without a job` } };
    }
    if (predatesFleetUpdates(status, json)) return { skipped: { ...target, reason: `${link.label} predates fleet updates` } };
    if (status === 403 && errorCode(json) === 'fleet-update-forbidden') {
      return { skipped: { ...target, reason: `${link.label}: this link is agent-fenced; Update all needs an operator-level link` } };
    }
    if (status === 409) return { skipped: { ...target, reason: `${link.label}: ${errorCode(json) ?? 'conflict'}` } };
    return { skipped: { ...target, reason: `${link.label} answered ${status}${errorCode(json) ? `: ${errorCode(json)}` : ''}` } };
  } catch (error) {
    return { skipped: { ...target, reason: `${link.label}: ${(error as Error).message}` } };
  }
}

async function updateSelf(body: FleetUpdateBody, deps: FleetDeps): Promise<Outcome> {
  const target = await deps.self();
  if (!deps.primary()) return { skipped: { ...target, reason: 'not-primary' } };
  if (body.cancel) {
    const job = await deps.service.cancel();
    return job ? { started: { ...target, job } } : { skipped: { ...target, reason: 'not-waiting' } };
  }
  const { outcome, job } = await deps.service.start(body.mode, 'operator');
  return outcome === 'in-progress' ? { skipped: { ...target, reason: 'update-in-progress' } } : { started: { ...target, job } };
}

/** Peers first, in parallel; this machine last (D-12), since its own restart (if any) comes minutes later. */
export async function runFleetUpdate(body: FleetUpdateBody, deps: FleetDeps): Promise<FleetUpdateResponse | { error: string }> {
  const [links, self] = await Promise.all([deps.links(), deps.self()]);
  const known = new Set([self.environmentId, ...links.map((link) => link.environmentId)]);
  const wanted = body.environmentIds === null ? null : new Set(body.environmentIds);
  const unknown = body.environmentIds?.filter((id) => !known.has(id)) ?? [];
  if (unknown.length > 0) return { error: `no machine matches ${unknown.join(', ')}` };

  const peers = links.filter((link) => wanted === null || wanted.has(link.environmentId));
  const outcomes = await Promise.all(peers.map((link) => updatePeer(link, body, deps)));
  if (wanted === null || wanted.has(self.environmentId)) outcomes.push(await updateSelf(body, deps));

  const response: FleetUpdateResponse = { started: [], skipped: [] };
  for (const outcome of outcomes) {
    if ('started' in outcome) response.started.push(outcome.started);
    else response.skipped.push(outcome.skipped);
  }
  return response;
}

const fetchPeer: PeerFetch = async (environmentId, path, { timeoutMs, ...init }) => {
  // AbortController + setTimeout rather than AbortSignal.timeout, so fake timers drive it in tests.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await linkFetch(environmentId, path, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`did not answer within ${timeoutMs / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const fleetDeps = (): FleetDeps => ({
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  fetchPeer,
  selfReport: () => buildVersionsReport({ refresh: false }),
  self: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  localVersion: getOverdeckVersion,
  service: fleetUpdateService(),
  primary: () => hostsMachineLinks(),
});

/** The gate both fleet routes share: no request through a channel, then the usual dashboard auth. */
export function refuseFleetRequest(viaChannel: boolean, authRejection: () => HttpServerResponse.HttpServerResponse | null): HttpServerResponse.HttpServerResponse | null {
  return viaChannel ? jsonResponse({ error: 'a linked machine cannot use the fleet routes here' }, { status: 403 }) : authRejection();
}

const getFleetVersionsRoute = HttpRouter.add(
  'GET',
  '/api/machines/versions',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildFleetVersions(fleetDeps())));
  }),
);

const postFleetUpdateRoute = HttpRouter.add(
  'POST',
  '/api/machines/update',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnsafeDashboardMutationRequest(request));
    if (refused) return refused;
    const body = parseFleetUpdateBody(yield* request.text);
    if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });
    const result = yield* Effect.promise(() => runFleetUpdate(body, fleetDeps()));
    return 'error' in result ? jsonResponse(result, { status: 400 }) : jsonResponse(result);
  }),
);

export const machinesFleetRouteLayer = Layer.mergeAll(getFleetVersionsRoute, postFleetUpdateRoute);
