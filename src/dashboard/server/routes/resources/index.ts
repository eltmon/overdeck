import { Layer } from 'effect';

import {
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postPauseContainerRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  postStopContainerRoute,
  postUnpauseContainerRoute,
  getContainerLogsRoute,
} from './containers.js';
import {
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
} from './prune.js';
import { getResourceHistoryRoute } from './history.js';
import { deleteResourceVenvRoute } from './reclaim.js';
import { getResourcesRoute } from './snapshot.js';
import {
  postPauseStackRoute,
  postStartStackRoute,
  postStopStackRoute,
} from './stack-verbs.js';
import {
  getStackTeardownEstimateRoute,
  postStackTeardownRoute,
} from './teardown.js';

export const resourcesRouteLayer = Layer.mergeAll(
  getResourcesRoute,
  getResourceHistoryRoute,
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  postStopContainerRoute,
  postPauseContainerRoute,
  postUnpauseContainerRoute,
  getContainerLogsRoute,
  deleteResourceVenvRoute,
  postStartStackRoute,
  postStopStackRoute,
  postPauseStackRoute,
  getStackTeardownEstimateRoute,
  postStackTeardownRoute,
);

export default resourcesRouteLayer;
