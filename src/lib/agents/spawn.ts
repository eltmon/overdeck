import { materializeMuseContext } from '../runtimes/muse-context.js';
import { resolveMuseSessionPath, museSessionId } from '../runtimes/storage/muse.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { writeFile as writeFileAsync } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { Effect } from 'effect';
import { emitActivityEntry, emitActivityTts } from '../activity-logger.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { isTldrEnabled, loadConfigSync } from '../config-yaml.js';
import { createConversation, getConversationByName, reactivateConversationForSpawn, setConversationClaudeSessionId } from '../overdeck/conversations.js';
import { startWork } from '../cv.js';
import { generateFixedPointPrompt, checkHook, initHook } from '../hooks.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { getProviderForModel, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import { resolveHarness } from '../harness-resolve.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { assertCodexNativeAuthForSpawn } from '../codex-auth.js';
import type { ModelId } from '../settings.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { writeBridgeToken } from '../bridge-token.js';
import { exactPaneTarget, sessionExists, setOption } from '../tmux.js';
import { agentPaneExists, closeBackendPane, launchAgentPane, resolveLaunchBackend } from '../terminal-backends/launch.js';
import { toPaneRole } from '../terminal-backends/tmux.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import {
  getAgentDir, getAgentState,
  markAgentRunning,
  markSpawnFailed,
  recordStartupSessionExit,
  saveAgentState,
  saveAgentStateSync,
  SESSION_EXITED_BEFORE_KICKOFF,
  type AgentState,
  type Role,
} from './agent-state.js';
import { saveAgentRuntimeState } from './runtime-state.js';
import { clearReadySignal } from './identity.js';
import { deliverAgentMessage, deliverInitialPromptWithRetry } from './delivery.js';
import { determineModel, getProviderEnvForModel, getProviderExportsForModel } from './provider-env.js';
import {
  claudeSystemPromptFiles,
  getAcpLauncherFields,
  getCodexLauncherFields,
  getKimiCodeLauncherFields,
  getOhmypiLauncherFields,
  getProviderAuthMode,
  getRoleRuntimeBaseCommand,
  roleAgentDefinitionPath,
  waitForPromptReady,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './runtime-command.js';
import {
  buildAgentLaunchConfig,
  defaultRunWorkspace,
  flywheelEnvExports,
  resolveAgentStartedBy,
  resolveRegisteredSlotSpawn,
  resolveSlotTierSpawnParams,
  resolveSlotSpawnFitness,
  logTierFitnessAtSpawn,
  resolveSingleWorkTierSpawnParams,
  resolveFlywheelSpawnEnv,
  runAgentId,
  transitionIssueToInProgress,
  withSpawnTimeMemoryContext,
  prepareWorkspaceForAgentSpawn,
  type SpawnOptions,
  type SpawnRunOptions,
} from './spawn-prep.js';
import { getConcurrencyLimits } from '../cloister/concurrency.js';
import { listAgentStates } from './queries.js';
import { findProjectByPath } from '../projects.js';
import {
  decideChannelsForWorkAgent,
  dismissDevChannelsDialog,
  prepareSupervisorForFreshLaunch,
  recordKickoffDeliveryFailure,
  writeChannelsBridgeMcpConfig,
} from './supervisor-channels.js';
import { stopAgent } from './termination.js';
import { reapWarmIdleRoleRun } from './warm-idle-reap.js';
import {
  appendSessionIdToHistory,
  createFreshSessionIdentity,
  logLauncherSessionPinned,
} from '../session-history.js';
import { ensureLifecycleHooksBeforeLaunch } from './hook-readiness.js';
import {
  withAutoSpawnConsentClaim,
  type AcceptAutoSpawnConsent,
} from '../planning/auto-spawn-consent.js';
import { isOperatorStartedBy } from './provenance.js';
import { buildRegisteredSlotPrompt, ensureRegisteredSlotWorktree } from './registered-slot-spawn.js';
import { launchAndCaptureManagedKimiSession } from '../runtimes/kimi-code.js';
import { requireManagedKimiDelivery } from './managed-kimi-delivery.js';
const execAsync = promisify(exec);

export async function spawnRun(issueId: string, role: Role, options: SpawnRunOptions): Promise<AgentState> {
  if (role !== 'work') return spawnRunWithoutConsentClaim(issueId, role, options);

  const flywheelRunId = resolveFlywheelSpawnEnv(role, options.flywheelRunId).OVERDECK_FLYWHEEL_RUN_ID;
  const startedBy = resolveAgentStartedBy(options.startedBy, flywheelRunId);
  const resolvedOptions = { ...options, startedBy };
  if (isOperatorStartedBy(startedBy) || options.autoSpawnConsentRequired !== true) {
    return spawnRunWithoutConsentClaim(issueId, role, resolvedOptions);
  }

  return withAutoSpawnConsentClaim(
    issueId,
    (acceptConsent) => spawnRunWithoutConsentClaim(issueId, role, resolvedOptions, acceptConsent),
    { isAccepted: (state) => state.status === 'running' && state.kickoffDelivered !== false },
  );
}

async function spawnRunWithoutConsentClaim(
  issueId: string,
  role: Role,
  options: SpawnRunOptions,
  acceptConsent?: AcceptAutoSpawnConsent,
): Promise<AgentState> {
  const workspace = options.workspace ?? defaultRunWorkspace(issueId);
  const modelSpawnKey = `${role}:${issueId}`;
  const selectedModel = determineModel({ model: options.model, role, spawnKey: modelSpawnKey });

  if (role === 'work') {
    const slot = resolveRegisteredSlotSpawn(issueId, workspace, options);
    // Tiered execution (PAN-1791): when enabled, the slot item's difficulty
    // selects the worker — the resolved tier's model+harness replace the
    // parent default in the spawn params. Disabled → both stay as resolved
    // above, unchanged.
    let slotModel = selectedModel;
    let slotHarness = options.harness;
    if (slot) {
      assertRegisteredSlotCap(issueId, options.maxRegisteredSlots);
      const tierParams = resolveSlotTierSpawnParams(workspace, slot.slotItemId, options.model, modelSpawnKey);
      if (tierParams.model) {
        slotModel = determineModel({ model: tierParams.model, role, spawnKey: modelSpawnKey });
        // Implicit staffing (PAN-2397) omits harness — keep the parent's
        // historical harness handling in that case.
        slotHarness = tierParams.harness ?? options.harness;
      }
      // PAN-3842: build fitness payload through the production helper (FINAL selected model).
      const fitness = resolveSlotSpawnFitness(role, modelSpawnKey, tierParams, options.model, slotHarness, slot.slotItemId);
      logTierFitnessAtSpawn(slot.agentId, fitness.staffing, fitness.difficulties, fitness.items);
      await ensureRegisteredSlotWorktree(issueId, workspace, slot);
    }
    const prompt = slot
      ? buildRegisteredSlotPrompt(issueId, workspace, slot, options.prompt)
      : options.prompt;
    return spawnAgentWithoutConsentClaim({
      issueId,
      workspace: slot?.workspace ?? workspace,
      agentId: slot?.agentId,
      harness: slotHarness,
      model: slot ? slotModel : options.model,
      prompt,
      role: 'work',
      allowHost: options.allowHost,
      flywheelRunId: options.flywheelRunId,
      startedBy: options.startedBy,
      autoSpawnConsentRequired: options.autoSpawnConsentRequired,
      effort: options.effort,
      slotIndex: slot?.slotIndex,
      slotItemId: slot?.slotItemId, foreman: options.foreman,
    }, acceptConsent);
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);
  const startedBy = resolveAgentStartedBy(options.startedBy, flywheelEnv.OVERDECK_FLYWHEEL_RUN_ID);
  const agentId = options.agentId ?? runAgentId(issueId, role, options.subRole);
  if (await agentPaneExists(agentId)) {
    // PAN-2579 (warm-by-default lifecycle): a session alive at dispatch time may
    // be a warm-idle leftover from the PREVIOUS cycle rather than an active run.
    // Reap it when the liveness oracle proves it finished: no live harness, or
    // (Herdr) a harness idle at its prompt after delivery (PAN-3923). Anything
    // else is an active run, so keep throwing and let the operator message it.
    if (!(await reapWarmIdleRoleRun(agentId, { readStatus: (id) => getAgentState(id)?.status }))) {
      throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
    }
    console.log(`[spawn] ${agentId} is warm-idle from the previous cycle — reaped it for the new ${role} dispatch (PAN-2579)`);
  }
  await prepareWorkspaceForAgentSpawn(issueId, role, options.allowHost, workspace);
  initHook(agentId);

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness,
    role,
    model: selectedModel,
  });
  const harnessBehavior = getHarnessBehavior(resolvedHarness);
  const isAcp = harnessBehavior.launchCommandKind === 'acp-host';
  const harnessLaunch = await prepareHarnessLaunch(resolvedHarness);
  // PAN-2285: reject fresh Codex launches when native auth would wedge in a 401 loop.
  assertCodexNativeAuthForSpawn(resolvedHarness, listAgentStates());
  await ensureLifecycleHooksBeforeLaunch(agentId, resolvedHarness);
  if (
    getProviderForModel(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('../cliproxy.js');
    if (!(await isCliproxyRunning())) {
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
    role, foreman: options.foreman || undefined,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    ...(resolvedHarness === 'codex' ? {} : { costSoFar: 0 }),
    hostOverride: options.allowHost || undefined,
    slotIndex: options.slotIndex,
    slotItemId: options.slotItemId,
    flywheelRunId: flywheelEnv.OVERDECK_FLYWHEEL_RUN_ID,
    startedBy,
    ...(role === 'review' && options.subRole ? { reviewSubRole: options.subRole } : {}),
    reviewRunId: options.reviewRunId,
    reviewSynthesisAgentId: options.reviewSynthesisAgentId,
    reviewOutputPath: options.reviewOutputPath,
    reviewDeadlineAt: options.reviewDeadlineAt,
    parentId: options.parentId,
  };
  // PAN-1048 P1: spawnRun is on the dashboard hot path (Effect routes,
  // reactive Cloister scheduler). All disk I/O here uses async fs/promises
  // so we never block the Node event loop.
  await Effect.runPromise(saveAgentState(state));
  const isSpecialistRole = role === 'review' || role === 'test' || role === 'ship' || role === 'knowledge';
  const shouldRegisterConversation = isSpecialistRole || options.registerConversation === true;
  // PAN-1557: convoy sub-reviewers are now interactive specialists — deliver
  // their prompt via tmux after Claude boots (same as the orchestrator/test/
  // ship), not on stdin to a headless `claude --print`.
  const shouldDeliverPromptViaTmux = shouldRegisterConversation && resolvedHarness === 'claude-code';
  const shouldDeliverPromptViaPi = shouldRegisterConversation && resolvedHarness === 'ohmypi';
  // PAN-3920: codex reads no prompt file, so a worker's brief is delivered after launch, as its parent.
  const shouldDeliverPromptViaCodexTui = (shouldRegisterConversation || role === 'worker') && resolvedHarness === 'codex';
  const kickoffOpts = options.parentId ? { sender: { id: options.parentId } } : {};
  const shouldDeliverPromptViaKimiCode = resolvedHarness === 'muse' || resolvedHarness === 'kimi-code';
  const shouldDeliverPromptViaAcp = resolvedHarness === 'acp' || resolvedHarness === 'opencode';
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
  const tracksKickoffDelivery = role === 'flywheel';
  if (prompt && !shouldDeliverPromptViaAcp && (tracksKickoffDelivery || (!shouldDeliverPromptViaTmux && !shouldDeliverPromptViaPi && !shouldDeliverPromptViaCodexTui && !shouldDeliverPromptViaKimiCode))) {
    promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
    await writeFileAsync(promptFile, prompt);
  }
  if (prompt && tracksKickoffDelivery) {
    state.kickoffDelivered = false;
    await Effect.runPromise(saveAgentState(state));
  }

  if (!isAcp) {
    const provider = getProviderForModel(selectedModel as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuth(provider, workspace);
    } else {
      clearCredentialFileAuth(workspace);
    }
  }

  const providerExports = isAcp ? undefined : await getProviderExportsForModel(selectedModel, resolvedHarness);
  const providerEnv = isAcp ? {} : await getProviderEnvForModel(selectedModel, resolvedHarness);
  // PAN-1048 review feedback 005 (S1): when the resolved harness is ohmypi, thread
  // the per-agent ohmypi launcher fields (--session-dir, --extension, FIFO
  // redirect) through generateLauncherScriptSync so the role launcher emits the
  // correct `omp --mode rpc` command instead of a malformed Claude command.
  // Without this, a config'd `roles.review.harness: ohmypi` produced a launcher
  // that silently fell back to Claude shape.
  const piLauncherFields = resolvedHarness === 'ohmypi'
    ? await getOhmypiLauncherFields(agentId, selectedModel, options.effort)
    : {};
  const codexLauncherFields = resolvedHarness === 'codex'
    ? getCodexLauncherFields(agentId, selectedModel, workspace, role, options.effort)
    : {};
  const acpLauncherFields = isAcp
    ? getAcpLauncherFields(
        agentId,
        selectedModel,
        workspace,
        harnessLaunch.binaryPath,
        role,
        options.effort,
      )
    : {};
  const museSavedSession = resolvedHarness === 'muse' && options.resumeSessionId
    ? await resolveMuseSessionPath(agentId) : null;
  const museLauncherFields = resolvedHarness === 'muse' ? {
    harness: 'muse' as const,
    museModel: selectedModel,
    museEffort: options.effort,
    museContextFile: await materializeMuseContext(agentId, workspace, roleAgentDefinitionPath(role)),
    museResumeSessionId: museSavedSession ? museSessionId(museSavedSession) : undefined,
  } : {};
  // Kimi launchers require their model and effort fields even for specialist roles.
  const kimiCodeLauncherFields = resolvedHarness === 'kimi-code'
    ? getKimiCodeLauncherFields(selectedModel, options.effort)
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
    // Claude-style harnesses own their session id at launcher construction time.
    // ACP creates its session during host startup and persists acp-session-id itself.
    rawSessionId = (isAcp || resolvedHarness === 'kimi-code')
      ? options.resumeSessionId
      : (options.resumeSessionId ?? randomUUID());

    if (!isAcp && resolvedHarness !== 'kimi-code' && rawSessionId) {
      appendSessionIdToHistory(agentId, rawSessionId, 'launcher', {
        harness: resolvedHarness,
        model: selectedModel,
      });
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
  // PAN-1557: interactive convoy wiring is already present in the initial
  // AgentState saved before launch, so the Stop-hook can always deliver
  // REVIEWER_READY even if a later running-state cache write is contended.
  const extraEnvExports = [harnessLaunch.pathExport, ...flywheelEnvExports(flywheelEnv), ...(options.extraEnvExports ?? [])];
  if (role === 'knowledge' && !extraEnvExports.includes('export PATH="$HOME/.overdeck/bin:$PATH"')) {
    extraEnvExports.push('export PATH="$HOME/.overdeck/bin:$PATH"');
  }

  const launcherContent = generateLauncherScript({
    role,
    workingDir: workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    promptFileMode: undefined,
    overdeckEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    extraEnvExports,
    gitGuardMode: options.gitGuardMode,
    baseCommand: await getRoleRuntimeBaseCommand(selectedModel, agentId, role, resolvedHarness, options.subRole, options.effort),
    appendSystemPromptFiles: await claudeSystemPromptFiles(workspace, resolvedHarness),
    sessionId,
    resumeSessionId: options.resumeSessionId,
    reviewSignal: undefined,
    trapHup: undefined,
    ...piLauncherFields,
    ...codexLauncherFields,
    ...acpLauncherFields,
    ...kimiCodeLauncherFields,
    ...museLauncherFields,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  // PAN-1594: clear any stale ready.json before launch so waitForReadySignal()
  // only observes the session-start signal from THIS launch.
  clearReadySignal(agentId);

  // PAN-3917 FR-5: the pane goes into the issue workspace on the selected
  // terminal backend and carries the `issue`, `role`, `harness`, `model`
  // tokens. On tmux this is the same `createSession` call as before, with the
  // same session name, env, and cwd.
  let launchedPane: Awaited<ReturnType<typeof launchAgentPane>> | null = null;
  const launchRoleSession = () => launchAgentPane({
    issueId,
    cwd: workspace,
    agentId,
    argv: ['bash', launcherScript],
    env: {
      ...BLANKED_PROVIDER_ENV,
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: issueId,
      OVERDECK_SESSION_TYPE: role,
      OVERDECK_AGENT_STARTED_BY: startedBy,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      ...flywheelEnv,
      ...providerEnv,
    },
    tokens: {
      issue: issueId,
      role: toPaneRole(role),
      harness: resolvedHarness,
      model: selectedModel,
      ...(options.parentId ? { parent: options.parentId } : {}),
    },
  }).then((pane) => { launchedPane = pane; Object.assign(state, { backend: pane.backend, paneId: pane.paneId, terminalId: pane.terminalId }); });
  if (resolvedHarness === 'kimi-code') {
    try {
      rawSessionId = await launchAndCaptureManagedKimiSession({
        agentId,
        workspace,
        launch: launchRoleSession,
        resumeSessionId: options.resumeSessionId,
      });
      if (shouldRegisterConversation) setConversationClaudeSessionId(agentId, rawSessionId);
    } catch (error) {
      await closeBackendPane(launchedPane);
      const { killSession } = await import('../tmux.js');
      await Effect.runPromise(killSession(agentId)).catch(() => {});
      throw error;
    }
  } else {
    await launchRoleSession();
  }
  if (shouldRegisterConversation) {
    await saveAgentRuntimeState(agentId, {
      claudeSessionId: rawSessionId,
      ...(options.resumeSessionId ? {} : {
        sessionModel: selectedModel,
        sessionHarness: resolvedHarness,
      }),
    });
  }
  // tmux-only session options: Herdr owns its panes' lifetime itself.
  if ((launchedPane as { backend?: string } | null)?.backend === 'tmux') {
    await Effect.runPromise(setOption(agentId, 'destroy-unattached', 'off'));
    await Effect.runPromise(setOption(exactPaneTarget(agentId), 'remain-on-exit', 'on'));
  }

  if (prompt || resolvedHarness === 'kimi-code') {
    if (shouldDeliverPromptViaAcp) {
      try {
        await waitForPromptReady(agentId, resolvedHarness, 30);
        const delivery = await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt', undefined, kickoffOpts);
        if (!delivery.ok) {
          throw new Error(delivery.failure ?? `ACP delivery returned ok=false via ${delivery.path}`);
        }
        if (tracksKickoffDelivery) {
          state.kickoffDelivered = true;
          await Effect.runPromise(saveAgentState(state));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${agentId}] ACP prompt delivery failed:`, message);
        if (tracksKickoffDelivery) {
          await recordKickoffDeliveryFailure(state, issueId, role);
        }
        await closeBackendPane(launchedPane);
        await Effect.runPromise(stopAgent(agentId));
        throw new Error(`Agent ${agentId} kickoff delivery failed: ${message}`);
      }
    } else if (shouldDeliverPromptViaPi) {
      try {
        await writeOhmypiAgentPrompt(agentId, prompt);
        if (tracksKickoffDelivery) {
          state.kickoffDelivered = true;
          await Effect.runPromise(saveAgentState(state));
        }
      } catch (err) {
        console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      }
    } else if (shouldDeliverPromptViaTmux || shouldDeliverPromptViaCodexTui || shouldDeliverPromptViaKimiCode) {
      if (tracksKickoffDelivery) {
        const delivery = await deliverInitialPromptWithRetry(agentId, prompt, 'spawnRun:initial-prompt');
        await requireManagedKimiDelivery({
          agentId,
          role,
          harness: resolvedHarness,
          delivery,
          onFailure: async () => {
            if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
              await recordStartupSessionExit(state, issueId, role);
            }
            await recordKickoffDeliveryFailure(state, issueId, role);
            await closeBackendPane(launchedPane);
            await Effect.runPromise(stopAgent(agentId)).catch(() => {});
          },
        });
        if (delivery.ok) {
          state.kickoffDelivered = true;
          await Effect.runPromise(saveAgentState(state));
        } else if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
          await recordStartupSessionExit(state, issueId, role);
          return state;
        }
      } else {
        // PAN-1594: wait for the hook-written ready.json (session-start hook),
        // not a tmux pane-scrape. No dependency on permission-mode footer text.
        // Kimi Code's own readiness (readinessKind 'kimi-session-signal') is a
        // pane-scan, not a hook file — waitForPromptReady dispatches correctly.
        const timeout = getHarnessBehavior(resolvedHarness).readyTimeoutSeconds;
        const ready = await waitForPromptReady(agentId, resolvedHarness, timeout);
        if (ready) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          try {
            const delivery = await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt', undefined, kickoffOpts);
            if (resolvedHarness === 'kimi-code' && !delivery.ok) {
              throw new Error(delivery.failure ?? `delivery returned ok=false via ${delivery.path}`);
            }
          } catch (error) {
            if (resolvedHarness === 'kimi-code') await closeBackendPane(launchedPane);
            if (resolvedHarness === 'kimi-code') await Effect.runPromise(stopAgent(agentId)).catch(() => {});
            throw error;
          }
        } else {
          if (resolvedHarness === 'kimi-code') await closeBackendPane(launchedPane);
          if (resolvedHarness === 'kimi-code') await Effect.runPromise(stopAgent(agentId)).catch(() => {});
          throw new Error(`[${agentId}] ${getHarnessBehavior(resolvedHarness).displayName} did not become ready within ${timeout}s`);
        }
      }
    }
  }

  markAgentRunning(state);

  // Stamp the producer-issued workspace anchor this role run was launched
  // against. The reactive scheduler uses it to distinguish a still-relevant
  // run from a zombie session after any monorepo or polyrepo HEAD advances.
  // A non-fatal probe failure leaves the marker absent and preserves the
  // status-only fallback.
  try {
    const { snapshotWorkspaceHeads } = await import('../git-utils.js');
    const headAnchor = await snapshotWorkspaceHeads(issueId, workspace);
    if (headAnchor) state.roleRunHead = headAnchor;
  } catch { /* non-fatal — marker stays absent */ }

  await Effect.runPromise(saveAgentState(state));

  // PAN-1556: the review role emits a single dedicated "Review role spawned"
  // event from spawnReviewRoleForIssue. Suppress the generic per-spawn
  // "role started" for review so the orchestrator + 4 convoy sub-reviewers
  // don't each spam the session feed and bury conversations.
  if (role !== 'review') {
    emitActivityEntry({
      source: role,
      level: 'info',
      message: `${role} role started for ${issueId}`,
      issueId,
    });
  }

  return state;
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const role: 'work' | 'strike' | 'knowledge' = options.role ?? 'work';
  if (role !== 'work') return spawnAgentWithoutConsentClaim(options);

  const flywheelRunId = resolveFlywheelSpawnEnv(role, options.flywheelRunId).OVERDECK_FLYWHEEL_RUN_ID;
  const startedBy = resolveAgentStartedBy(options.startedBy, flywheelRunId);
  const resolvedOptions = { ...options, startedBy };
  if (isOperatorStartedBy(startedBy) || options.autoSpawnConsentRequired !== true) {
    return spawnAgentWithoutConsentClaim(resolvedOptions);
  }

  return withAutoSpawnConsentClaim(
    options.issueId,
    (acceptConsent) => spawnAgentWithoutConsentClaim(resolvedOptions, acceptConsent),
    { isAccepted: (state) => state.status === 'running' && state.kickoffDelivered !== false },
  );
}

async function spawnAgentWithoutConsentClaim(
  options: SpawnOptions,
  acceptConsent?: AcceptAutoSpawnConsent,
): Promise<AgentState> {
  const role: 'work' | 'strike' | 'knowledge' = options.role ?? 'work';
  const sessionPrefix = role === 'strike' ? 'strike' : 'agent';
  const agentId = options.agentId ?? `${sessionPrefix}-${options.issueId.toLowerCase()}`;

  // Check if already running (scoped to the exact session/pane name, including slot suffix)
  if (await agentPaneExists(agentId)) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await prepareWorkspaceForAgentSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHook(agentId);

  if (role !== 'strike' && role !== 'knowledge' && options.slotItemId === undefined && !readWorkspacePlanSync(options.workspace)) {
    throw new Error(`The required xBRIEF checklist for ${options.issueId} is missing or unreadable. Run planning before spawning a work agent.`);
  }

  // Determine model based on role configuration
  const modelSpawnKey = `${role}:${options.issueId}`;
  const singleTierParams = role === 'work' && options.slotItemId === undefined && options.slotIndex === undefined
    ? resolveSingleWorkTierSpawnParams(options.workspace, options.model, modelSpawnKey)
    : {};
  const selectedModel = determineModel({ model: singleTierParams.model ?? options.model, role, spawnKey: modelSpawnKey });
  console.log(`[DEBUG] Selected model: ${selectedModel}`);
  // PAN-3842: plan-max fitness; log against the FINAL selected model so explicit overrides still warn.
  logTierFitnessAtSpawn(agentId, { tierName: singleTierParams.tierName ?? 'default', model: selectedModel, harness: singleTierParams.harness }, singleTierParams.planDifficulties ?? [], singleTierParams.planItems ?? []);

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModel(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('../cliproxy.js');
    if (!(await isCliproxyRunning())) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription agents route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT agent.',
      );
    }
  }

  const resolvedHarness: RuntimeName = await resolveHarness({
    explicit: options.harness ?? singleTierParams.harness,
    role,
    model: selectedModel,
  });
  const isAcp = getHarnessBehavior(resolvedHarness).launchCommandKind === 'acp-host';
  const harnessLaunch = await prepareHarnessLaunch(resolvedHarness);
  // PAN-2285: reject fresh Codex launches when native auth would wedge in a 401 loop.
  assertCodexNativeAuthForSpawn(resolvedHarness, listAgentStates());
  await ensureLifecycleHooksBeforeLaunch(agentId, resolvedHarness);
  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);
  const startedBy = resolveAgentStartedBy(options.startedBy, flywheelEnv.OVERDECK_FLYWHEEL_RUN_ID);
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    harness: resolvedHarness,
    role, foreman: options.foreman || undefined,
    model: selectedModel,
    modelSpawnKey,
    status: 'starting',
    startedAt: new Date().toISOString(),
    ...(resolvedHarness === 'codex' ? {} : { costSoFar: 0 }),
    hostOverride: options.allowHost || undefined,
    sessionId: createFreshSessionIdentity(agentId, resolvedHarness, selectedModel),
    flywheelRunId: flywheelEnv.OVERDECK_FLYWHEEL_RUN_ID,
    startedBy,
  };
  // PAN-3917 W12: one backend answer for both the supervisor decision and the
  // launch — the PTY supervisor is tmux-only (see decideSupervisorForWorkAgent).
  const launchBackend = await resolveLaunchBackend();
  const supervisorLaunch = await prepareSupervisorForFreshLaunch(
    agentId,
    { ...options, backend: launchBackend.name },
    state,
  );

  saveAgentStateSync(state);
  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (role === 'work') {
    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For child stories: synthesize feature context from parent feature plan
  // before the agent starts so readFeatureContext has O(1) local access.
  if (role === 'work') {
    try {
      const { writeStoryFeatureContext } = await import('../cloister/work-agent-prompt.js');
      await writeStoryFeatureContext(options.workspace, options.issueId);
    } catch (ctxErr: any) {
      console.warn(`[agents] Could not write story feature context for ${options.issueId}: ${ctxErr.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork } = checkHook(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(agentId);
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

  // ACP receives the initial prompt only after its authenticated host socket is ready.
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  const tracksKickoffDelivery = role === 'work' || role === 'strike';
  if (prompt && !isAcp) {
    await writeFileAsync(promptFile, prompt);
  }
  if (prompt && tracksKickoffDelivery) {
    state.kickoffDelivered = false;
    saveAgentStateSync(state);
  }

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal).
  // Gated by the operator TLDR toggle: when disabled, the daemon is not started
  // and the agent (whose prompt reports TLDR_AVAILABLE=false) degrades to direct
  // file reads.
  try {
    const venvPath = join(options.workspace, '.venv');
    if (isTldrEnabled() && existsSync(venvPath)) {
      const { getTldrDaemonService } = await import('../tldr-daemon.js');
      const tldrService = getTldrDaemonService(options.workspace, venvPath);
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
    writeBridgeToken(agentId);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, agentId);
    state.channelsEnabled = true;
    saveAgentStateSync(state);
  }

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
    harnessBinaryPath: harnessLaunch.binaryPath,
    sessionId: state.sessionId,
    extraEnvExports: [harnessLaunch.pathExport, ...flywheelEnvExports(flywheelEnv)],
    effort: options.effort,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  if (state.sessionId) logLauncherSessionPinned(agentId, state.sessionId, launcherScript);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=work-agent | model=${state.model} | source=agents.ts:spawnAgent | session=${agentId} | command="${claudeCmd}"`);

  // Configure workspace for GitHub App bot identity (PAN-536)
  // Agents push as panopticon-agent[bot] with short-lived installation tokens
  try {
    const { isGitHubAppConfigured, generateInstallationToken, configureWorkspaceForBot } = await import('../github-app.js');
    if (isGitHubAppConfigured()) {
      const { findProjectByPath } = await import('../projects.js');
      const project = findProjectByPath(resolve(options.workspace, '..', '..'));
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

  // PAN-3917 FR-5: same launcher, placed in the issue workspace on the selected
  // backend and stamped with the four pane tokens.
  let launchedPane: Awaited<ReturnType<typeof launchAgentPane>> | null = null;
  const launchWorkSession = () => launchAgentPane({
    issueId: options.issueId,
    cwd: options.workspace,
    agentId,
    argv: ['bash', launcherScript],
    env: {
      ...BLANKED_PROVIDER_ENV, // Blank stale provider vars inherited by tmux server
      TERM: 'xterm-256color',
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_ISSUE_ID: options.issueId,
      OVERDECK_SESSION_TYPE: role,
      OVERDECK_AGENT_STARTED_BY: startedBy,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...flywheelEnv,
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    },
    tokens: {
      issue: options.issueId,
      role: toPaneRole(role),
      harness: resolvedHarness,
      model: selectedModel,
    },
  }, launchBackend).then((pane) => {
    launchedPane = pane;
    // W12: a failure after this point is still addressable.
    Object.assign(state, { backend: pane.backend, paneId: pane.paneId, terminalId: pane.terminalId });
    saveAgentStateSync(state);
  });

  // W12: the launch itself can fail — PAN-3705: the backend created the pane and
  // never detected the harness. Uncaught, that left the state at `starting`.
  try {
    if (resolvedHarness === 'kimi-code') {
      await launchAndCaptureManagedKimiSession({ agentId, workspace: options.workspace, launch: launchWorkSession });
    } else {
      await launchWorkSession();
    }
  } catch (err) {
    await closeBackendPane(launchedPane);
    await Effect.runPromise(stopAgent(agentId)).catch(() => undefined);
    await markSpawnFailed(agentId, `launch failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  await acceptConsent?.();
  await saveAgentRuntimeState(agentId, {
    claudeSessionId: state.sessionId,
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

  // Send the initial prompt after the harness-specific readiness signal.
  if (prompt && isAcp) {
    try {
      await waitForPromptReady(agentId, resolvedHarness, 30);
      const delivery = await deliverAgentMessage(agentId, prompt, 'spawnAgent:initial-prompt');
      if (!delivery.ok) {
        throw new Error(delivery.failure ?? `ACP delivery returned ok=false via ${delivery.path}`);
      }
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${agentId}] ACP prompt delivery failed:`, message);
      if (tracksKickoffDelivery) {
        // Already writes the reason markSpawnFailed below would clobber (PAN-2771).
        await recordKickoffDeliveryFailure(state, options.issueId, role);
      }
      await closeBackendPane(launchedPane);
      await Effect.runPromise(stopAgent(agentId)).catch(() => undefined);
      if (!tracksKickoffDelivery) {
        await markSpawnFailed(agentId, `kickoff delivery failed: ${message}`);
      }
      throw new Error(`Agent ${agentId} kickoff delivery failed: ${message}`);
    }
  } else if (prompt && resolvedHarness === 'ohmypi') {
    try {
      await writeOhmypiAgentPrompt(agentId, prompt);
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } catch (err) {
      console.error(`[${agentId}] ohmypi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      if (tracksKickoffDelivery) {
        // No markSpawnFailed here — it would clobber the reason just recorded (PAN-2771).
        await recordKickoffDeliveryFailure(state, options.issueId, role);
        await closeBackendPane(launchedPane);
        await Effect.runPromise(stopAgent(agentId)).catch(() => undefined);
        throw new Error(`Agent ${agentId} kickoff delivery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (prompt || resolvedHarness === 'kimi-code') {
    if (dismissChannelsDialogPromise) {
      await dismissChannelsDialogPromise;
    }
    const delivery = await deliverInitialPromptWithRetry(agentId, prompt, 'spawnAgent:initial-prompt', state.deliveryMethod);
    await requireManagedKimiDelivery({
      agentId,
      role,
      harness: resolvedHarness,
      delivery,
      onFailure: async () => {
        if (tracksKickoffDelivery) {
          if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
            await recordStartupSessionExit(state, options.issueId, role);
          }
          // Already writes a reason markSpawnFailed below would clobber (PAN-2771).
          await recordKickoffDeliveryFailure(state, options.issueId, role);
        }
        await closeBackendPane(launchedPane);
        await Effect.runPromise(stopAgent(agentId)).catch(() => {});
        if (!tracksKickoffDelivery) {
          await markSpawnFailed(agentId, `kickoff delivery failed: ${delivery.failure ?? 'unknown error'}`);
        }
      },
    });
    if (delivery.ok) {
      if (tracksKickoffDelivery) {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } else if (tracksKickoffDelivery) {
      if (delivery.failure === SESSION_EXITED_BEFORE_KICKOFF) {
        await recordStartupSessionExit(state, options.issueId, role);
      }
      // No markSpawnFailed here — it would clobber the reason just recorded (PAN-2771).
      await recordKickoffDeliveryFailure(state, options.issueId, role);
      await closeBackendPane(launchedPane);
      await Effect.runPromise(stopAgent(agentId)).catch(() => undefined);
      throw new Error(`Agent ${agentId} kickoff delivery failed: ${delivery.failure ?? 'unknown error'}`);
    }
  }

  // For codex work agents, poll for the first rollout JSONL in the background
  // and persist the thread-id so transcript/cost lookups hit the fast path
  // (PAN-1805). Non-blocking — codex writes its rollout only after the kickoff
  // prompt lands, so a blocking wait here would stall spawn. The latest-rollout
  // fallback covers sessions whose first turn lands after this window.
  if (
    resolvedHarness === 'codex'
    && loadConfigSync().config.codex?.transport === 'tui'
    && getHarnessBehavior(resolvedHarness).readinessKind === 'codex-tui-prompt'
  ) {
    const codexHomeForAgent = join(homedir(), '.overdeck', 'agents', agentId, 'codex-home-v2');
    void (async () => {
      try {
        const { waitForCodexRollout, recordCodexRolloutSession } = await import('../runtimes/codex.js');
        const { extractThreadIdFromRollout } = await import('../runtimes/storage/codex.js');
        const rollout = await waitForCodexRollout(codexHomeForAgent, 120_000);
        if (rollout) {
          const threadId = extractThreadIdFromRollout(rollout);
          if (threadId) recordCodexRolloutSession(agentId, threadId, rollout);
        }
      } catch { /* non-fatal — the latest-rollout fallback still resolves the transcript */ }
    })();
  }

  // Update status
  markAgentRunning(state);
  saveAgentStateSync(state);

  // Track work in CV
  startWork(agentId, options.issueId);

  // Emit activity + TTS so the user knows an agent has started
  emitActivityEntry({
    source: role,
    level: 'info',
    message: `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTts({
    utterance: `Work agent started for ${options.issueId}`,
    priority: 2,
    issueId: options.issueId,
    source: 'work-agent',
    eventType: 'workAgent.started',
  });

  return state;
}

function assertRegisteredSlotCap(issueId: string, configuredCap?: number): void {
  const cap = configuredCap ?? getConcurrencyLimits().maxWorkAgents;
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`Registered slot cap must be a positive integer; got ${cap}.`);
  }

  const issueLower = issueId.toLowerCase();
  const slotAgentPattern = new RegExp(`^agent-${escapeRegExp(issueLower)}-slot-\\d+$`);
  const activeSlots = listAgentStates({ role: 'work' }).filter(agent =>
    slotAgentPattern.test(agent.id)
    && (agent.status === 'starting' || agent.status === 'running')
  );
  if (activeSlots.length >= cap) {
    throw new Error(
      `Registered slot cap reached for ${issueId}: ${activeSlots.length}/${cap} active slot agents.`
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
