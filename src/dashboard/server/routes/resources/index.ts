import { Layer } from 'effect';

import {
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  getContainerLogsRoute,
} from './containers.js';
import {
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
} from './prune.js';
import { getResourcesRoute } from './snapshot.js';

export const resourcesRouteLayer = Layer.mergeAll(
  getResourcesRoute,
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  getContainerLogsRoute,
);

export default resourcesRouteLayer;
