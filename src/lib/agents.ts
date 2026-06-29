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


export async function spawnRun(issueId: string, role: Role, options: SpawnRunOptions = {}): Promise<AgentState> {
  const workspace = options.workspace ?? defaultRunWorkspace(issueId);
  const modelSpawnKey = `${role}:${issueId}`;
  const selectedModel = determineModel({ model: options.model, role, spawnKey: modelSpawnKey });

  if (role === 'work') {
    return spawnAgent({
      issueId,
      workspace,
      harness: options.harness,
      model: selectedModel,
      prompt: options.prompt,
      role: 'work',
      allowHost: options.allowHost,
      flywheelRunId: options.flywheelRunId,
      effort: options.effort,
    });
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);

  const agentId = options.agentId ?? runAgentId(issueId, role, options.subRole);
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(issueId, role, options.allowHost, workspace);

  initHookSync(agentId);

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness,
    role,
    model: selectedModel,
  });

  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription role runs route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT role run.',
      );
    }
  }

  const state: AgentState = {
    id: agentId,
    issueId,
    workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    hostOverride: options.allowHost || undefined,
  };
  // PAN-1048 P1: spawnRun is on the dashboard hot path (Effect routes,
  // reactive Cloister scheduler). All disk I/O here uses async fs/promises
  // so we never block the Node event loop.
  await Effect.runPromise(saveAgentState(state));

  const isSpecialistRole = role === 'review' || role === 'test' || role === 'ship';
  const shouldRegisterConversation = isSpecialistRole || options.registerConversation === true;
  // PAN-1557: convoy sub-reviewers are now interactive specialists — deliver
  // their prompt via tmux after Claude boots (same as the orchestrator/test/
  // ship), not on stdin to a headless `claude --print`.
  const shouldDeliverPromptViaTmux = shouldRegisterConversation && resolvedHarness === 'claude-code';
  const shouldDeliverPromptViaPi = shouldRegisterConversation && resolvedHarness === 'ohmypi';
  const shouldDeliverPromptViaCodexTui = shouldRegisterConversation && resolvedHarness === 'codex';
  const prompt = options.prompt
    ? await withSpawnTimeMemoryContext({
        prompt: options.prompt,
        issueId,
        workspace,
        agentId,
        role,
        harness: resolvedHarness,
      })
    : '';

  let promptFile: string | undefined;
  if (prompt && !shouldDeliverPromptViaTmux && !shouldDeliverPromptViaPi && !shouldDeliverPromptViaCodexTui) {
    promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
    await writeFileAsync(promptFile, prompt);
  }

  checkAndSetupHooks();

  const provider = getProviderForModelSync(selectedModel as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, workspace);
  } else {
    clearCredentialFileAuthSync(workspace);
  }

  const providerExports = await getProviderExportsForModel(selectedModel);
  const providerEnv = await getProviderEnvForModel(selectedModel);

  // PAN-1048 review feedback 005 (S1): when the resolved harness is ohmypi, thread
  // the per-agent ohmypi launcher fields (--session-dir, --extension, FIFO
  // redirect) through generateLauncherScript so the role launcher emits the
  // correct `omp --mode rpc` command instead of a malformed Claude command.
  // Without this, a config'd `roles.review.harness: ohmypi` produced a launcher
  // that silently fell back to Claude shape.
  const piLauncherFields = resolvedHarness === 'ohmypi'
    ? await getOhmypiLauncherFields(agentId, selectedModel)
    : {};
  const codexLauncherFields = resolvedHarness === 'codex'
    ? getCodexLauncherFields(agentId, selectedModel, workspace)
    : {};

  // Create a conversation record for every specialist role — sub-role reviewers,
  // the review orchestrator/synthesizer, test, and ship. The row is the index
  // the dashboard reads to (a) locate the JSONL via claude_session_id, (b) carry
  // pre-JSONL state (spawn_error, fork_status), and (c) let the
  // conversation-lifecycle service compute sessionAlive from real tmux liveness
  // instead of from the agent state machine's status field, which can lag.
  // Excluding the orchestrator here previously forced AgentOutputPanel to
  // synthesize a Conversation whose sessionAlive came from `agent.status`, and
  // stale snapshots made active synthesizers render as "Starting…".
  let sessionId: string | undefined;
  let rawSessionId: string | undefined;
  if (shouldRegisterConversation) {
    // When resuming, reuse the prior JSONL session so `claude --resume` reloads conversation history.
    // When starting fresh, generate a new UUID and use `claude --session-id`.
    rawSessionId = options.resumeSessionId ?? randomUUID();

    // Persist the session ID to <agentDir>/session.id so resolveClaudeSessionId can locate the
    // JSONL after the specialist exits. Works for both fresh (--session-id) and resumed (--resume).
    try {
      const agentDir = getAgentDir(agentId);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, 'session.id'), rawSessionId, 'utf-8');
    } catch (err) {
      console.warn(`[spawnRun] Failed to persist session.id for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    try {
      const conversation = {
        name: agentId,
        tmuxSession: agentId,
        cwd: workspace,
        issueId,
        claudeSessionId: rawSessionId,
        model: selectedModel,
        harness: resolvedHarness,
      };
      if (getConversationByName(agentId)) {
        reactivateConversationForSpawn(conversation);
      } else {
        createConversation(conversation);
      }
    } catch (err) {
      // Non-fatal: the specialist still runs, but without a conversation record
      console.warn(`[spawnRun] Failed to register conversation for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    // Only set sessionId (→ --session-id flag) for fresh spawns.
    // Resumes pass resumeSessionId (→ --resume flag) to the launcher instead.
    if (!options.resumeSessionId) {
      sessionId = rawSessionId;
    }
  }

  // PAN-1557: convoy reviewers are interactive now, so the launcher no longer
  // owns the REVIEWER_READY/FAILED signal (which previously rode a `claude
  // --print` process exit). The Stop-hook delivers REVIEWER_READY to the
  // synthesis agent when the reviewer finishes its turn with a written report;
  // Deacon's REVIEWER_TIMEOUT remains the failure failsafe. We still persist
  // the synthesis/output wiring on state.json so the Stop-hook can read it.
  if (options.reviewSynthesisAgentId) state.reviewSynthesisAgentId = options.reviewSynthesisAgentId;
  if (options.reviewOutputPath) state.reviewOutputPath = options.reviewOutputPath;

  const launcherContent = generateLauncherScriptSync({
    role,
    workingDir: workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    promptFileMode: undefined,
    overdeckEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    baseCommand: await getRoleRuntimeBaseCommand(selectedModel, agentId, role, resolvedHarness, options.subRole, options.effort),
    appendSystemPromptFiles: await claudeSystemPromptFiles(workspace, resolvedHarness),
    sessionId,
    resumeSessionId: options.resumeSessionId,
    reviewSignal: undefined,
    trapHup: undefined,
    ...piLauncherFields,
    ...codexLauncherFields,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(workspace);
  } catch { /* non-fatal */ }

  // PAN-1594: clear any stale ready.json before launch so waitForReadySignal()
  // only observes the session-start signal from THIS launch.
  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: issueId,
      OVERDECK_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      ...flywheelEnv,
      ...providerEnv,
    },
  }));
  if (shouldRegisterConversation) {
    await saveAgentRuntimeState(agentId, {
      claudeSessionId: rawSessionId,
      ...(options.resumeSessionId ? {} : {
        sessionModel: selectedModel,
        sessionHarness: resolvedHarness,
      }),
    });
  }
  await Effect.runPromise(setOption(agentId, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(exactPaneTarget(agentId), 'remain-on-exit', 'on'));

  if (prompt) {
    if (shouldDeliverPromptViaPi) {
      try {
        await writeOhmypiAgentPrompt(agentId, prompt);
      } catch (err) {
        console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      }
    } else if (shouldDeliverPromptViaTmux || shouldDeliverPromptViaCodexTui) {
      // PAN-1594: wait for the hook-written ready.json (session-start hook),
      // not a tmux pane-scrape. No dependency on permission-mode footer text.
      const ready = await waitForPromptReady(agentId, resolvedHarness, 30);
      if (ready) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt');
      } else {
        console.error(`[${agentId}] ${resolvedHarness === 'codex' ? 'Codex' : 'Claude'} did not become ready within 30s`);
      }
    }
  }

  markAgentRunning(state);

  // Stamp the workspace HEAD this role run was launched against. The reactive
  // scheduler uses this to tell a still-relevant run from a zombie session
  // left behind by an agent that finished work but never exited (the ship/test
  // stall class of bug). A non-fatal git probe — if it fails the marker is
  // simply absent and activeRoleRunExists falls back to status-only checks.
  try {
    const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspace });
    const head = stdout.trim();
    if (head) state.roleRunHead = head;
  } catch { /* non-fatal — marker stays absent */ }

  await Effect.runPromise(saveAgentState(state));

  // PAN-1556: the review role emits a single dedicated "Review role spawned"
  // event from spawnReviewRoleForIssue. Suppress the generic per-spawn
  // "role started" for review so the orchestrator + 4 convoy sub-reviewers
  // don't each spam the session feed and bury conversations.
  if (role !== 'review') {
    emitActivityEntrySync({
      source: role,
      level: 'info',
      message: `${role} role started for ${issueId}`,
      issueId,
    });
  }

  return state;
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const role: 'work' | 'strike' = options.role ?? 'work';
  const sessionPrefix = role === 'strike' ? 'strike' : 'agent';
  // PAN-1517: slot-suffixed agent ids removed alongside the swarm runtime;
  // there is one work agent per issue, period.
  const agentId = `${sessionPrefix}-${options.issueId.toLowerCase()}`;

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHookSync(agentId);

  // Strike agents bypass the normal pipeline (no plan/beads/review/test) —
  // see roles/strike.md. The beads gate is the only thing we skip; everything
  // else (workspace health, supervisor wiring, launcher) is identical.
  if (role !== 'strike') {
    // Use a short lock timeout when spawning from HTTP handlers so dashboard
    // requests fail fast to the JSONL fallback instead of blocking behind CLI
    // processes that hold the cross-process bd lock. The CLI `pan start` path
    // already performs a long-timeout live query before reaching spawnAgent.
    try {
      await Effect.runPromise(
        assertIssueHasBeads(options.workspace, options.issueId, { acquisitionTimeoutMs: 500 }),
      );
    } catch (error) {
      if (error instanceof BeadsMissingError && error.transientFailure !== undefined) {
        const attempts = error.transientFailure instanceof BdTransientFailure
          ? ` after ${error.transientFailure.attempts} attempts`
          : '';
        throw new Error(
          `Beads database was temporarily locked while checking ${options.issueId}${attempts}; re-run shortly.`
        );
      }
      throw error;
    }
  }

  // Determine model based on role configuration
  const modelSpawnKey = `${role}:${options.issueId}`;
  const selectedModel = determineModel({ model: options.model, role, spawnKey: modelSpawnKey });
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription agents route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT agent.',
      );
    }
  }

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness,
    role,
    model: selectedModel,
  });

  // Create state
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    hostOverride: options.allowHost || undefined,
  };

  const supervisorLaunch = await prepareSupervisorForFreshLaunch(agentId, options, state);

  saveAgentStateSync(state);

  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (role === 'work') {
    try {
      const resetStatus = resetPipelineVerdictsForWorkStartSync(options.issueId);
      if (resetStatus) {
        const { resetPostMergeState } = await import('./cloister/merge-agent.js');
        resetPostMergeState(options.issueId);
      }
    } catch (err) {
      console.warn(`[agents] Could not reset stale pipeline verdicts for ${options.issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For child stories: synthesize feature context from parent feature plan
  // before the agent starts so readFeatureContext has O(1) local access.
  if (role === 'work') {
    try {
      const { writeStoryFeatureContext } = await import('./cloister/work-agent-prompt.js');
      await writeStoryFeatureContext(options.workspace, options.issueId);
    } catch (ctxErr: any) {
      console.warn(`[agents] Could not write story feature context for ${options.issueId}: ${ctxErr.message}`);
    }
  }

  // PAN-1215: One-shot cleanup of tracked workspace-only .pan/ artifacts.
  // These files are gitignored but may still be tracked on older branches.
  // If tracked, checkpoint commits and rebases can drop them, breaking the
  // verification gate. Remove them from the index when the workspace is clean.
  if (role === 'work') {
    try {
      const workspace = options.workspace;
      const { stdout: trackedFiles } = await execAsync(
        'git ls-files .pan/continue.json .pan/spec.vbrief.json',
        { cwd: workspace },
      );
      if (trackedFiles.trim()) {
        const { stdout: porcelain } = await execAsync(
          'git status --porcelain -- .pan/',
          { cwd: workspace },
        );
        if (!porcelain.trim()) {
          await execAsync(
            'git rm --cached --ignore-unmatch .pan/continue.json .pan/spec.vbrief.json',
            { cwd: workspace },
          );
          await execAsync(
            'git commit -m "chore: untrack workspace .pan/ artifacts (PAN-1215)"',
            { cwd: workspace },
          );
          console.log(`[agents] Untracked workspace .pan/ artifacts for ${options.issueId}`);
        } else {
          console.warn(`[agents] Skipping .pan/ untrack for ${options.issueId} — .pan/ paths have uncommitted changes`);
        }
      }
    } catch (err: any) {
      console.warn(`[agents] .pan/ untrack cleanup failed for ${options.issueId}: ${err.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHookSync(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  if (prompt) {
    prompt = await withSpawnTimeMemoryContext({
      prompt,
      issueId: options.issueId,
      workspace: options.workspace,
      agentId,
      role,
      harness: resolvedHarness,
    });
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  const tracksKickoffDelivery = role === 'work' || role === 'strike';
  if (prompt) {
    await writeFileAsync(promptFile, prompt);
    if (tracksKickoffDelivery) {
      state.kickoffDelivered = false;
      saveAgentStateSync(state);
    }
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal).
  // Gated by the operator TLDR toggle: when disabled, the daemon is not started
  // and the agent (whose prompt reports TLDR_AVAILABLE=false) degrades to direct
  // file reads.
  try {
    const venvPath = join(options.workspace, '.venv');
    if (isTldrEnabledSync() && existsSync(venvPath)) {
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(options.workspace, venvPath);
      const status = await tldrService.getStatus();
      if (!status.running) {
        await tldrService.start(true);
        console.log(`[${agentId}] Started TLDR daemon for workspace`);
      }
    }
  } catch {
    // Non-fatal — agents degrade to direct file reads if TLDR unavailable
  }

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Clear ready signal before spawning (clean slate for PAN-87 fix)
  clearReadySignal(agentId);

  // Channels MCP gate: only the explicit legacy override writes a per-agent
  // .mcp.json, bridge token, and channelsEnabled state for new spawns. The PTY
  // supervisor remains the default delivery transport.
  const channelsDecision = decideChannelsForWorkAgent(agentId, options, state);
  let channelsBridgeMcpConfig: string | undefined;
  if (channelsDecision.eligible) {
    channelsBridgeMcpConfig = join(options.workspace, '.pan', 'agent-mcp.json');
    writeBridgeTokenSync(agentId);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, agentId);
    state.channelsEnabled = true;
    saveAgentStateSync(state);
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);
  const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
    agentId,
    model: selectedModel,
    workspace: options.workspace,
    role,
    isPlanning: false,
    channelsBridgeMcpConfig,
    useSupervisor: supervisorLaunch.useSupervisor,
    supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    harness: state.harness ?? 'claude-code',
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    effort: options.effort,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=work-agent | model=${state.model} | source=agents.ts:spawnAgent | session=${agentId} | command="${claudeCmd}"`);

  // Pre-trust workspace directory in Claude Code to avoid the trust prompt
  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(options.workspace);
  } catch { /* non-fatal */ }

  // Configure workspace for GitHub App bot identity (PAN-536)
  // Agents push as panopticon-agent[bot] with short-lived installation tokens
  try {
    const { isGitHubAppConfigured, generateInstallationToken, configureWorkspaceForBot } = await import('./github-app.js');
    if (isGitHubAppConfigured()) {
      const { findProjectByPathSync } = await import('./projects.js');
      const project = findProjectByPathSync(resolve(options.workspace, '..', '..'));
      const ghRepo = project?.github_repo;
      if (ghRepo) {
        const [owner, repo] = ghRepo.split('/');
        const { token } = await Effect.runPromise(generateInstallationToken());
        await configureWorkspaceForBot(options.workspace, owner, repo, token);
        console.log(`[${agentId}] Configured workspace for bot push (panopticon-agent[bot])`);
      }
    }
  } catch (err: any) {
    console.warn(`[${agentId}] GitHub App config failed (falling back to SSH): ${err.message}`);
  }

  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, options.workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV, // Blank stale provider vars inherited by tmux server
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: options.issueId,
      OVERDECK_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...flywheelEnv,
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    }
  }));
  await saveAgentRuntimeState(agentId, {
    sessionModel: selectedModel,
    sessionHarness: resolvedHarness,
  });

  // Channels: start dismissing the dev-channels confirmation dialog as soon as
  // the tmux session exists, but only block on completion when we are about to
  // deliver an initial prompt. Spawn-only callers should not sit in a 20s poll
  // loop waiting for a dialog they may never need.
  const dismissChannelsDialogPromise = channelsBridgeMcpConfig
    ? dismissDevChannelsDialog(agentId).catch(() => undefined)
    : null;

  // Send the initial prompt after the interactive prompt is ready.
  if (prompt && resolvedHarness === 'ohmypi') {
    try {
      await writeOhmypiAgentPrompt(agentId, prompt);
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } catch (err) {
      console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      if (tracksKickoffDelivery) {
        await recordKickoffDeliveryFailure(state, options.issueId, role);
        if (role === 'strike') {
          await Effect.runPromise(stopAgent(agentId));
          throw new Error(`Agent ${agentId} kickoff delivery failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return state;
      }
    }
  } else if (prompt) {
    if (dismissChannelsDialogPromise) {
      await dismissChannelsDialogPromise;
    }
    const delivery = await deliverInitialPromptWithRetry(agentId, prompt, 'spawnAgent:initial-prompt', state.deliveryMethod);
    if (delivery.ok) {
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } else if (tracksKickoffDelivery) {
      if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
        await recordStartupSessionExit(state, options.issueId, role);
      }
      await recordKickoffDeliveryFailure(state, options.issueId, role);
      if (role === 'strike') {
        await Effect.runPromise(stopAgent(agentId));
        throw new Error(`Agent ${agentId} kickoff delivery failed: ${delivery.failure ?? 'unknown error'}`);
      }
      return state;
    }
  }

  // For codex work agents, poll for the first rollout JSONL in the background
  // and persist the thread-id so transcript/cost lookups hit the fast path
  // (PAN-1805). Non-blocking — codex writes its rollout only after the kickoff
  // prompt lands, so a blocking wait here would stall spawn. The latest-rollout
  // fallback covers sessions whose first turn lands after this window.
  if (resolvedHarness === 'codex') {
    const codexHomeForAgent = join(homedir(), '.overdeck', 'agents', agentId, 'codex-home');
    void (async () => {
      try {
        const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId } =
          await import('./runtimes/codex.js');
        const rollout = await waitForCodexRollout(codexHomeForAgent, 120_000);
        if (rollout) {
          const threadId = extractThreadIdFromRollout(rollout);
          if (threadId) writeThreadId(agentId, threadId);
        }
      } catch { /* non-fatal — the latest-rollout fallback still resolves the transcript */ }
    })();
  }

  // Update status
  markAgentRunning(state);
  saveAgentStateSync(state);

  // Track work in CV
  startWorkSync(agentId, options.issueId);

  // Emit activity + TTS so the user knows an agent has started
  emitActivityEntrySync({
    source: role,
    level: 'info',
    message: `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTtsSync({
    utterance: `Work agent started for ${options.issueId}`,
    priority: 2,
    issueId: options.issueId,
    source: 'work-agent',
    eventType: 'workAgent.started',
  });

  return state;
}

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

/**
 * Resume a suspended agent (PAN-80)
 *
 * Reads saved session ID and creates new tmux session with --resume flag.
 * Optionally sends a message after resuming.
 *
 * Auto-resume triggers:
 * - Specialists: When queued work arrives
 * - Work agents: When message is sent via /work-tell
 */
/**
 * PAN-1781: Build the opening prompt for a compact-recovery respawn — an
 * out-of-band summary of the wedged session plus durable-artifact reseed
 * instructions. Replaces PAN-1675's in-place JSONL compaction
 * (compactAgentSession), which appended a compact_boundary the harness's
 * resume leaf selection bypassed ~half the time, silently rebuilding the full
 * pre-compact context. The old JSONL is read-only here — never mutated.
 *
 * Never throws and never returns an unusable seed: smart summary → fallback
 * heuristic summary → reseed-instructions-only, in that order. A missing
 * sessionId or workspace skips straight to the reseed-only seed.
 */
export async function buildCompactRecoverySeed(agentId: string): Promise<{ seed: string; summarized: boolean }> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const sessionId = getLatestSessionIdSync(normalizedId);
  const issueId = agentState?.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();

  let summary: string | null = null;
  if (agentState?.workspace && sessionId) {
    const sessionFile = sessionFilePath(agentState.workspace, sessionId);
    try {
      // Dynamic imports: keep conversation-compaction out of agents.ts's
      // top-level import graph (it pulls in dashboard server services).
      const [{ getConversationCompactionSettings }, { generateSmartSummary }] = await Promise.all([
        import('../dashboard/server/services/conversation-compaction.js'),
        import('./conversations/smart-compaction.js'),
      ]);
      const settings = getConversationCompactionSettings();
      const result = await Effect.runPromise(generateSmartSummary({
        jsonlPath: sessionFile,
        model: settings.model,
        richMode: settings.richCompaction,
        mode: 'fork',
      }));
      summary = result.summary;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logAgentLifecycleSync(normalizedId, `compact-recovery smart summary failed (${error}); trying heuristic fallback`);
      try {
        const { generateFallbackSummary } = await import('./conversations/summary-fork.js');
        summary = await Effect.runPromise(generateFallbackSummary(sessionFile));
      } catch (fallbackErr) {
        const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logAgentLifecycleSync(normalizedId, `compact-recovery fallback summary failed (${fallbackError}); seeding with reseed instructions only`);
      }
    }
  }

  return {
    seed: buildCompactRecoverySeedMessage(issueId, summary),
    summarized: summary !== null,
  };
}

export async function resumeAgent(agentId: string, message?: string, opts?: { model?: string; harness?: RuntimeName; allowHost?: boolean; compact?: boolean }): Promise<{ success: boolean; messageDelivered?: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const requestedModel = normalizeModelOverrideSync(opts?.model);
  logAgentLifecycleSync(normalizedId, `resumeAgent called (message=${message ? 'yes' : 'no'}, harness=${opts?.harness || 'unchanged'})`);

  // Check runtime state — allow both suspended (auto-suspend) and stopped/idle (manual stop, crash)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    const reason = `Cannot resume ${normalizedId}: ${gateBlockReason}. Clear the gate before resuming.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const isPlaceholder = !!agentState && agentState.status === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const allowedRuntimeStates = ['suspended', 'idle'];
  const allowedAgentStatuses = ['stopped', 'completed'];

  // Also allow resuming a "running" OR "starting" agent with no live tmux session —
  // this happens after a system crash where tmux was killed but state.json was never
  // updated to 'stopped'. For 'starting' this is a spawn that got past model
  // resolution but whose tmux session died mid-launch (the deacon patrol would
  // normally heal starting→stopped after its grace window, but that requires the
  // deacon to be running / not in OVERDECK_NO_RESUME mode). A non-placeholder
  // 'starting' agent with a saved session is resumable exactly like a crashed
  // 'running' agent; placeholder 'starting' agents (model starts with 'pending-')
  // are still rejected below because they never produced a resumable session.
  // The lifecycle UI model already treats runtime=stopped as isStopped, so this
  // keeps the gate consistent with the Resume button that model enables.
  // PAN-2098: a crash leaves the agent at status='running'/'starting' but with no
  // live process. Two shapes: (a) tmux session gone entirely, or (b) the tmux
  // session is still up while the harness process inside its pane has exited — a
  // "keep-alive corpse" (remain-on-exit leaves a dead pane in a live session).
  // The old check used `!sessionExists` alone, so a corpse (session present, pane
  // dead) was misclassified as a healthy running agent and refused resume with a
  // reasonless "Cannot resume … runtime=active, status=running". Treat a dead pane
  // as crashed too, matching the start path (flywheel-actions.ts isPaneDead).
  const isRunningOrStarting = agentState?.status === 'running' || agentState?.status === 'starting';
  const sessionAlive = isRunningOrStarting ? await Effect.runPromise(sessionExists(normalizedId)) : false;
  const paneDead = isRunningOrStarting && (!sessionAlive || await Effect.runPromise(isPaneDead(normalizedId)));
  const isCrashed = isRunningOrStarting && paneDead;

  // PAN-1675 (keystone): a `compact` resume exists specifically to recover a
  // context-wedged agent, which is typically status='running' with a LIVE (but
  // stuck) tmux session sitting at an overflow/idle prompt. The normal canResume
  // gate rejects running+live-session agents — which would make
  // resumeAgent({compact:true}) (the deacon's overflow recovery tiers AND
  // `pan resume --compact`) a silent no-op for exactly the agents it targets.
  // So a compact-resume of a running agent is allowed: the flow below compacts
  // the JSONL out-of-band and then kills the wedged session before relaunch.
  // This is safe because the only callers of {compact:true} act on agents they
  // have already determined to be context-overflow-wedged.
  const isCompactRecovery = opts?.compact === true && agentState?.status === 'running';

  const canResume = (runtimeState && allowedRuntimeStates.includes(runtimeState.state))
    || (agentState && allowedAgentStatuses.includes(agentState.status))
    || isCrashed
    || isCompactRecovery;

  if (!canResume) {
    // PAN-2098: never refuse without a concrete reason. A running/starting agent
    // that reached here has a live session AND a live pane (a crash would have set
    // isCrashed above), so it is genuinely healthy and there is nothing to resume.
    const reason = isRunningOrStarting
      ? `Cannot resume ${normalizedId}: it appears healthy (tmux session up, harness process alive) — there is nothing to resume. Stop it first if you intend to restart it.`
      : `Cannot resume ${normalizedId}: runtime=${runtimeState?.state || 'unknown'}, status=${agentState?.status || 'unknown'} is not a resumable state.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  // Get saved session ID from any available source
  const sessionId = getLatestSessionIdSync(normalizedId);
  if (!sessionId) {
    // PAN-2098: state the concrete reason. ohmypi now resolves from its session
    // JSONL (see getLatestSessionIdSync); reaching here means no id exists in any
    // source for this harness, so a fresh start is genuinely the only option.
    const harnessLabel = agentState?.harness ?? 'unknown';
    const reason = `Cannot resume ${normalizedId} (harness=${harnessLabel}): no resumable session id found — no session.id file, no sessions.json entry, and no recoverable session transcript on disk. Start a fresh agent instead.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  if (!agentState || !hasWorkspace || isPlaceholder) {
    const reason = 'Saved Claude session is orphaned because the backing workspace/agent state is missing or placeholder-only. Start a fresh agent instead.';
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      opts?.allowHost === true || agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  // PAN-1781: compact recovery = summarize the wedged session out-of-band and
  // respawn a FRESH session seeded with that summary. The previous approach
  // (PAN-1675: append a compact_boundary to the JSONL and relaunch with
  // --resume) was silently bypassed by the harness's resume leaf selection
  // ~half the time in the field — the relaunched session rebuilt the full
  // pre-compact context, re-overflowed, and escalated to /clear. A fresh
  // seeded session has nothing stale to rewind to, so its starting context is
  // bounded by construction. The old JSONL stays untouched on disk.
  // buildCompactRecoverySeed never throws: it degrades smart summary →
  // heuristic summary → reseed-instructions-only.
  let compactSeed: string | null = null;
  if (opts?.compact) {
    const seedResult = await buildCompactRecoverySeed(normalizedId);
    compactSeed = seedResult.seed;
    logAgentLifecycleSync(normalizedId, `compact recovery: respawning fresh session (seed=${seedResult.summarized ? 'summary' : 'reseed-only'})`);
  }

  // PAN-2009: capture whether the ohmypi process is actually alive BEFORE we kill any
  // zombie session below. A DEAD omp process cannot be resumed by session id —
  // `omp --resume` against a cleaned-up session never writes ready.json (the "did
  // not become ready within 30s" hang) — and there is no live transcript to
  // protect, so it must be fresh-launched (recovery, not rotation). A live
  // (suspended) omp process stays on the normal resume path.
  const piProcessWasAlive = getHarnessBehavior(agentState.harness).usesRpcFifo
    ? await hasAgentRuntimeInSession(normalizedId, 'ohmypi')
    : false;

  // Kill any zombie tmux session (crashed agent left behind)
  if (await Effect.runPromise(sessionExists(normalizedId))) {
    try {
      await Effect.runPromise(killSession(normalizedId));
    } catch { /* non-fatal */ }
  }

  // Remove completed marker so the agent can work again
  const completedFile = join(getAgentDir(normalizedId), 'completed');
  if (existsSync(completedFile)) {
    try { unlinkSync(completedFile); } catch { /* non-fatal */ }
  }

  // Append 'resume' session entry to continue state (PAN-946: workspace-44p)
  try {
    if (agentState?.workspace) {
      const issueId = agentState.issueId || normalizedId.replace('agent-', '').toUpperCase();
      const resolved = resolveProjectFromIssueSync(issueId);
      if (resolved) {
        appendContinueSessionEntryForIssue(resolved.projectPath, issueId, {
          reason: 'resume',
          agentModel: agentState.model || undefined,
        });
      }
    }
  } catch (continueErr: any) {
    console.warn(`[resumeAgent] Failed to append resume entry to continue state (non-fatal): ${continueErr?.message ?? continueErr}`);
  }

  try {
    const resumeStartedAt = new Date().toISOString();
    // Clear ready signal before resuming (clean slate for PAN-87 fix)
    clearReadySignal(normalizedId);

    const model = requestedModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
    if (requestedModel && requestedModel !== agentState.model) {
      agentState.model = requestedModel;
      saveAgentStateSync(agentState);
    }
    // PAN-1797: agents predating session-origin metadata must not have their
    // stored harness treated as `explicit` on auto-resume — that pins a stale
    // pairing (e.g. gpt-5.5 on claude-code) over the provider default forever.
    // Re-resolve from the model for origin-less agents (only an operator-supplied
    // opts.harness counts as explicit); agents WITH origin metadata keep prior
    // behavior and are handled by sessionResumeDriftReasons below.
    const hasSessionOrigin = !!(runtimeState?.sessionModel && runtimeState?.sessionHarness);
    const priorHarness = agentState.harness;
    const effectiveHarness = await resolveHarness({
      explicit: hasSessionOrigin ? (opts?.harness ?? agentState.harness) : opts?.harness,
      role: agentState.role,
      model,
    });
    const legacyHarnessMigrated =
      !hasSessionOrigin && priorHarness !== undefined && priorHarness !== effectiveHarness;
    agentState.harness = effectiveHarness;
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, model, effectiveHarness);
    saveAgentStateSync(agentState);
    const resumeDriftReasons = sessionResumeDriftReasons(runtimeState, model, effectiveHarness);
    if (legacyHarnessMigrated) {
      // PAN-1797: force a fresh session so the re-defaulted harness takes effect;
      // never reuse a session across a harness change.
      resumeDriftReasons.push(`legacy harness ${priorHarness}→${effectiveHarness} (PAN-1797 re-default)`);
    }
    // PAN-2009: a dead ohmypi process is fresh-launchable recovery — force a fresh
    // session (no `omp --resume`, which would hang waiting for ready.json) instead
    // of a doomed resume-by-id. This is NOT session rotation (no live session or
    // transcript exists to protect), so it is exempt from the PAN-1980 refusal
    // below — it adds no compact seed and no drift reason. Live (suspended) omp and
    // compact/drift resumes are unaffected.
    const piDeadRecovery = effectiveHarness === 'ohmypi' && !piProcessWasAlive
      && !compactSeed && resumeDriftReasons.length === 0;
    if (piDeadRecovery) {
      logAgentLifecycleSync(normalizedId, 'resumeAgent: dead ohmypi process — fresh-launching for recovery instead of omp --resume (PAN-2009)');
    }
    const shouldResumeSavedSession = !compactSeed && resumeDriftReasons.length === 0 && !piDeadRecovery;
    // PAN-1980: refuse to rotate to a new session. A resume that would need a
    // fresh session — compact/overflow recovery or model/harness drift — now
    // errors and stops instead of starting a new transcript.
    if (sessionRotationRefused({ compactSeed: Boolean(compactSeed), driftReasons: resumeDriftReasons })) {
      const reason = compactSeed
        ? 'context-overflow compaction would respawn a fresh session'
        : `session drift (${resumeDriftReasons.join(', ')})`;
      const errMsg = `Refusing to rotate ${normalizedId} to a new session — ${reason}; session rotation is disabled (PAN-1980). Agent left stopped.`;
      logAgentLifecycleSync(normalizedId, `resumeAgent: ${errMsg}`);
      emitActivityEntrySync({ source: 'work-agent', level: 'error', message: `${normalizedId}: ${errMsg}`, issueId: agentState.issueId });
      return { success: false, error: errMsg };
    }
    const freshSessionId = !shouldResumeSavedSession && effectiveHarness === 'claude-code'
      ? randomUUID()
      : undefined;
    if (resumeDriftReasons.length > 0) {
      logAgentLifecycleSync(normalizedId, `resumeAgent: starting fresh session instead of --resume because session origin drifted (${resumeDriftReasons.join(', ')})`);
    }
    if (freshSessionId) {
      saveSessionId(normalizedId, freshSessionId);
    } else if (!shouldResumeSavedSession) {
      try {
        unlinkSync(join(getAgentDir(normalizedId), 'session.id'));
      } catch { /* absent or already cleared */ }
    }

    // Compute the effective message before building the launcher so codex can
    // embed it as the inline prompt in `codex exec resume <threadId> <message>`.
    // PAN-1781: a compact recovery skips the kickoff-redelivery machinery — its
    // seed (summary + reseed instructions) IS the opening prompt of the fresh
    // session; a caller-supplied message rides along after it.
    const issueId = agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();
    const defaultResumeMessage = buildDefaultResumeContinueMessage(issueId);
    const resumeMessage: { message?: string; redeliveringKickoff: boolean; error?: string } = compactSeed
      ? { message: message ? `${compactSeed}\n\n${message}` : compactSeed, redeliveringKickoff: false }
      : resumeDriftReasons.length > 0
        ? { message: message ?? defaultResumeMessage, redeliveringKickoff: false }
      : await buildResumeMessageForAgent(agentState, defaultResumeMessage, message);
    if (resumeMessage.error) {
      console.error(`[resumeAgent] ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId,
      });
      return { success: false, error: resumeMessage.error };
    }
    const effectiveMessage = resumeMessage.message ?? defaultResumeMessage;

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      // PAN-1781/PAN-1787: compact recovery and model/harness drift launch a
      // fresh session. Normal resumes keep re-attaching to the saved session.
      ...(shouldResumeSavedSession ? { spawnMode: 'resume' as const, resumeSessionId: sessionId } : {}),
      sessionId: freshSessionId,
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
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    // Always wake the resumed agent with a continue prompt — without it, the
    // re-attached session sits silently at its last state, and the user (or
    // deacon nudge loop) ends up sending one manually anyway. Default matches
    // restartAgent's wording so behaviour is consistent across both entry points.
    // Caller-supplied message wins.

    let messageDelivered = false;
    if (effectiveHarness === 'ohmypi') {
      // ohmypi does not fire the Claude SessionStart hook; wait for ready.json and
      // deliver the auto-continue prompt through the FIFO JSONL protocol.
      try {
        await writeOhmypiAgentPrompt(normalizedId, effectiveMessage);
        messageDelivered = true;
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[resumeAgent] ohmypi prompt delivery failed: ${msg}`);
      }
    } else if (effectiveHarness === 'codex') {
      const delivery = await deliverInitialPromptWithRetry(normalizedId, effectiveMessage, 'resumeAgent:codex-continue', resilientDeliveryMethod(agentState.deliveryMethod));
      messageDelivered = delivery.ok;
      if (delivery.ok && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      if (!delivery.ok) {
        console.error(`[resumeAgent] Codex continue prompt did not land: ${delivery.failure ?? 'unknown failure'}`);
      }
    } else if (!shouldResumeSavedSession) {
      // Fresh session fallback — deliver like a kickoff. Transcript
      // confirmation is impossible here: the new session's id is unknown until
      // its SessionStart hook fires, and the saved sessionId points at the
      // archived or mismatched session. deliverInitialPromptWithRetry waits for
      // the ready signal internally.
      const delivery = await deliverInitialPromptWithRetry(normalizedId, effectiveMessage, 'resumeAgent:compact-seed', resilientDeliveryMethod(agentState.deliveryMethod));
      messageDelivered = delivery.ok;
      if (!delivery.ok) {
        console.error(`[resumeAgent] Fresh-session continue prompt did not land: ${delivery.failure ?? 'unknown failure'}`);
      }
    } else {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);
      if (ready) {
        const delivery = await deliverResumeMessageWithTranscriptConfirmation({
          agentId: normalizedId,
          workspace: agentState.workspace,
          sessionId,
          message: effectiveMessage,
          caller: 'resumeAgent:auto-continue',
          deliveryMethod: resilientDeliveryMethod(agentState.deliveryMethod),
        });
        messageDelivered = delivery.delivered;
        if (delivery.delivered && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
        if (!delivery.delivered) {
          console.error(`[resumeAgent] Auto-continue prompt did not land after ${delivery.attempts} delivery attempts`);
        }
      } else {
        console.error('Claude SessionStart hook did not fire during resume, continue prompt not sent');
      }
    }

    const resumedAt = new Date().toISOString();
    if (compactSeed) {
      console.log(`[agents] Respawned ${normalizedId} fresh with compact-recovery seed (archived session ${sessionId}${freshSessionId ? `, new session ${freshSessionId}` : ''})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: compact-recovery fresh respawn (archived sessionId=${sessionId}${freshSessionId ? `, newSessionId=${freshSessionId}` : ''}), messageDelivered=${messageDelivered}`);
    } else if (piDeadRecovery) {
      console.log(`[agents] Respawned ${normalizedId} fresh because the prior Pi process was dead (archived session ${sessionId})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: fresh respawn after dead Pi process (archived sessionId=${sessionId}), messageDelivered=${messageDelivered}`);
    } else if (!shouldResumeSavedSession) {
      console.log(`[agents] Respawned ${normalizedId} fresh because session origin drifted (archived session ${sessionId}${freshSessionId ? `, new session ${freshSessionId}` : ''})`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: fresh respawn after origin drift (archived sessionId=${sessionId}${freshSessionId ? `, newSessionId=${freshSessionId}` : ''}), messageDelivered=${messageDelivered}`);
    } else {
      console.log(`[agents] Resumed ${normalizedId} with Claude session ${sessionId}`);
      logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: sessionId=${sessionId}, messageDelivered=${messageDelivered}`);
    }
    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: resumedAt,
    });

    // Update agent state
    if (agentState) {
      agentState.lastResumeAt = resumeStartedAt;
      markAgentRunning(agentState, { preserveFailureTracking: true });
      saveAgentStateSync(agentState);
    }

    // PAN-1675: a successful compaction-resume genuinely recovers a
    // context-overflow-wedged agent — so clear a context_overflow `stuck` flag
    // here (set by markWorkspaceStuck once the old /compact+/clear ladder
    // exhausted). Without this the agent would stay flagged stuck forever and
    // the deacon's overflowBlocked gate would keep skipping its recovery, even
    // though the agent is now healthy. Only clear when the stuck reason is
    // context_overflow (don't clobber an unrelated stuck state).
    if (opts?.compact && agentState?.issueId) {
      try {
        const { getReviewStatusSync } = await import('./review-status.js');
        const rs = getReviewStatusSync(agentState.issueId);
        if (rs?.stuck && rs.stuckReason === 'context_overflow') {
          const { clearWorkspaceStuck } = await import('./review-status.js');
          clearWorkspaceStuck(agentState.issueId);
          logAgentLifecycleSync(normalizedId, `cleared context_overflow stuck flag after compaction-resume for ${agentState.issueId}`);
        }
      } catch (clearErr) {
        console.warn(`[agents] Could not clear stuck flag after compaction-resume for ${normalizedId}:`, clearErr);
      }
    }

    return { success: true, messageDelivered };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent FAILED: ${msg}`);
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
  }
}

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

/**
 * Check if Overdeck hooks are configured, and auto-setup if not
 */
function checkAndSetupHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const hookPath = join(homedir(), '.overdeck', 'bin', 'heartbeat-hook');

  // Check if settings.json exists and has heartbeat hook configured
  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const postToolUse = settings?.hooks?.PostToolUse || [];

      const hookConfigured = postToolUse.some((hookConfig: any) =>
        hookConfig.hooks?.some((hook: any) =>
          hook.command === hookPath ||
          hook.command?.includes('overdeck') ||
          hook.command?.includes('heartbeat-hook')
        )
      );

      if (hookConfigured) {
        return; // Already configured
      }
    } catch {
      // Ignore errors, will attempt setup
    }
  }

  // Hooks not configured - run setup silently
  try {
    console.log('Configuring Overdeck heartbeat hooks...');
    // Note: This runs during spawn which is now async, so we can use execAsync
    // But this is called from a sync context in checkAndSetupHooks, so we use fire-and-forget
    exec('pan admin hooks install', (error: Error | null) => {
      if (error) {
        console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
      } else {
        console.log('✓ Heartbeat hooks configured');
      }
    });
  } catch (error) {
    console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
  }
}

/**
 * Write task cache for heartbeat hook to use
 */
function writeTaskCache(agentId: string, issueId: string): void {
  const cacheDir = join(getAgentDir(agentId));
  mkdirSync(cacheDir, { recursive: true });

  const cacheFile = join(cacheDir, 'current-task.json');
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: issueId,
      title: `Working on ${issueId}`,
      updated_at: new Date().toISOString()
    }, null, 2)
  );
}
