/**
 * Projects across machines (PAN-4651 FR-4, D-4651-13).
 *
 * `GET /api/fleet/projects` (admin) answers `{ combine, projects }`: one row
 * per git origin slug (case-insensitive) with this machine's project for it
 * (`local`, or null when only other machines have it) and every linked
 * machine that holds it. A local project without a slug is its own row. Linked
 * lists come from the hash-driven cache (`linked-projects-sync.ts`), so this
 * route never calls another machine. Revoked and hidden machines are left out.
 * Like every fleet route it refuses a request that arrives through a channel.
 *
 * Add this project here (D-4651-14), admin like the list:
 * - `GET /api/fleet/projects/source?machine=&projectKey=` → the owner's source
 *   facts and ignored files (for the dialog's file list);
 * - `POST /api/fleet/projects/add-here { machine, projectKey, files, includePreselected?, parentDir? }`
 *   → 202 `{ jobId }`;
 * - `GET /api/fleet/projects/add-jobs/:jobId` → `{ step, error?, projectKey?, files? }`.
 */
import type { FleetProjectRow, FleetProjectsResponse, MachineProject } from '@overdeck/contracts';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { readAnywhereSettings } from '../../../lib/anywhere/anywhere-settings.js';
import { getLink, listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { listMachineProjects } from '../../../lib/anywhere/project-origin.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { addProjectHere, getAddProjectJob, readOwnerSource } from '../services/fleet-add-project.js';
import { currentLinkedProjects } from '../services/linked-projects-sync.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

export interface FleetProjectsDeps {
  combine: () => Promise<boolean>;
  localProjects: () => Promise<MachineProject[]>;
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  linkedProjects: (environmentId: string) => readonly MachineProject[] | null;
}

export const defaultFleetProjectsDeps = (): FleetProjectsDeps => ({
  combine: async () => (await readAnywhereSettings()).combineRepositories,
  localProjects: () => listMachineProjects(),
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  linkedProjects: (environmentId) => currentLinkedProjects()?.projectsFor(environmentId) ?? null,
});

type MutableRow = Omit<FleetProjectRow, 'machines'> & { machines: Array<FleetProjectRow['machines'][number]> };

export async function buildFleetProjects(deps: FleetProjectsDeps = defaultFleetProjectsDeps()): Promise<FleetProjectsResponse> {
  const [combine, local, links] = await Promise.all([deps.combine(), deps.localProjects(), deps.links()]);
  const bySlug = new Map<string, MutableRow>();
  const rows: MutableRow[] = [];
  for (const project of local) {
    if (project.gitOrigin === null) {
      rows.push({ gitOrigin: null, name: project.name, local: { key: project.key }, machines: [] });
      continue;
    }
    const slug = project.gitOrigin.toLowerCase();
    if (bySlug.has(slug)) continue;
    const row: MutableRow = { gitOrigin: project.gitOrigin, name: project.name, local: { key: project.key }, machines: [] };
    bySlug.set(slug, row);
    rows.push(row);
  }
  const remoteOnly: MutableRow[] = [];
  for (const link of links) {
    if (link.revokedAt || link.hidden === true) continue;
    const state = deps.status(link.id).state;
    for (const project of deps.linkedProjects(link.environmentId) ?? []) {
      if (project.gitOrigin === null) continue;
      const slug = project.gitOrigin.toLowerCase();
      let row = bySlug.get(slug);
      if (!row) {
        row = { gitOrigin: project.gitOrigin, name: project.name, local: null, machines: [] };
        bySlug.set(slug, row);
        remoteOnly.push(row);
      }
      if (!row.machines.some((machine) => machine.environmentId === link.environmentId)) {
        row.machines.push({ environmentId: link.environmentId, label: link.label, key: project.key, state });
      }
    }
  }
  remoteOnly.sort((a, b) => a.name.localeCompare(b.name));
  return { combine, projects: [...rows, ...remoteOnly] };
}

const getFleetProjectsRoute = HttpRouter.add(
  'GET',
  '/api/fleet/projects',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildFleetProjects()));
  }),
);

type HttpResponse = ReturnType<typeof jsonResponse>;

/** A link by label, environment id or link id, not revoked; else the 404. */
export async function linkedMachine(machine: unknown): Promise<{ link: MachineLink } | { response: HttpResponse }> {
  const link = typeof machine === 'string' && machine ? await getLink(machine) : null;
  if (!link || link.revokedAt) return { response: jsonResponse({ code: 'unknown-machine', error: `No linked machine is called ${String(machine)}` }, { status: 404 }) };
  return { link };
}

function unreachable(link: MachineLink, error: unknown): HttpResponse {
  return jsonResponse({ code: 'machine-unreachable', error: `${link.label}: ${(error as Error).message}` }, { status: 503 });
}

export async function handleOwnerSource(machine: string, projectKey: string): Promise<HttpResponse> {
  const found = await linkedMachine(machine);
  if ('response' in found) return found.response;
  const { link } = found;
  try {
    const read = await readOwnerSource(link, projectKey);
    return read.ok ? jsonResponse(read.source) : jsonResponse(read.body, { status: read.status });
  } catch (error) {
    return unreachable(link, error);
  }
}

export async function handleAddHere(raw: unknown, add: typeof addProjectHere = addProjectHere): Promise<HttpResponse> {
  const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const found = await linkedMachine(body['machine']);
  if ('response' in found) return found.response;
  const { link } = found;
  const files = body['files'] ?? [];
  if (typeof body['projectKey'] !== 'string' || !Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
    return jsonResponse({ error: 'body must be { machine, projectKey, files: string[], includePreselected?, parentDir? }' }, { status: 400 });
  }
  const parentDir = typeof body['parentDir'] === 'string' && body['parentDir'] ? body['parentDir'] : undefined;
  try {
    const started = await add({ link, projectKey: body['projectKey'], files, includePreselected: body['includePreselected'] === true, ...(parentDir ? { parentDir } : {}) });
    return started.ok ? jsonResponse({ jobId: started.jobId }, { status: 202 }) : jsonResponse(started.body, { status: started.status });
  } catch (error) {
    return unreachable(link, error);
  }
}

const readBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
});

const getOwnerSourceRoute = HttpRouter.add(
  'GET',
  '/api/fleet/projects/source',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    const url = HttpServerRequest.toURL(request);
    const query = Option.isSome(url) ? url.value.searchParams : new URLSearchParams();
    return yield* Effect.promise(() => handleOwnerSource(query.get('machine') ?? '', query.get('projectKey') ?? ''));
  }),
);

const postAddHereRoute = HttpRouter.add(
  'POST',
  '/api/fleet/projects/add-here',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnsafeDashboardMutationRequest(request));
    if (refused) return refused;
    const body = yield* readBody;
    return yield* Effect.promise(() => handleAddHere(body));
  }),
);

const getAddJobRoute = HttpRouter.add(
  'GET',
  '/api/fleet/projects/add-jobs/:jobId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    const job = getAddProjectJob((yield* HttpRouter.params)['jobId'] ?? '');
    return job ? jsonResponse(job) : jsonResponse({ code: 'unknown-job', error: 'Unknown add job' }, { status: 404 });
  }),
);

export const fleetProjectsRouteLayer = Layer.mergeAll(getFleetProjectsRoute, getOwnerSourceRoute, postAddHereRoute, getAddJobRoute);
