export {
  clearReadySignal,
  isQualifiedAgentId,
  normalizeAgentId,
  resolveAgentTarget,
  waitForAgentIdle,
  waitForReadySignal,
} from './agents/identity.js';
export {
  buildDefaultResumeContinueMessage,
  buildResumeContinueMessage,
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

export { resolveRoutedSpawnModel } from './agents/routed-spawn-model.js';
export { spawnAgent, spawnRun } from './agents/spawn.js';

export { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync } from './agents/queries.js';
export {
  GOVERNOR_SLOT_PAUSE_REASON_PREFIX,
  SESSION_EXITED_BEFORE_KICKOFF,
  __testInternals,
  clearAgentPaused,
  clearAgentTroubled,
  getAgentDir,
  getAgentStateFilePath,
  getAgentState,
  isAgentPaused,
  isAgentTroubled,
  isRole,
  markAgentRunningState,
  markAgentStoppedState,
  markAgentTroubled,
  recordAgentFailure,
  resetAgentFailureCount,
  saveAgentState,
  saveAgentStateSync,
  setAgentPaused,
  setAgentYielded,
  clearYieldForResume,
  wipeAgentStateDirs,
  writeAgentStateJson,
  type AgentState,
  type AgentStopCause,
  type Role,
} from './agents/agent-state.js';
export { stopAgentSync, stopAgent } from './agents/termination.js';
export { type ActivityEntry, appendActivity, getActivity, saveSessionId, getSessionId, getLatestSessionId } from './agents/activity.js';
export { type AgentResolution, type AgentRuntimeState, getAgentRuntimeStateSync, getAgentRuntimeState, saveAgentRuntimeState } from './agents/runtime-state.js';
export { deliverAgentMessage, deliverInitialPromptWithRetry, deliverResumeMessageWithTranscriptConfirmation, deliverAgentPermissionDecision, setAgentDeliveryMethod, type DeliveryResult } from './agents/delivery.js';
export { messageAgent } from './agents/messaging.js';

export { buildCompactRecoverySeed, resumeAgent } from './agents/resume.js';

export { autoRecoverAgents, detectCrashedAgents, recoverAgent, restartAgent, type RestartAgentOptions } from './agents/recovery.js';
// PAN-3917: tier-replay.ts (standing-tier swarm replay) deleted — it depended
// on agents/slot-reconcile.ts and agents/standing-tiers.ts (Appendix A.5,
// permanently gone) and had no surviving caller outside this barrel and its
// own smoke test. Swarm standing-tiers are dormant in the new architecture.
