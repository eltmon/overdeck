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

export interface RestartAgentOptions {
  model?: string;
  harness?: RuntimeName;
  graceful?: boolean;
  message?: string;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message } = opts;
  const newModel = normalizeModelOverrideSync(rawNewModel);

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  const gateBlockReason = getAgentResumeGateBlockReason(agentState);
  if (gateBlockReason) {
    const reason = `Cannot restart ${normalizedId}: ${gateBlockReason}. Clear the gate before restarting.`;
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logAgentLifecycleSync(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'}, harness=${newHarness || 'unchanged'})`);

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  if (graceful && await Effect.runPromise(sessionExists(normalizedId))) {
    await sendGracefulRestartWarning(normalizedId, agentState.harness, agentState.workspace);
  }

  await Effect.runPromise(stopAgent(normalizedId));

  const effectiveModel = newModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
  const effectiveHarness = await resolveHarness({
    explicit: newHarness ?? agentState.harness,
    role: agentState.role,
    model: effectiveModel,
  });
  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.harness = effectiveHarness;
  agentState.status = 'starting';
  saveAgentStateSync(agentState);

  try {
    clearReadySignal(normalizedId);
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, effectiveModel, effectiveHarness);
    saveAgentStateSync(agentState);

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: effectiveModel,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      harness: effectiveHarness,
      useSupervisor: supervisorLaunch.useSupervisor,
      supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await Effect.runPromise(createSession(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        GIT_SEQUENCE_EDITOR: 'false',
        ...providerEnv,
      },
    }));

    const prompt = message || `You are resuming work on ${agentState.issueId}. Read .pan/continue.json for context and pick up where you left off.`;
    if (effectiveHarness === 'ohmypi') {
      // ohmypi does not fire the Claude SessionStart hook and does not read tmux
      // input — wait for ready.json and write the continue prompt through the
      // FIFO JSONL protocol.
      try {
        await writeOhmypiAgentPrompt(normalizedId, prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restartAgent] ohmypi prompt delivery failed for ${normalizedId}: ${msg}`);
      }
    } else {
      const ready = await waitForPromptReady(normalizedId, effectiveHarness, 30);
      if (ready) {
        await new Promise(r => setTimeout(r, 500));
        if (effectiveHarness === 'codex') {
          await deliverAgentMessage(normalizedId, prompt, 'restartAgent:continue-prompt', resilientDeliveryMethod(agentState.deliveryMethod));
        } else {
          await Effect.runPromise(sendKeys(normalizedId, prompt));
        }
      } else {
        console.error(`[restartAgent] ${effectiveHarness === 'codex' ? 'Codex' : 'Claude'} did not become ready within 30s for ${normalizedId}`);
      }
    }

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });

    logAgentLifecycleSync(normalizedId, `restartAgent SUCCESS: model=${effectiveModel}`);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent FAILED: ${msg}`);
    return { success: false, error: `Failed to restart agent: ${msg}` };
  }
}

/**
 * Check whether a tmux session has an active agent runtime.
 * A session may exist with only a bare bash shell after Claude exits.
 */
async function hasAgentRuntimeInSession(sessionName: string, harness: RuntimeName): Promise<boolean> {
  try {
    const panePids = await Effect.runPromise(listPaneValues(sessionName, '#{pane_pid}'));
    if (panePids.length === 0) return false;
    return hasAgentRuntimeInSubtree(panePids[0]!, harness);
  } catch {
    return false;
  }
}

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgentsSync();
  return agents.filter(
    (agent) => agent.status === 'running' && !agent.tmuxActive
  );
}

/**
 * Recover a crashed agent by restarting it with context
 */
