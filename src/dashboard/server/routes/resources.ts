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
  postPauseContainerRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  postStopContainerRoute,
  postUnpauseContainerRoute,
  getContainerLogsRoute,
  dockerActionErrorPayload,
  dockerContainerActionEffect,
  resetDockerContainerExecForTests,
  setDockerContainerExecForTests,
} from './resources/containers.js';
export {
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
} from './resources/prune.js';
export {
  enrichContainersWithLimits,
  getMemoryLimitLevel,
  recordContainerOomEventsForTests,
  resetContainerOomEventsForTests,
  type ContainerLimitFields,
  type ContainerLimitInput,
  type ContainerOomEvent,
  type MemoryLimitLevel,
} from './resources/limits.js';
export {
  buildAgentStatsSnapshot,
  getAgentStatsSnapshotEffect,
  parseProcessTable,
  type AgentCostEvent,
  type AgentProcessRecord,
  type AgentResourceRow,
  type AgentSessionRoot,
  type AgentStatsSnapshot,
  type MinimalAgentState,
} from './resources/agents-stats.js';
export {
  buildCoreServices,
  getCoreServicesSnapshot,
  type CoreServiceRow,
  type CoreServicesDeaconStatus,
  type CoreServicesProcess,
} from './resources/core-services.js';
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
