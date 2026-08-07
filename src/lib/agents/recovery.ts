import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { readdir as readdirAsync } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { getLatestSessionIdSync } from './activity.js';
import { sendGracefulRestartWarning } from '../graceful-restart.js';
import { checkHookSync, generateFixedPointPromptSync } from '../hooks.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { resolveHarness } from '../harness-resolve.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { normalizeModelOverrideSync, requireModelOverrideSync } from '../model-validation.js';
import { logAgentLifecycleSync } from '../persistent-logger.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from '../providers.js';
import type { ModelId } from '../settings.js';
import { normalizeHarness } from '../overdeck/conversations.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import {
  createSession,
  createSessionSync,
  killSessionSync,
  listPaneValues,
  sendKeys,
  sessionExists,
  sessionExistsSync,
} from '../tmux.js';
import {
  decideResumeGate,
  getAgentDir,
  getAgentResumeGateBlockReason,
  getAgentStateSync,
  markAgentRunning,
  saveAgentStateSync,
  type AgentState,
  type Role,
} from './agent-state.js';
import { deliverAgentMessage, deliverInitialPromptWithRetry, resilientDeliveryMethod } from './delivery.js';
import { clearReadySignal, normalizeAgentId } from './identity.js';
import {
  detectPendingOperatorDecision,
  type PendingOperatorDecision,
} from './pending-decision-gate.js';
import { listRunningAgentsSync } from './queries.js';
import { getProviderEnvForModel, getProviderExportsForModel } from './provider-env.js';
import { saveAgentRuntimeState } from './runtime-state.js';
import {
  claudeSystemPromptFiles,
  getCodexLauncherFields,
  getRoleRuntimeBaseCommand,
  hasAgentRuntimeInSubtree,
  waitForPromptReady,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './runtime-command.js';
import { assertWorkspaceStackHealthyForSpawn, buildAgentLaunchConfig } from './spawn-prep.js';
import { prepareSupervisorForRelaunch, buildResumeContinueMessage } from './supervisor-channels.js';
import { stopAgent } from './termination.js';

export type RecoverAgentResult =
  | { action: 'respawned'; state: AgentState }
  | { action: 'already-running'; state: AgentState };

export interface RestartAgentOptions {
  model?: string;
  harness?: RuntimeName;
  graceful?: boolean;
  message?: string;
  force?: boolean;
}

export interface RestartAgentResult {
  success: boolean;
  error?: string;
  code?: 'pending-operator-decision';
  pendingDecision?: PendingOperatorDecision;
}

export interface RestartAgentDeps {
  detectPendingOperatorDecision?: (agentId: string) => Promise<PendingOperatorDecision | null>;
  getAgentStateSync?: typeof getAgentStateSync;
  logAgentLifecycleSync?: typeof logAgentLifecycleSync;
  assertWorkspaceStackHealthyForSpawn?: typeof assertWorkspaceStackHealthyForSpawn;
  resolveHarness?: typeof resolveHarness;
  prepareHarnessLaunch?: typeof prepareHarnessLaunch;
  sessionExists?: (agentId: string) => Promise<boolean>;
  sendGracefulRestartWarning?: typeof sendGracefulRestartWarning;
  stopAgent?: (agentId: string) => Promise<unknown>;
}

export function resolveRecoveryResumeSessionId(agentId: string, harness: RuntimeName): string | undefined {
  if (harness !== 'codex' && harness !== 'acp' && harness !== 'kimi-code') return undefined;
  return getLatestSessionIdSync(agentId) ?? undefined;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
  deps: RestartAgentDeps = {},
): Promise<RestartAgentResult> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message, force = false } = opts;
  const newModel = normalizeModelOverrideSync(rawNewModel);
  const readAgentState = deps.getAgentStateSync ?? getAgentStateSync;
  const detectPendingDecision = deps.detectPendingOperatorDecision ?? detectPendingOperatorDecision;
  const logLifecycle = deps.logAgentLifecycleSync ?? logAgentLifecycleSync;
  const assertWorkspaceHealthy = deps.assertWorkspaceStackHealthyForSpawn
    ?? assertWorkspaceStackHealthyForSpawn;
  const resolveRestartHarness = deps.resolveHarness ?? resolveHarness;
  const prepareRestartHarness = deps.prepareHarnessLaunch ?? prepareHarnessLaunch;
  const restartSessionExists = deps.sessionExists
    ?? ((id: string) => Effect.runPromise(sessionExists(id)));
  const sendRestartWarning = deps.sendGracefulRestartWarning ?? sendGracefulRestartWarning;
  const stopRestartAgent = deps.stopAgent
    ?? ((id: string) => Effect.runPromise(stopAgent(id)));

  const agentState = readAgentState(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  const gateDecision = decideResumeGate(getAgentResumeGateBlockReason(agentState), 'operator-start');
  if (gateDecision.decision === 'block') {
    const reason = `Cannot restart ${normalizedId}: ${gateDecision.reason}. Clear the gate before restarting.`;
    logLifecycle(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  const checkPendingDecision = async (): Promise<RestartAgentResult | null> => {
    if (force) return null;
    const pendingDecision = await detectPendingDecision(normalizedId);
    if (!pendingDecision) return null;

    const pendingReason = pendingDecision.reason.replaceAll('_', ' ');
    const issueId = agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();
    const reason = `Agent ${normalizedId} is waiting on an operator decision (${pendingReason}). Answer it with 'pan answer ${issueId}' or open the Decisions panel; pass force to discard it deliberately.`;
    logLifecycle(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason,
      code: 'pending-operator-decision',
      pendingDecision,
    };
  };

  const initialPendingDecision = await checkPendingDecision();
  if (initialPendingDecision) return initialPendingDecision;
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logLifecycle(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'}, harness=${newHarness || 'unchanged'})`);

  try {
    await assertWorkspaceHealthy(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logLifecycle(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  const effectiveModel = newModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
  const effectiveHarness = await resolveRestartHarness({
    explicit: newHarness ?? agentState.harness,
    role: agentState.role,
    model: effectiveModel,
  });
  const harnessLaunch = await prepareRestartHarness(effectiveHarness);

  if (graceful && await restartSessionExists(normalizedId)) {
    const warningPendingDecision = await checkPendingDecision();
    if (warningPendingDecision) return warningPendingDecision;
    await sendRestartWarning(normalizedId, agentState.harness, agentState.workspace);
  }

  const stopPendingDecision = await checkPendingDecision();
  if (stopPendingDecision) return stopPendingDecision;
  await stopRestartAgent(normalizedId);

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
      harnessBinaryPath: harnessLaunch.binaryPath,
      useSupervisor: supervisorLaunch.useSupervisor,
      supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
      extraEnvExports: [harnessLaunch.pathExport],
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    // PAN-1837: restartAgent always kills and fresh-launches (no resumeSessionId
    // above), so a kimi-code relaunch always starts a brand-new Kimi session —
    // snapshot the bucket before the tmux session exists so the capture below
    // can diff against it (mirrors spawnAgent's fresh-launch capture in
    // spawn.ts).
    //
    // PAN-1837 review fix: clear the stale kimi-session-id pointer BEFORE the
    // fresh launch, so a failed/timed-out capture leaves NO pointer
    // (findKimiWirePath's safe newest-session-by-mtime fallback) rather than a
    // WRONG pointer still pinned to the pre-restart transcript. Review cycle 6:
    // snapshot, createSession, and capture/persist all run inside
    // withKimiSessionCaptureLock — merely awaiting the capture (the cycle-5
    // fix) is not enough on its own, since it only proves *some* new same-cwd
    // directory appeared, not that it's THIS relaunch's. Only the per-
    // workDirKey mutex, held across the whole span, stops a concurrent
    // same-cwd Kimi launch (another work agent, a conversation, or a recovery)
    // from claiming this session or vice versa.
    const launchAndCaptureKimiSession = async (): Promise<void> => {
      let kimiExistingSessionsBefore: Set<string> | undefined;
      if (effectiveHarness === 'kimi-code') {
        try { unlinkSync(join(getAgentDir(normalizedId), 'kimi-session-id')); } catch { /* absent or already cleared */ }
        try {
          const { kimiSessionsRoot } = await import('../runtimes/kimi-code.js');
          kimiExistingSessionsBefore = new Set(await readdirAsync(kimiSessionsRoot(join(homedir(), '.kimi-code'), agentState.workspace)));
        } catch {
          kimiExistingSessionsBefore = new Set();
        }
      }

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

      if (kimiExistingSessionsBefore) {
        const { waitForNewKimiSessionAsync, writeKimiSessionId } = await import('../runtimes/kimi-code.js');
        const sessionId = await waitForNewKimiSessionAsync(
          join(homedir(), '.kimi-code'),
          agentState.workspace,
          kimiExistingSessionsBefore,
        );
        if (!sessionId) {
          throw new Error(
            `kimi-code session capture timed out after fresh relaunch for ${normalizedId} — no new session directory appeared under the workspace bucket`,
          );
        }
        writeKimiSessionId(normalizedId, sessionId);
      }
    };

    if (effectiveHarness === 'kimi-code') {
      const { withKimiSessionCaptureLock } = await import('../runtimes/kimi-code.js');
      await withKimiSessionCaptureLock(join(homedir(), '.kimi-code'), agentState.workspace, launchAndCaptureKimiSession);
    } else {
      await launchAndCaptureKimiSession();
    }

    // PAN-2974 (root cause B): the fallback continue-prompt is phase-aware —
    // a handed-off agent (completed marker) gets a passive restore, not a
    // "pick up where you left off" that re-drives the pipeline.
    const prompt = message || buildResumeContinueMessage(agentState);
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
      if (!ready) {
        throw new Error(`${getHarnessBehavior(effectiveHarness).displayName} did not become ready within 30s for ${normalizedId}`);
      }
      await new Promise(r => setTimeout(r, 500));
      if (effectiveHarness === 'codex' || effectiveHarness === 'acp' || effectiveHarness === 'kimi-code') {
        // PAN-1837: kimi-code's deliveryKind is pty-supervisor, same as codex/acp —
        // it must not fall through to the legacy sync sendKeys() branch below,
        // which bypasses the supervisor cascade entirely.
        const delivery = await deliverAgentMessage(
          normalizedId,
          prompt,
          'restartAgent:continue-prompt',
          effectiveHarness === 'codex' ? resilientDeliveryMethod(agentState.deliveryMethod) : undefined,
        );
        if (!delivery.ok) {
          throw new Error(`${getHarnessBehavior(effectiveHarness).displayName} continue prompt delivery failed`);
        }
      } else {
        await Effect.runPromise(sendKeys(normalizedId, prompt));
      }
    }

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });

    logLifecycle(normalizedId, `restartAgent SUCCESS: model=${effectiveModel}`);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await Effect.runPromise(stopAgent(normalizedId)).catch(() => undefined);
    logLifecycle(normalizedId, `restartAgent FAILED: ${msg}`);
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
  opts: { modelOverride?: string; force?: boolean } = {},
): Promise<RecoverAgentResult | null> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycleSync(normalizedId, 'recoverAgent called');
  const state = getAgentStateSync(normalizedId);

  if (!state) {
    logAgentLifecycleSync(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const gateDecision = decideResumeGate(getAgentResumeGateBlockReason(state), 'operator-start');
  if (gateDecision.decision === 'block') {
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: Cannot recover ${normalizedId}: ${gateDecision.reason}. Clear the gate before recovering.`);
    return null;
  }
  if (!opts.force) {
    const pendingDecision = await detectPendingOperatorDecision(normalizedId);
    if (pendingDecision) {
      logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: pending operator decision (${pendingDecision.reason})`);
      return null;
    }
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
      logAgentLifecycleSync(normalizedId, 'recoverAgent NO_ACTION: live harness runtime is already running');
      return { action: 'already-running', state };
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
  const harnessLaunch = await prepareHarnessLaunch(recoveryHarness);
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
      harnessBinaryPath: harnessLaunch.binaryPath,
      extraEnvExports: [harnessLaunch.pathExport],
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
    return { action: 'respawned', state };
  }

  if (recoveryHarness === 'acp') {
    const resumeSessionId = resolveRecoveryResumeSessionId(normalizedId, recoveryHarness);
    const { launcherContent, providerEnv: acpProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      ...(resumeSessionId ? { spawnMode: 'resume' as const, resumeSessionId } : {}),
      harness: 'acp',
      harnessBinaryPath: harnessLaunch.binaryPath,
      extraEnvExports: [harnessLaunch.pathExport],
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
        ...acpProviderEnv,
      },
    }));
    const delivery = await deliverInitialPromptWithRetry(
      normalizedId,
      recoveryPrompt,
      'recoverAgent:acp-recovery-prompt',
    );
    if (!delivery.ok) {
      await Effect.runPromise(stopAgent(normalizedId));
      throw new Error(
        `ACP recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`,
      );
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (acp)`);
    return { action: 'respawned', state };
  }

  if (recoveryHarness === 'kimi-code') {
    // PAN-1837: kimi-code has no launcher-writable session.id — its resume id
    // comes from resolveRecoveryResumeSessionId (kimi-session-newest source)
    // and buildAgentLaunchConfig threads kimiCodeLauncherFields (model/yolo)
    // that buildKimiCodeCommand() requires; the generic default branch below
    // never sets those and would throw "kimi-code launcher requires kimiCodeModel".
    const resumeSessionId = resolveRecoveryResumeSessionId(normalizedId, recoveryHarness);
    const { launcherContent, providerEnv: kimiProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      ...(resumeSessionId ? { spawnMode: 'resume' as const, resumeSessionId } : {}),
      harness: 'kimi-code',
      harnessBinaryPath: harnessLaunch.binaryPath,
      extraEnvExports: [harnessLaunch.pathExport],
    });
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);

    // PAN-1837 review fix: snapshot, createSession, and capture/persist all run
    // inside withKimiSessionCaptureLock (review cycle 6) — a fire-and-forget or
    // merely-awaited capture outside the per-workDirKey mutex only proves *some*
    // new same-cwd directory appeared, not that it's THIS recovery's, so a
    // concurrent same-cwd Kimi launch (a work agent, a restart, or a
    // conversation) could otherwise claim this session or vice versa. When
    // there is no captured session id to resume, this recovery is a fresh
    // Kimi launch — snapshot the workspace's session bucket BEFORE the tmux
    // session exists so the capture below can diff against it and persist the
    // new session id for the NEXT recovery.
    const launchAndCaptureKimiSession = async (): Promise<void> => {
      let kimiExistingSessionsBefore: Set<string> | undefined;
      if (!resumeSessionId) {
        try {
          const { kimiSessionsRoot } = await import('../runtimes/kimi-code.js');
          kimiExistingSessionsBefore = new Set(await readdirAsync(kimiSessionsRoot(join(homedir(), '.kimi-code'), state.workspace)));
        } catch {
          kimiExistingSessionsBefore = new Set();
        }
      }

      await Effect.runPromise(createSession(normalizedId, state.workspace, `bash ${launcherScript}`, {
        env: {
          ...BLANKED_PROVIDER_ENV,
          OVERDECK_AGENT_ID: normalizedId,
          OVERDECK_ISSUE_ID: state.issueId || '',
          OVERDECK_SESSION_TYPE: recoveryRole,
          CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
          ...kimiProviderEnv,
        },
      }));

      if (kimiExistingSessionsBefore) {
        const { waitForNewKimiSessionAsync, writeKimiSessionId } = await import('../runtimes/kimi-code.js');
        const sessionId = await waitForNewKimiSessionAsync(
          join(homedir(), '.kimi-code'),
          state.workspace,
          kimiExistingSessionsBefore,
        );
        if (sessionId) {
          writeKimiSessionId(normalizedId, sessionId);
        } else {
          // PAN-1837 review fix: fail closed like restartAgent/spawnAgent — a
          // missing capture would otherwise leave a running, unowned Kimi
          // session whose transcript lookup falls back to
          // newest-session-by-mtime, which cannot establish ownership in a
          // shared cwd bucket and can display a different session's
          // transcript/cost under this agent.
          throw new Error(
            `kimi-code session capture timed out after fresh relaunch for ${normalizedId} — no new session directory appeared under the workspace bucket`,
          );
        }
      }
    };

    const { withKimiSessionCaptureLock } = await import('../runtimes/kimi-code.js');
    try {
      await withKimiSessionCaptureLock(join(homedir(), '.kimi-code'), state.workspace, launchAndCaptureKimiSession);
    } catch (err) {
      await Effect.runPromise(stopAgent(normalizedId)).catch(() => undefined);
      throw err;
    }

    const delivery = await deliverInitialPromptWithRetry(
      normalizedId,
      recoveryPrompt,
      'recoverAgent:kimi-code-recovery-prompt',
    );
    if (!delivery.ok) {
      await Effect.runPromise(stopAgent(normalizedId));
      throw new Error(
        `Kimi Code recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`,
      );
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (kimi-code)`);
    return { action: 'respawned', state };
  }

  const recoveryCodexFields = recoveryHarness === 'codex'
    ? getCodexLauncherFields(normalizedId, state.model, state.workspace, recoveryRole)
    : {};
  const recoveryLauncherContent = generateLauncherScriptSync({
    role: recoveryRole,
    workingDir: state.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports: (await getProviderExportsForModel(state.model)).trimEnd(),
    extraEnvExports: [harnessLaunch.pathExport],
    baseCommand: await getRoleRuntimeBaseCommand(state.model, normalizedId, recoveryRole, recoveryHarness),
    appendSystemPromptFiles: await claudeSystemPromptFiles(state.workspace, recoveryHarness),
    ...(recoveryHarness === 'codex' ? {} : { promptInline: recoveryPrompt }),
    resumeSessionId: resolveRecoveryResumeSessionId(normalizedId, recoveryHarness),
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
  return { action: 'respawned', state };
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
    '1. Check the xBRIEF task state: `pan task show ' + state.issueId + ' <item-id>`',
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
      if (result?.action === 'respawned') {
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