export async function recoverAgent(
  agentId: string,
  opts: { modelOverride?: string } = {},
): Promise<AgentState | null> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycleSync(normalizedId, 'recoverAgent called');
  const state = getAgentStateSync(normalizedId);

  if (!state) {
    logAgentLifecycleSync(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const gateBlockReason = getAgentResumeGateBlockReason(state);
  if (gateBlockReason) {
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: Cannot recover ${normalizedId}: ${gateBlockReason}. Clear the gate before recovering.`);
    return null;
  }
  const modelOverride = normalizeModelOverrideSync(opts.modelOverride);
  if (modelOverride) {
    state.model = modelOverride;
    logAgentLifecycleSync(normalizedId, `recoverAgent: model overridden → ${modelOverride}`);
  }
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  const recoveryRole: Role = state.role
    ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work');
  try {
    await assertWorkspaceStackHealthyForSpawn(
      state.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      recoveryRole,
      state.hostOverride === true,
      state.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  // Check if already running — session may exist with only a bare shell
  // after Claude exited (zombie session). Kill it and recover.
  if (sessionExistsSync(normalizedId)) {
    const recoveryHarness: RuntimeName = normalizeHarness(state.harness ?? null) ?? 'claude-code';
    if (await hasAgentRuntimeInSession(normalizedId, recoveryHarness)) {
      return state;
    }
    console.log(`[agents] ${normalizedId} tmux session is a zombie (no ${recoveryHarness} runtime) — killing and recovering`);
    try { killSessionSync(normalizedId); } catch { /* ignore */ }
  }

  // Update crash count in health file
  const healthFile = join(getAgentDir(normalizedId), 'health.json');
  let health = { consecutiveFailures: 0, killCount: 0, recoveryCount: 0 };
  if (existsSync(healthFile)) {
    try {
      health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
    } catch {}
  }
  health.recoveryCount = (health.recoveryCount || 0) + 1;
  writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Build recovery prompt
  const recoveryPrompt = generateRecoveryPrompt(state);

  // Get provider env for the agent's model (reads latest API key from settings)
  const providerEnv = state.model ? await getProviderEnvForModel(state.model) : {};

  // For credential-file providers, ensure apiKeyHelper is configured.
  // For all other providers, clear stale apiKeyHelper from previous runs.
  if (state.model) {
    const provider = getProviderForModelSync(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuthSync(provider, state.workspace);
    } else {
      clearCredentialFileAuthSync(state.workspace);
    }
  }

  // Restart the agent with recovery context. PAN-1048 C4: derive the role from
  // the saved AgentState (or the session-id heuristic for legacy planning-* IDs)
  // and route through getRoleRuntimeBaseCommand so review/test/ship don't get
  // resurrected as work agents.
  const recoveryHarness: RuntimeName = normalizeHarness(state.harness ?? null) ?? 'claude-code';
  const recoverySupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, state, state.model, recoveryHarness);
  saveAgentStateSync(state);

  if (recoveryHarness === 'ohmypi') {
    // PAN-1055: ohmypi cannot consume the recovery prompt as a positional shell
    // argument the way the Claude direct command path does — ohmypi reads JSONL
    // commands from its FIFO. Build a real ohmypi launcher (extension path,
    // --session-dir, FIFO redirect) via buildAgentLaunchConfig, then deliver
    // the recovery prompt through the FIFO once omp reports ready.
    const { launcherContent, providerEnv: piProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      harness: 'ohmypi',
    });
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    await Effect.runPromise(createSession(normalizedId, state.workspace, `bash ${launcherScript}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: state.issueId || '',
        OVERDECK_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...piProviderEnv,
      },
    }));
    try {
      await writeOhmypiAgentPrompt(normalizedId, recoveryPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recoverAgent] ohmypi recovery prompt delivery failed for ${normalizedId}: ${msg}`);
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (ohmypi)`);
    return state;
  }

  const recoveryCodexFields = recoveryHarness === 'codex'
    ? getCodexLauncherFields(normalizedId, state.model, state.workspace)
    : {};
  const recoveryLauncherContent = generateLauncherScriptSync({
    role: recoveryRole,
    workingDir: state.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports: (await getProviderExportsForModel(state.model)).trimEnd(),
    baseCommand: await getRoleRuntimeBaseCommand(state.model, normalizedId, recoveryRole, recoveryHarness),
    appendSystemPromptFiles: await claudeSystemPromptFiles(state.workspace, recoveryHarness),
    ...(recoveryHarness === 'codex' ? {} : { promptInline: recoveryPrompt }),
    useSupervisor: recoverySupervisorLaunch.useSupervisor,
    supervisorScriptPath: recoverySupervisorLaunch.supervisorScriptPath,
    ...recoveryCodexFields,
  });
  const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, recoveryLauncherContent);
  createSessionSync(normalizedId, state.workspace, `bash ${launcherScript}`, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      OVERDECK_AGENT_ID: normalizedId,
      OVERDECK_ISSUE_ID: state.issueId || '',
      OVERDECK_SESSION_TYPE: state.role ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work'),
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    }
  });

  saveAgentStateSync(state);
  if (recoveryHarness === 'codex') {
    const delivery = await deliverInitialPromptWithRetry(normalizedId, recoveryPrompt, 'recoverAgent:recovery-prompt', state.deliveryMethod);
    if (!delivery.ok) {
      console.error(`[recoverAgent] Codex recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`);
    }
  }
  // Update state
  markAgentRunning(state);
  saveAgentStateSync(state);

  logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount}`);
  return state;
}

/**
 * Generate a recovery prompt for a crashed agent
 */
function generateRecoveryPrompt(state: AgentState): string {
  const lines: string[] = [
    '# Agent Recovery',
    '',
    '⚠️ This agent session was recovered after a crash.',
    '',
    '## Previous Context',
    `- Issue: ${state.issueId}`,
    `- Workspace: ${state.workspace}`,
    `- Started: ${state.startedAt}`,
    '',
    '## Recovery Steps',
    '1. Check beads for context: `bd show ' + state.issueId + '`',
    '2. Review recent git commits: `git log --oneline -10`',
    '3. Check hook for pending work: `pan admin fpp check`',
    '4. Resume from last known state',
    '',
    '## FPP Reminder',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  // Add FPP work if available
  const { hasWork } = checkHookSync(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(state.id);
    if (fixedPointPrompt) {
      lines.push('---');
      lines.push('');
      lines.push(fixedPointPrompt);
    }
  }

  return lines.join('\n');
}

/**
 * Auto-recover all crashed agents
 */
export async function autoRecoverAgents(): Promise<{ recovered: string[]; failed: string[] }> {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = await recoverAgent(agent.id);
      if (result) {
        recovered.push(agent.id);
      } else {
        failed.push(agent.id);
      }
    } catch (error) {
      failed.push(agent.id);
    }
  }

  return { recovered, failed };
}
