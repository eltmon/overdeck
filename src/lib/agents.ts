export {
  clearReadySignal,
  isQualifiedAgentId,
  normalizeAgentId,
  resolveAgentTargetSync,
  waitForAgentIdle,
  waitForReadySignal,
} from './agents/identity.js';
export {
  buildDefaultResumeContinueMessage,
  decideChannelsForWorkAgent,
  decideSupervisorForWorkAgent,
  dismissDevChannelsDialog,
  writeChannelsBridgeMcpConfig,
} from './agents/supervisor-channels.js';
export {
  buildCavemanExports,
  buildSpawnEnvForModel,
  determineModel,
  getProviderEnvForModel,
  getProviderExportsForModel,
  getProviderTmuxFlags,
} from './agents/provider-env.js';
export {
  OHMYPI_AGENT_READY_TIMEOUT_SECONDS,
  describeOhmypiSpawnFailure,
  getAgentRuntimeBaseCommand,
  getProviderAuthMode,
  getRoleRuntimeBaseCommand,
  injectPiConversationMemory,
  roleAgentDefinitionPath,
  waitForPromptReady,
} from './agents/runtime-command.js';
export {
  assertWorkspaceStackHealthyForSpawn,
  buildAgentLaunchConfig,
  retrieveSpawnTimeMemoryContext,
  transitionIssueToInProgress,
  transitionIssueToInReview,
  type AgentLaunchConfig,
  type SpawnOptions,
  type SpawnRunOptions,
} from './agents/spawn-prep.js';

export { spawnAgent, spawnRun } from './agents/spawn.js';

export { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync } from './agents/queries.js';
export {
  GOVERNOR_SLOT_PAUSE_REASON_PREFIX,
  SESSION_EXITED_BEFORE_KICKOFF,
  __testInternals,
  clearAgentPaused,
  clearAgentPausedSync,
  clearAgentTroubled,
  clearAgentTroubledSync,
  getAgentDir,
  getAgentState,
  getAgentStateFilePath,
  getAgentStateSync,
  isAgentPaused,
  isAgentTroubled,
  isRole,
  markAgentRunningState,
  markAgentStoppedState,
  markAgentTroubled,
  recordAgentFailure,
  recordAgentFailureSync,
  resetAgentFailureCount,
  saveAgentState,
  saveAgentStateSync,
  setAgentPaused,
  setAgentPausedSync,
  wipeAgentStateDirs,
  writeAgentStateJsonSync,
  type AgentState,
  type Role,
} from './agents/agent-state.js';
export { stopAgentSync, stopAgent } from './agents/termination.js';
export { type ActivityEntry, appendActivity, getActivity, saveSessionId, getSessionId, getLatestSessionIdSync, getLatestSessionId } from './agents/activity.js';
export { type AgentResolution, type AgentRuntimeState, getAgentRuntimeStateSync, getAgentRuntimeState, saveAgentRuntimeState } from './agents/runtime-state.js';
export { deliverAgentMessage, deliverInitialPromptWithRetry, deliverResumeMessageWithTranscriptConfirmation, deliverAgentPermissionDecision, setAgentDeliveryMethod, type DeliveryResult } from './agents/delivery.js';
export { messageAgent } from './agents/messaging.js';

export { buildCompactRecoverySeed, resumeAgent } from './agents/resume.js';

export { autoRecoverAgents, detectCrashedAgents, recoverAgent, restartAgent, type RestartAgentOptions } from './agents/recovery.js';
