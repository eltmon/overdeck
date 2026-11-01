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
 */
import type { FleetProjectRow, FleetProjectsResponse, MachineProject } from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { readAnywhereSettings } from '../../../lib/anywhere/anywhere-settings.js';
import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { listMachineProjects } from '../../../lib/anywhere/project-origin.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { currentLinkedProjects } from '../services/linked-projects-sync.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
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

export const fleetProjectsRouteLayer = Layer.mergeAll(getFleetProjectsRoute);
