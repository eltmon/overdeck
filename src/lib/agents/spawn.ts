import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir, readdir as readdirAsync, writeFile, writeFile as writeFileAsync } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { Effect } from 'effect';
import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { isTldrEnabledSync, loadConfigSync } from '../config-yaml.js';
import { createConversation, getConversationByName, reactivateConversationForSpawn } from '../overdeck/conversations.js';
import { startWorkSync } from '../cv.js';
import { generateFixedPointPromptSync, checkHookSync, initHookSync } from '../hooks.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from '../providers.js';
import { refreshWorkStartReviewedAnchor, resetWorkStartPipelineVerdicts } from '../cloister/work-start-verdicts.js';
import { recordAgentPlaneSpawn } from '../pan-dir/agents.js';
import { shouldPreservePipelineVerdicts } from '../cloister/verdict-preservation.js';
import { resetPostMergeState } from '../cloister/post-merge-state.js';
import { isRoleTerminal, resolveCanonicalReviewStatus } from '../cloister/review-status-source.js';
import { resolveHarness } from '../harness-resolve.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { assertCodexNativeAuthForSpawn } from '../codex-auth.js';
import type { ModelId } from '../settings.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { writeBridgeTokenSync } from '../bridge-token.js';
import { createSession, exactPaneTarget, sessionExists, setOption } from '../tmux.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import {
  getAgentDir,
  markAgentRunning,
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
import { findProjectByPathSync } from '../projects.js';
import { isStateMigrated } from '../state-home.js';
import { shouldCommitLegacyWorkspaceArtifacts } from '../state-read-home.js';
import {
  decideChannelsForWorkAgent,
  dismissDevChannelsDialog,
  prepareSupervisorForFreshLaunch,
  recordKickoffDeliveryFailure,
  writeChannelsBridgeMcpConfig,
} from './supervisor-channels.js';
import { stopAgent } from './termination.js';
import { clearSessionResetMarker, createFreshSessionIdentity, logLauncherSessionPinned } from '../session-history.js';
import { ensureLifecycleHooksBeforeLaunch } from './hook-readiness.js';
import {
  withAutoSpawnConsentClaim,
  type AcceptAutoSpawnConsent,
} from '../planning/auto-spawn-consent.js';
import { isOperatorStartedBy } from './provenance.js';
import { buildRegisteredSlotPrompt, ensureRegisteredSlotWorktree } from './registered-slot-spawn.js';
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
  if (await Effect.runPromise(sessionExists(agentId))) {
    // PAN-2579 (warm-by-default lifecycle): advancing-role sessions are no longer
    // reaped at verdict time, so a session alive at dispatch time may be a
    // warm-idle leftover from the PREVIOUS cycle rather than an active run. Reap
    // it here — at the moment its slot is actually needed — when that is provable
    // (its phase verdict is terminal, or its pane process has exited). A live
    // session with a non-terminal verdict is genuinely active: keep throwing so
    // a concurrent duplicate dispatch cannot stomp it. (Review dispatch reuses
    // its warm session with context via spawnReviewRoleForIssue's resume path
    // before ever reaching this guard; test/ship runs start fresh by design.)
    let reapWarmIdle = false;
    const advancing = role === 'review' || role === 'test' || role === 'ship';
    try {
      const { isPaneDead } = await import('../tmux.js');
      if (await Effect.runPromise(isPaneDead(agentId))) {
        reapWarmIdle = true;
      } else if (advancing) {
        const { status } = resolveCanonicalReviewStatus(issueId);
        reapWarmIdle = !!status && isRoleTerminal(role as 'review' | 'test' | 'ship', status);
      }
    } catch { /* probe failure → conservative: treat as active */ }
    if (!reapWarmIdle) {
      throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
    }
    console.log(`[spawn] ${agentId} is warm-idle from the previous cycle — reaping it for the new ${role} dispatch (PAN-2579)`);
    const { killSession } = await import('../tmux.js');
    await Effect.runPromise(killSession(agentId)).catch(() => {});
  }
  await prepareWorkspaceForAgentSpawn(issueId, role, options.allowHost, workspace);
  initHookSync(agentId);

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
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('../cliproxy.js');
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
  const shouldDeliverPromptViaCodexTui = shouldRegisterConversation && resolvedHarness === 'codex';
  const shouldDeliverPromptViaKimiCode = shouldRegisterConversation && resolvedHarness === 'kimi-code';
  const shouldDeliverPromptViaAcp = resolvedHarness === 'acp';
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
    const provider = getProviderForModelSync(selectedModel as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuthSync(provider, workspace);
    } else {
      clearCredentialFileAuthSync(workspace);
    }
  }

  const providerExports = isAcp ? undefined : await getProviderExportsForModel(selectedModel, resolvedHarness);
  const providerEnv = isAcp ? {} : await getProviderEnvForModel(selectedModel, resolvedHarness);
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
    ? getCodexLauncherFields(agentId, selectedModel, workspace, role)
    : {};
  const acpLauncherFields = isAcp
    ? getAcpLauncherFields(
        agentId,
        selectedModel,
        workspace,
        harnessLaunch.binaryPath,
        role,
      )
    : {};
  // PAN-1837 review fix: role runs (review/test/ship/plan/flywheel) reached
  // this launcher path without a Kimi field spread, so buildKimiCodeCommand()
  // threw 'kimi-code launcher requires kimiCodeModel' before a session could
  // even be created.
  const kimiCodeLauncherFields = resolvedHarness === 'kimi-code'
    ? getKimiCodeLauncherFields(selectedModel)
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
    rawSessionId = isAcp ? options.resumeSessionId : (options.resumeSessionId ?? randomUUID());

    if (!isAcp && rawSessionId) {
      // Persist the session ID to <agentDir>/session.id so resolveClaudeSessionId can locate the
      // JSONL after the specialist exits. Works for both fresh (--session-id) and resumed (--resume).
      try {
        const agentDir = getAgentDir(agentId);
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, 'session.id'), rawSessionId, 'utf-8');
      } catch (err) {
        console.warn(`[spawnRun] Failed to persist session.id for ${agentId}:`, err instanceof Error ? err.message : String(err));
      }
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
  await recordAgentPlaneSpawn(state, rawSessionId);
  // PAN-1557: interactive convoy wiring is already present in the initial
  // AgentState saved before launch, so the Stop-hook can always deliver
  // REVIEWER_READY even if a later running-state cache write is contended.
  const extraEnvExports = [harnessLaunch.pathExport, ...flywheelEnvExports(flywheelEnv), ...(options.extraEnvExports ?? [])];
  if (role === 'knowledge' && !extraEnvExports.includes('export PATH="$HOME/.overdeck/bin:$PATH"')) {
    extraEnvExports.push('export PATH="$HOME/.overdeck/bin:$PATH"');
  }

  const launcherContent = generateLauncherScriptSync({
    role,
    workingDir: workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    promptFileMode: undefined,
    overdeckEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    extraEnvExports,
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
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  try {
    const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
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
      OVERDECK_AGENT_STARTED_BY: startedBy,
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
    if (shouldDeliverPromptViaAcp) {
      try {
        await waitForPromptReady(agentId, resolvedHarness, 30);
        const delivery = await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt');
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
        const ready = await waitForPromptReady(agentId, resolvedHarness, 30);
        if (ready) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt');
        } else {
          console.error(`[${agentId}] ${getHarnessBehavior(resolvedHarness).displayName} did not become ready within 30s`);
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
    const { snapshotWorkspaceHeadsPromise } = await import('../git-utils.js');
    const headAnchor = await snapshotWorkspaceHeadsPromise(issueId, workspace);
    if (headAnchor) state.roleRunHead = headAnchor;
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

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await prepareWorkspaceForAgentSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHookSync(agentId);

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

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('../cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
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
    sessionId: createFreshSessionIdentity(agentId, resolvedHarness),
    flywheelRunId: flywheelEnv.OVERDECK_FLYWHEEL_RUN_ID,
    startedBy,
  };
  const supervisorLaunch = await prepareSupervisorForFreshLaunch(agentId, options, state);

  saveAgentStateSync(state);
  clearSessionResetMarker(agentId);
  await recordAgentPlaneSpawn(state);
  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (role === 'work') {
    try {
      const preservation = await shouldPreservePipelineVerdicts(options.issueId, options.workspace);
      if (preservation.preserve) {
        if (preservation.refreshedAnchor) refreshWorkStartReviewedAnchor(options.issueId, preservation.refreshedAnchor);
        console.log(`[spawn] Preserved pipeline verdicts for ${options.issueId} — ${preservation.reason}`);
      } else {
        const resetStatus = resetWorkStartPipelineVerdicts(options.issueId);
        if (resetStatus) resetPostMergeState(options.issueId);
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
      const { writeStoryFeatureContext } = await import('../cloister/work-agent-prompt.js');
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
      const project = findProjectByPathSync(workspace);
      if (project && !shouldCommitLegacyWorkspaceArtifacts(await isStateMigrated(project))) {
        console.warn(`[agents] Deferred legacy .pan/ index cleanup for ${options.issueId} — migrated projects use gitignored .overdeck/ runtime files; historical entries retire with the branch`);
      } else {
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
      }
    } catch (err: any) {
      console.warn(`[agents] .pan/ untrack cleanup failed for ${options.issueId}: ${err.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork } = checkHookSync(agentId);
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
    if (isTldrEnabledSync() && existsSync(venvPath)) {
      const { getTldrDaemonServiceSync } = await import('../tldr-daemon.js');
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

  // Pre-trust workspace directory in Claude Code to avoid the trust prompt
  try {
    const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(options.workspace);
  } catch { /* non-fatal */ }

  // Configure workspace for GitHub App bot identity (PAN-536)
  // Agents push as panopticon-agent[bot] with short-lived installation tokens
  try {
    const { isGitHubAppConfigured, generateInstallationToken, configureWorkspaceForBot } = await import('../github-app.js');
    if (isGitHubAppConfigured()) {
      const { findProjectByPathSync } = await import('../projects.js');
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

  // PAN-1837: Kimi generates its own session id and cannot be told one via a
  // launch flag (D2/erratum E1) — it must be captured post-launch as whatever
  // new directory appears under the workspace's session bucket. Snapshot the
  // bucket's current contents BEFORE the tmux session exists so the capture
  // below can diff against it instead of guessing from mtime alone, which
  // would misfire on a workspace that already has prior kimi sessions
  // (retries/resumes).
  //
  // PAN-1837 review fix: snapshot, launch, and capture/persist all run inside
  // withKimiSessionCaptureLock — a review cycle 6 finding is that awaiting
  // the capture (as restartAgent's own fix already did) is not sufficient on
  // its own: it only guarantees *some* new same-cwd directory was observed,
  // not that it's THIS launch's directory. Only the per-workDirKey mutex,
  // held across the whole snapshot -> createSession -> capture span, stops a
  // concurrent same-cwd Kimi launch (another work agent, a restart, a
  // recovery, or a conversation) from claiming this session or vice versa.
  const launchAndCaptureKimiSession = async (): Promise<void> => {
    let kimiExistingSessionsBefore: Set<string> | undefined;
    if (resolvedHarness === 'kimi-code') {
      try {
        const { kimiSessionsRoot } = await import('../runtimes/kimi-code.js');
        kimiExistingSessionsBefore = new Set(await readdirAsync(kimiSessionsRoot(join(homedir(), '.kimi-code'), options.workspace)));
      } catch {
        kimiExistingSessionsBefore = new Set();
      }
    }

    await Effect.runPromise(createSession(agentId, options.workspace, claudeCmd, {
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
      }
    }));

    if (kimiExistingSessionsBefore) {
      const { waitForNewKimiSessionAsync, writeKimiSessionId } = await import('../runtimes/kimi-code.js');
      const sessionId = await waitForNewKimiSessionAsync(
        join(homedir(), '.kimi-code'),
        options.workspace,
        kimiExistingSessionsBefore,
      );
      if (sessionId) {
        writeKimiSessionId(agentId, sessionId);
      } else {
        // PAN-1837 review fix: fail closed like restartAgent — a missing
        // capture would otherwise leave a running, unowned Kimi session whose
        // transcript lookup falls back to newest-session-by-mtime, which
        // cannot establish ownership in a shared cwd bucket and can display a
        // different session's transcript/cost under this agent.
        throw new Error(
          `kimi-code session capture timed out for ${agentId} — no new session directory appeared under the workspace bucket`,
        );
      }
    }
  };

  if (resolvedHarness === 'kimi-code') {
    const { withKimiSessionCaptureLock } = await import('../runtimes/kimi-code.js');
    try {
      await withKimiSessionCaptureLock(join(homedir(), '.kimi-code'), options.workspace, launchAndCaptureKimiSession);
    } catch (err) {
      await Effect.runPromise(stopAgent(agentId)).catch(() => undefined);
      throw err;
    }
  } else {
    await launchAndCaptureKimiSession();
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
        await recordKickoffDeliveryFailure(state, options.issueId, role);
      }
      await Effect.runPromise(stopAgent(agentId));
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
        await recordKickoffDeliveryFailure(state, options.issueId, role);
        await Effect.runPromise(stopAgent(agentId));
        throw new Error(`Agent ${agentId} kickoff delivery failed: ${err instanceof Error ? err.message : String(err)}`);
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
      await Effect.runPromise(stopAgent(agentId));
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
    const codexHomeForAgent = join(homedir(), '.overdeck', 'agents', agentId, 'codex-home');
    void (async () => {
      try {
        const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId } =
          await import('../runtimes/codex.js');
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
