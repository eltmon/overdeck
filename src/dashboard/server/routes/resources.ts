/**
 * Resources route barrel — Effect HttpRouter.Layer (PAN-2464 routes-split)
 *
 * Composes all /api/resources/* route layers and preserves the public exports
 * that external callers historically imported from routes/resources.js.
 */

export {
  getDockerStatsCollector,
  resetCurrentDockerStatsReaderForTests,
  setCurrentDockerStatsReaderForTests,
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
  buildHostVitalsSnapshot,
  resetHostVitalsForTests,
  type HostVitalsAgent,
  type HostVitalsAgentFleet,
  type HostVitalsContainer,
  type HostVitalsOptions,
  type HostVitalsSnapshot,
} from './resources/host-vitals.js';
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
  buildCapacityForecast,
  persistStackForecastPeak,
  recordStackForecastSample,
  resetCapacityForecastForTests,
  setForecastStateFileForTests,
  type CapacityForecastPayload,
  type StackForecastRow,
  type StackPeakRecord,
} from './resources/forecast.js';
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
  buildReclaimPayload,
  deleteResourceVenvEffect,
  deleteResourceVenvRoute,
  resetReclaimForTests,
  setReclaimIssueClosedReaderForTests,
  setReclaimProjectRootForTests,
  setReclaimVenvCandidatesForTests,
  setReclaimVenvDeleteForTests,
  type ReclaimAgentLike,
  type ReclaimCandidate,
  type ReclaimPayload,
  type ReclaimVenvCandidate,
} from './resources/reclaim.js';
export {
  getSpawnGatePayloadEffect,
  mapSpawnGateDecision,
  resetSpawnGateHealthSnapshotReaderForTests,
  setSpawnGateHealthSnapshotReaderForTests,
  type SpawnGatePayload,
  type SpawnGateState,
} from './resources/spawn-gate.js';
export {
  buildResourceStacks,
  getResourceStacks,
  resetResourceStackReviewStatusReaderForTests,
  setResourceStackReviewStatusReaderForTests,
  type ResourceStack,
  type ResourceStackPhase,
  type StackContainerResource,
} from './resources/stacks.js';
export {
  dockerStackVerbEffect,
  postPauseStackRoute,
  postStartStackRoute,
  postStopStackRoute,
  resetDockerStackVerbExecForTests,
  setDockerStackVerbExecForTests,
  type StackVerbResult,
} from './resources/stack-verbs.js';
export {
  getStackTeardownEstimateEffect,
  getStackTeardownEstimateRoute,
  postStackTeardownEffect,
  postStackTeardownRoute,
  resetStackTeardownForTests,
  setStackTeardownActivityEmitterForTests,
  setStackTeardownDockerExecForTests,
  setStackTeardownTokenGeneratorForTests,
  type StackTeardownEstimate,
  type StackTeardownInput,
} from './resources/teardown.js';
export {
  resourcesRouteLayer,
  default,
} from './resources/index.js';
