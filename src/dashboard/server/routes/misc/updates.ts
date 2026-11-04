import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import type { FleetInstallMode } from '@overdeck/contracts';

import { isRuntimePackageRoot } from '../../../../lib/anywhere/connect-runtime.js';
import { getOverdeckHome, packageRoot } from '../../../../lib/paths.js';
import { UpdateManager } from '../../../../lib/update-manager.js';
import { jsonResponse } from '../../http-helpers.js';
import { overdeckDevMode, readPackageVersion } from './shared.js';

/**
 * How Overdeck is installed on this machine (PAN-4654): the desktop app's
 * embedded server, a repository checkout, or a global npm install. A
 * `pan connect` runtime also reports `npm-global`; `connectRuntimeHome()`
 * tells the two apart for the install (PAN-4722).
 */
export function currentInstallMode(): FleetInstallMode {
  if (process.env.OVERDECK_MODE === 'desktop') return 'desktop';
  return overdeckDevMode ? 'development' : 'npm-global';
}

/** The OVERDECK_HOME whose `pan connect` runtime this dashboard runs from, or null (PAN-4722). */
export function connectRuntimeHome(root: string = packageRoot, overdeckHome: string = getOverdeckHome()): string | null {
  return isRuntimePackageRoot(root, overdeckHome) ? overdeckHome : null;
}

let managerPromise: Promise<UpdateManager> | null = null;

/** The dashboard's one UpdateManager: the update routes and the fleet update job share it (PAN-4654 D-8). */
export async function getUpdateManager(): Promise<UpdateManager> {
  managerPromise ??= readPackageVersion().then((currentVersion) => new UpdateManager({
    currentVersion,
    installMode: overdeckDevMode ? 'development' : 'npm-global',
    runtimeHome: connectRuntimeHome(),
  }));
  return managerPromise;
}

const getUpdateStatusRoute = HttpRouter.add(
  'GET',
  '/api/update/status',
  Effect.promise(async () => jsonResponse((await getUpdateManager()).getSnapshot())),
);

const postUpdateCheckRoute = HttpRouter.add(
  'POST',
  '/api/update/check',
  Effect.promise(async () => jsonResponse(await (await getUpdateManager()).check())),
);

const postUpdateInstallRoute = HttpRouter.add(
  'POST',
  '/api/update/install',
  Effect.promise(async () => jsonResponse((await getUpdateManager()).install(), { status: 202 })),
);

export const updatesRouteLayer = Layer.mergeAll(
  getUpdateStatusRoute,
  postUpdateCheckRoute,
  postUpdateInstallRoute,
);
