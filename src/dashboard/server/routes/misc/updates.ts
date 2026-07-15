import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { UpdateManager } from '../../../../lib/update-manager.js';
import { jsonResponse } from '../../http-helpers.js';
import { overdeckDevMode, readPackageVersion } from './shared.js';

let managerPromise: Promise<UpdateManager> | null = null;

async function getManager(): Promise<UpdateManager> {
  managerPromise ??= readPackageVersion().then((currentVersion) => new UpdateManager({
    currentVersion,
    installMode: overdeckDevMode ? 'development' : 'npm',
  }));
  return managerPromise;
}

const getUpdateStatusRoute = HttpRouter.add(
  'GET',
  '/api/update/status',
  Effect.promise(async () => jsonResponse((await getManager()).getSnapshot())),
);

const postUpdateCheckRoute = HttpRouter.add(
  'POST',
  '/api/update/check',
  Effect.promise(async () => jsonResponse(await (await getManager()).check({ forceRefresh: true }))),
);

const postUpdateInstallRoute = HttpRouter.add(
  'POST',
  '/api/update/install',
  Effect.promise(async () => jsonResponse((await getManager()).install(), { status: 202 })),
);

export const updatesRouteLayer = Layer.mergeAll(
  getUpdateStatusRoute,
  postUpdateCheckRoute,
  postUpdateInstallRoute,
);
