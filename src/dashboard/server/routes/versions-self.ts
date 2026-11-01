/**
 * GET /api/versions/self — this machine's version report (PAN-4654 FR-3).
 *
 * Overdeck version, install mode, link protocol, one entry per installed
 * harness CLI with its version and update plan, and the current update job.
 * A linked machine reads it over its channel with the `read:state` scope row;
 * the fleet table on the viewing machine joins it with its own report.
 * `?refresh=1` bypasses the 60 s `--version` cache.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { type FleetUpdateJob, type HarnessVersionView, LINK_PROTOCOL_VERSION, type MachineVersionsReport } from '@overdeck/contracts';

import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { listInstalledHarnessClis } from '../../../lib/fleet/harness-versions.js';
import { jsonResponse } from '../http-helpers.js';
import { getOverdeckVersion } from './misc/shared.js';
import { currentInstallMode } from './misc/updates.js';

export interface VersionsReportDeps {
  listHarnessClis: (opts: { refresh: boolean }) => Promise<HarnessVersionView[]>;
  currentJob: () => FleetUpdateJob | null;
}

const defaultDeps: VersionsReportDeps = {
  listHarnessClis: listInstalledHarnessClis,
  currentJob: () => null,
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

export const versionsSelfRouteLayer = getVersionsSelfRoute;
