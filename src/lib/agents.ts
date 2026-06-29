import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync, rmSync } from 'fs';
import { mkdir, readFile, readdir, rm, stat as statAsync, writeFile, writeFile as writeFileAsync, mkdir as mkdirAsync, rename as renameAsync } from 'fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR, encodeClaudeProjectDir, sessionFilePath } from './paths.js';
import { getClaudePermissionFlagsStringSync } from './claude-permissions.js';
import { createSessionSync, createSession, killSessionSync, killSession, sendKeys, sessionExistsSync, sessionExists, listSessions, listSessionsSync, capturePaneSync, capturePane, listPaneValuesSync, listPaneValues, isPaneDead, setOption, exactPaneTarget } from './tmux.js';
import { initHookSync, checkHookSync, generateFixedPointPromptSync } from './hooks.js';
import { findLatestRollout, extractThreadIdFromRollout } from './runtimes/codex.js';
import { getHarnessBehavior } from './runtimes/behavior.js';
import { startWorkSync, completeWorkSync, getAgentCVSync } from './cv.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId, ComplexityLevel } from './settings.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from './providers.js';
import { loadConfigSync as loadYamlConfig, isTldrEnabledSync } from './config-yaml.js';
import type { RoleEffort } from './config-yaml.js';
import { loadConfigSync } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPathSync, getIssuePrefix, resolveProjectFromIssueSync } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';
import { generateLauncherScriptSync } from './launcher-generator.js';
import { createConversation, getConversationByName, reactivateConversationForSpawn, normalizeHarness } from './overdeck/conversations.js';
import { getOverdeckAgentStateSync, listOverdeckAgentStatesSync, saveOverdeckAgentStateSync } from './overdeck/agent-state-sync.js';
import { readAgentHarnessModelRecordSync, writeAgentHarnessModelRecordSync } from './overdeck/agent-record-sync.js';
import { getRollbackAgentStatePath, readRollbackAgentStateSync, writeRollbackAgentStateSync } from './overdeck/agent-rollback-state.js';
import { workspaceContextFile } from './context-layers/layers.js';
import { ensureSessionContextBriefingFile } from './briefing-freshness.js';
import { logAgentLifecycleSync } from './persistent-logger.js';
import { buildCompactRecoverySeedMessage } from './context-overflow.js';
import { ALLOW_SESSION_ROTATION_ON_RESUME, sessionRotationRefused } from './session-rotation.js';
import { emitActivityEntrySync, emitActivityTtsSync } from './activity-logger.js';
import { writeBridgeTokenSync } from './bridge-token.js';
import { resolveHarness } from './harness-resolve.js';
import { resetPipelineVerdictsForWorkStartSync } from './review-status.js';
import type { RuntimeName } from './runtimes/types.js';
import { piFifoPaths } from './runtimes/pi-fifo.js';
import { ohmypiFifoPaths } from './runtimes/ohmypi-fifo.js';
import { resolveLatestOhmypiSessionId } from './runtimes/ohmypi.js';
import { Effect } from 'effect';
import { FsError, TmuxError } from './errors.js';
import { assertIssueHasBeads, BeadsMissingError } from './beads-query.js';
import { BdTransientFailure } from './bd-process-lock.js';
import { getWorkspaceStackHealth } from './workspace/stack-health.js';
import { normalizeModelOverrideSync, requireModelOverrideSync, shellQuoteModelIdSync } from './model-validation.js';
import { resolveAutoResumeConfigForIssue } from './cloister/auto-resume-config.js';
import { recordFeatureRegistryLifecycle } from './registry/feature-registry-population.js';
import { getFlywheelActiveRunIdSync } from './overdeck/control-settings.js';
import { appendOperatorInterventionEvent } from './operator-interventions.js';
import { captureTranscriptUserRecordSnapshot, hasNewTranscriptUserRecord, type TranscriptUserRecordSnapshot } from './transcript-landing.js';
import { sendGracefulRestartWarning } from './graceful-restart.js';
import type { MemoryIdentity, AgentStatus } from '@overdeck/contracts';
import { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync } from './agents/queries.js';
import { stopAgent, stopAgentSync } from './agents/termination.js';
import { getLatestSessionIdSync, saveSessionId } from './agents/activity.js';
import { getAgentRuntimeStateSync, saveAgentRuntimeState, sessionResumeDriftReasons, type AgentRuntimeState } from './agents/runtime-state.js';
import { deliverAgentMessage, deliverResumeMessageWithTranscriptConfirmation, deliverInitialPromptWithRetry, resilientDeliveryMethod, type DeliveryResult } from './agents/delivery.js';
import {
  GOVERNOR_SLOT_PAUSE_REASON_PREFIX,
  SESSION_EXITED_BEFORE_KICKOFF,
  clearAgentPaused,
  clearAgentPausedSync,
  clearAgentTroubled,
  clearAgentTroubledSync,
  getAgentDir,
  getAgentResumeGateBlockReason,
  getAgentState,
  getAgentStateFilePath,
  getAgentStateSync,
  isAgentPaused,
  isAgentTroubled,
  isRole,
  markAgentRunning,
  markAgentRunningState,
  markAgentStoppedState,
  markAgentTroubled,
  recordAgentFailure,
  recordAgentFailureSync,
  recordStartupSessionExit,
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
import {
  clearReadySignal,
  isQualifiedAgentId,
  normalizeAgentId,
  resolveAgentTargetSync,
  waitForAgentIdle,
  waitForReadySignal,
} from './agents/identity.js';
import {
  buildCavemanExports,
  determineModel,
  getProviderEnvForModel,
  getProviderExportsForModel,
} from './agents/provider-env.js';
import {
  claudeSystemPromptFiles,
  getAgentRuntimeBaseCommand,
  getCodexLauncherFields,
  getOhmypiLauncherFields,
  getProviderAuthMode,
  getRoleRuntimeBaseCommand,
  hasAgentRuntimeInSubtree,
  roleAgentDefinitionPath,
  roleSystemPromptInjectionSync,
  waitForPromptReady,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './agents/runtime-command.js';
import {
  buildDefaultResumeContinueMessage,
  buildResumeMessageForAgent,
  decideChannelsForWorkAgent,
  dismissDevChannelsDialog,
  markKickoffRedelivered,
  prepareSupervisorForFreshLaunch,
  prepareSupervisorForRelaunch,
  recordKickoffDeliveryFailure,
  writeChannelsBridgeMcpConfig,
} from './agents/supervisor-channels.js';
import {
  assertWorkspaceStackHealthyForSpawn,
  buildAgentLaunchConfig,
  defaultRunWorkspace,
  flywheelEnvExports,
  resolveFlywheelSpawnEnv,
  runAgentId,
  transitionIssueToInProgress,
  withSpawnTimeMemoryContext,
  type SpawnOptions,
  type SpawnRunOptions,
} from './agents/spawn-prep.js';

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

const execAsync = promisify(exec);


export { spawnAgent, spawnRun } from './agents/spawn.js';

export { listRunningAgentsSync, listAgentStates, listRunningAgents, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync };
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
export { deliverAgentMessage, deliverResumeMessageWithTranscriptConfirmation, deliverAgentPermissionDecision, setAgentDeliveryMethod, type DeliveryResult } from './agents/delivery.js';
export { messageAgent } from './agents/messaging.js';

export { buildCompactRecoverySeed, resumeAgent } from './agents/resume.js';

export { autoRecoverAgents, detectCrashedAgents, recoverAgent, restartAgent, type RestartAgentOptions } from './agents/recovery.js';
