/**
 * Resources route barrel — Effect HttpRouter.Layer (PAN-2464 routes-split)
 *
 * Composes all /api/resources/* route layers and preserves the public exports
 * that external callers historically imported from routes/resources.js.
 */

export {
  getDockerStatsCollector,
} from './resources/shared.js';
export {
  getResourcesEffect,
  getResourcesRoute,
} from './resources/snapshot.js';
export {
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  getContainerLogsRoute,
} from './resources/containers.js';
export {
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
} from './resources/prune.js';
export {
  buildHostProcesses,
  getHostProcessesSnapshot,
  resetHostProcessRetention,
  type AgentSessionProcess,
  type HostProcessRecord,
  type HostProcessRow,
  type SpikeAnnotation,
} from './resources/host-processes.js';
export {
  buildResourceHistoryResponse,
  getResourceHistoryEffect,
  getResourceHistoryRoute,
  recordResourceHistorySample,
  resetResourceHistorySamples,
} from './resources/history.js';
export {
  resourcesRouteLayer,
  default,
} from './resources/index.js';
