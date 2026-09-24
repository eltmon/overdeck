import { resolveMuseSessionPathSync, museSessionId } from '../runtimes/storage/muse.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { readdir as readdirAsync } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { getLatestSessionId } from './activity.js';
import { sendGracefulRestartWarning } from '../graceful-restart.js';
import { checkHook, generateFixedPointPrompt } from '../hooks.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { resolveHarness } from '../harness-resolve.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { normalizeModelOverride, requireModelOverride } from '../model-validation.js';
import { logAgentLifecycle } from '../persistent-logger.js';
import { getProviderForModel, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import type { ModelId } from '../settings.js';
import { normalizeHarness } from '../overdeck/conversations.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import {
  agentPaneExists,
  closeAgentPane,
  launchAgentPane,
} from '../terminal-backends/launch.js';
import { toPaneRole } from '../terminal-backends/prompt-guard.js';
import type { AgentPaneRef } from '../terminal-backends/types.js';
import {
  decideResumeGate,
  getAgentDir,
  getAgentResumeGateBlockReason,
  getAgentState,
  markAgentRunning,
  saveAgentStateSync,
  type AgentState,
  type Role,
} from './agent-state.js';
import { deliverAgentMessage, deliverInitialPromptWithRetry, resilientDeliveryMethod } from './delivery.js';
import { clearReadySignal, normalizeAgentId } from './identity.js';
import { isAlive } from './liveness.js';
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
  waitForPromptReady,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './runtime-command.js';
import { assertWorkspaceStackHealthyForSpawn, buildAgentLaunchConfig } from './spawn-prep.js';
import { prepareSupervisorForRelaunch, buildResumeContinueMessage } from './supervisor-channels.js';
import { stopAgent } from './termination.js';
import { createFreshSessionIdentity } from '../session-history.js';
import { kimiHomeDefault } from '../runtimes/storage/kimi-code.js';

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
  getAgentStateSync?: typeof getAgentState;
  logAgentLifecycleSync?: typeof logAgentLifecycle;
  assertWorkspaceStackHealthyForSpawn?: typeof assertWorkspaceStackHealthyForSpawn;
  resolveHarness?: typeof resolveHarness;
  prepareHarnessLaunch?: typeof prepareHarnessLaunch;
  sessionExists?: (agentId: string) => Promise<boolean>;
  sendGracefulRestartWarning?: typeof sendGracefulRestartWarning;
  stopAgent?: (agentId: string) => Promise<unknown>;
  allocateSessionIdentity?: typeof createFreshSessionIdentity;
}

function prepareRestartSessionIdentity(
  agentId: string,
  harness: RuntimeName,
  state: AgentState,
  allocate: typeof createFreshSessionIdentity = createFreshSessionIdentity,
): string | undefined {
  const sessionId = allocate(agentId, harness, state.model);
  if (sessionId) state.sessionId = sessionId;
  else delete state.sessionId;
  return sessionId;
}

export function resolveRecoveryResumeSessionId(agentId: string, harness: RuntimeName): string | undefined {
  if (harness === 'muse') {
    const path = resolveMuseSessionPathSync(agentId);
    return path ? museSessionId(path) : undefined;
  }
  if (harness !== 'codex' && harness !== 'acp' && harness !== 'kimi-code' && harness !== 'opencode') return undefined;
  const state = getAgentState(agentId);
  const resolutionState = state
    ? { ...state, harness }
    : { id: agentId, harness } as AgentState;
  return getLatestSessionId(agentId, { getAgentState: () => resolutionState }) ?? undefined;
}

/**
 * Relaunch an agent's pane through the terminal backend the host selects NOW
 * (PAN-3960) — never the one its previous pane used, so a restart or recovery
 * on a Herdr host lands on Herdr and one on a tmux-only host lands on tmux.
 * Stamps the same four tokens `spawn.ts` does and records the pane on the
 * state so a failure after this point is still addressable.
 */
async function relaunchAgentPane(input: {
  agentId: string;
  state: AgentState;
  role: string | undefined;
  harness: RuntimeName;
  model: string;
  launcherScript: string;
  env: Record<string, string>;
}): Promise<AgentPaneRef> {
  const issueId = input.state.issueId
    || input.agentId.replace(/^(agent|planning)-/, '').toUpperCase();
  const pane = await launchAgentPane({
    issueId,
    cwd: input.state.workspace,
    agentId: input.agentId,
    argv: ['bash', input.launcherScript],
    env: input.env,
    tokens: {
      issue: issueId,
      role: toPaneRole(input.role),
      harness: input.harness,
      model: input.model,
    },
  });
  input.state.backend = pane.backend;
  input.state.paneId = pane.paneId;
  saveAgentStateSync(input.state);
  return pane;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
  deps: RestartAgentDeps = {},
): Promise<RestartAgentResult> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message, force = false } = opts;
  const newModel = normalizeModelOverride(rawNewModel);
  const readAgentState = deps.getAgentStateSync ?? getAgentState;
  const detectPendingDecision = deps.detectPendingOperatorDecision ?? detectPendingOperatorDecision;
  const logLifecycle = deps.logAgentLifecycleSync ?? logAgentLifecycle;
  const assertWorkspaceHealthy = deps.assertWorkspaceStackHealthyForSpawn
    ?? assertWorkspaceStackHealthyForSpawn;
  const resolveRestartHarness = deps.resolveHarness ?? resolveHarness;
  const prepareRestartHarness = deps.prepareHarnessLaunch ?? prepareHarnessLaunch;
  // Backend-aware (PAN-3960): a live tmux session or a live Herdr agent.
  // A liveness read: an unavailable backend (PAN-3956) is "no session" here, and
  // the launch below reports the TerminalBackendUnavailableError as a failure.
  const restartSessionExists = deps.sessionExists ?? ((id: string) => agentPaneExists(id).catch(() => false));
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

  const effectiveModel = newModel || requireModelOverride(agentState.model || 'claude-sonnet-4-6');
  const effectiveHarness = await resolveRestartHarness({
    explicit: newHarness ?? agentState.harness,
    role: agentState.role,
    model: effectiveModel,
  });
  const harnessLaunch = await prepareRestartHarness(effectiveHarness);

  if (graceful && await restartSessionExists(normalizedId)) {
    const warningPendingDecision = await checkPendingDecision();
    if (warningPendingDecision) return warningPendingDecision;
    await sendRestartWarning(normalizedId, agentState.harness, agentState.workspace, deliverAgentMessage);
  }

  const stopPendingDecision = await checkPendingDecision();
  if (stopPendingDecision) return stopPendingDecision;
  await stopRestartAgent(normalizedId);

  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.harness = effectiveHarness;
  agentState.status = 'starting';
  let freshSessionId: string | undefined;
  try {
    freshSessionId = prepareRestartSessionIdentity(
      normalizedId,
      effectiveHarness,
      agentState,
      deps.allocateSessionIdentity ?? createFreshSessionIdentity,
    );
    saveAgentStateSync(agentState);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logLifecycle(normalizedId, `restartAgent ABORTED before launch: session index write failed: ${msg}`);
    return { success: false, error: `Failed to restart agent: session index write failed: ${msg}` };
  }

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
      sessionId: freshSessionId,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);

    // PAN-1837: restartAgent always kills and fresh-launches (no resumeSessionId
    // above), so a kimi-code relaunch always starts a brand-new Kimi session —
    // snapshot the bucket before the pane exists so the capture below
    // can diff against it (mirrors spawnAgent's fresh-launch capture in
    // spawn.ts).
    //
    // PAN-1837 review fix: clear the stale kimi-session-id pointer BEFORE the
    // fresh launch, so a failed/timed-out capture leaves NO pointer
    // (findKimiWirePath's safe newest-session-by-mtime fallback) rather than a
    // WRONG pointer still pinned to the pre-restart transcript. Review cycle 6:
    // snapshot, the pane launch, and capture/persist all run inside
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
          const { kimiSessionsRoot } = await import('../runtimes/storage/kimi-code.js');
          kimiExistingSessionsBefore = new Set(await readdirAsync(kimiSessionsRoot(kimiHomeDefault(), agentState.workspace)));
        } catch {
          kimiExistingSessionsBefore = new Set();
        }
      }

      await relaunchAgentPane({
        agentId: normalizedId,
        state: agentState,
        role: agentState.role,
        harness: effectiveHarness,
        model: effectiveModel,
        launcherScript,
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
      });

      if (kimiExistingSessionsBefore) {
        const { waitForNewKimiSessionAsync, recordKimiSessionCapture } = await import('../runtimes/kimi-code.js');
        const sessionId = await waitForNewKimiSessionAsync(
          kimiHomeDefault(),
          agentState.workspace,
          kimiExistingSessionsBefore,
        );
        if (!sessionId) {
          throw new Error(
            `kimi-code session capture timed out after fresh relaunch for ${normalizedId} — no new session directory appeared under the workspace bucket`,
          );
        }
        recordKimiSessionCapture(normalizedId, sessionId, agentState.workspace);
      }
    };

    if (effectiveHarness === 'kimi-code') {
      const { withKimiSessionCaptureLock } = await import('../runtimes/kimi-code.js');
      await withKimiSessionCaptureLock(kimiHomeDefault(), agentState.workspace, launchAndCaptureKimiSession);
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
      const timeout = getHarnessBehavior(effectiveHarness).readyTimeoutSeconds;
      const ready = await waitForPromptReady(normalizedId, effectiveHarness, timeout);
      if (!ready) {
        throw new Error(`${getHarnessBehavior(effectiveHarness).displayName} did not become ready within ${timeout}s for ${normalizedId}`);
      }
      await new Promise(r => setTimeout(r, 500));
      // PAN-1837: kimi-code's deliveryKind is pty-supervisor, same as codex/acp.
      // PAN-3960: claude-code goes through the same backend-aware delivery —
      // a direct tmux paste cannot reach a Herdr pane.
      const delivery = await deliverAgentMessage(
        normalizedId,
        prompt,
        'restartAgent:continue-prompt',
        effectiveHarness === 'codex' ? resilientDeliveryMethod(agentState.deliveryMethod) : undefined,
      );
      if (!delivery.ok) {
        throw new Error(`${getHarnessBehavior(effectiveHarness).displayName} continue prompt delivery failed`);
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
  logAgentLifecycle(normalizedId, 'recoverAgent called');
  const state = getAgentState(normalizedId);

  if (!state) {
    logAgentLifecycle(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const gateDecision = decideResumeGate(getAgentResumeGateBlockReason(state), 'operator-start');
  if (gateDecision.decision === 'block') {
    logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: Cannot recover ${normalizedId}: ${gateDecision.reason}. Clear the gate before recovering.`);
    return null;
  }
  if (!opts.force) {
    const pendingDecision = await detectPendingOperatorDecision(normalizedId);
    if (pendingDecision) {
      logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: pending operator decision (${pendingDecision.reason})`);
      return null;
    }
  }
  const modelOverride = normalizeModelOverride(opts.modelOverride);
  if (modelOverride) {
    state.model = modelOverride;
    logAgentLifecycle(normalizedId, `recoverAgent: model overridden → ${modelOverride}`);
  }
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: ${reason}`);
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
    logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  // Check if already running. A pane may still exist with only a bare shell
  // after the harness exited (a zombie). liveness.ts is the one oracle and is
  // backend-aware (PAN-3960): alive → nothing to do; a confirmed death → close
  // whatever pane or session is left and recover. A probe that could not answer
  // (`runtime-indeterminate`) is never a death, so nothing is reaped on it. On
  // a Herdr host a live same-name tmux session (an agent from before the
  // switch) answers alive, so it is never reaped (review of #3992, M3).
  const liveness = await isAlive(normalizedId);
  if (liveness.alive) {
    logAgentLifecycle(normalizedId, 'recoverAgent NO_ACTION: live harness runtime is already running');
    return { action: 'already-running', state };
  }
  if (liveness.reason === 'runtime-indeterminate') {
    logAgentLifecycle(normalizedId, 'recoverAgent NO_ACTION: liveness probe was indeterminate — not reaping a possibly-live agent');
    return { action: 'already-running', state };
  }
  if (await closeAgentPane(normalizedId)) {
    console.log(`[agents] ${normalizedId} pane was a zombie (${liveness.reason}) — closed it and recovering`);
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
  const recoveryHarness: RuntimeName = normalizeHarness(state.harness ?? null) ?? 'claude-code';
  const providerEnv = state.model ? await getProviderEnvForModel(state.model, recoveryHarness) : {};

  // For credential-file providers, ensure apiKeyHelper is configured.
  // For all other providers, clear stale apiKeyHelper from previous runs.
  if (state.model) {
    const provider = getProviderForModel(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuth(provider, state.workspace);
    } else {
      clearCredentialFileAuth(state.workspace);
    }
  }

  // Restart the agent with recovery context. PAN-1048 C4: derive the role from
  // the saved AgentState (or the session-id heuristic for legacy planning-* IDs)
  // and route through getRoleRuntimeBaseCommand so review/test/ship don't get
  // resurrected as work agents.
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
    await relaunchAgentPane({
      agentId: normalizedId,
      state,
      role: recoveryRole,
      harness: 'ohmypi',
      model: state.model,
      launcherScript,
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: state.issueId || '',
        OVERDECK_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...piProviderEnv,
      },
    });
    try {
      await writeOhmypiAgentPrompt(normalizedId, recoveryPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recoverAgent] ohmypi recovery prompt delivery failed for ${normalizedId}: ${msg}`);
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (ohmypi)`);
    return { action: 'respawned', state };
  }

  if (recoveryHarness === 'acp' || recoveryHarness === 'opencode' || recoveryHarness === 'muse') {
    const resumeSessionId = resolveRecoveryResumeSessionId(normalizedId, recoveryHarness);
    const { launcherContent, providerEnv: acpProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      ...(resumeSessionId ? { spawnMode: 'resume' as const, resumeSessionId } : {}),
      harness: recoveryHarness,
      useSupervisor: recoverySupervisorLaunch.useSupervisor,
      supervisorScriptPath: recoverySupervisorLaunch.supervisorScriptPath,
      harnessBinaryPath: harnessLaunch.binaryPath,
      extraEnvExports: [harnessLaunch.pathExport],
    });
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    await relaunchAgentPane({
      agentId: normalizedId,
      state,
      role: recoveryRole,
      harness: recoveryHarness,
      model: state.model,
      launcherScript,
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: state.issueId || '',
        OVERDECK_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...acpProviderEnv,
      },
    });
    if (recoveryHarness === 'muse' && !await waitForPromptReady(normalizedId, recoveryHarness, getHarnessBehavior(recoveryHarness).readyTimeoutSeconds)) {
      await Effect.runPromise(stopAgent(normalizedId));
      throw new Error(`Muse recovery readiness timed out for ${normalizedId}`);
    }
    const delivery = await deliverInitialPromptWithRetry(
      normalizedId,
      recoveryPrompt,
      `recoverAgent:${recoveryHarness}-recovery-prompt`,
    );
    if (!delivery.ok) {
      await Effect.runPromise(stopAgent(normalizedId));
      throw new Error(
        `${getHarnessBehavior(recoveryHarness).displayName} recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`,
      );
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (${recoveryHarness})`);
    return { action: 'respawned', state };
  }

  if (recoveryHarness === 'kimi-code') {
    // PAN-1837: kimi-code has no launcher-writable session index — its resume id
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

    // PAN-1837 review fix: snapshot, the pane launch, and capture/persist all run
    // inside withKimiSessionCaptureLock (review cycle 6) — a fire-and-forget or
    // merely-awaited capture outside the per-workDirKey mutex only proves *some*
    // new same-cwd directory appeared, not that it's THIS recovery's, so a
    // concurrent same-cwd Kimi launch (a work agent, a restart, or a
    // conversation) could otherwise claim this session or vice versa. When
    // there is no captured session id to resume, this recovery is a fresh
    // Kimi launch — snapshot the workspace's session bucket BEFORE the pane
    // exists so the capture below can diff against it and persist the
    // new session id for the NEXT recovery.
    const launchAndCaptureKimiSession = async (): Promise<void> => {
      let kimiExistingSessionsBefore: Set<string> | undefined;
      if (!resumeSessionId) {
        try {
          const { kimiSessionsRoot } = await import('../runtimes/storage/kimi-code.js');
          kimiExistingSessionsBefore = new Set(await readdirAsync(kimiSessionsRoot(kimiHomeDefault(), state.workspace)));
        } catch {
          kimiExistingSessionsBefore = new Set();
        }
      }

      await relaunchAgentPane({
        agentId: normalizedId,
        state,
        role: recoveryRole,
        harness: 'kimi-code',
        model: state.model,
        launcherScript,
        env: {
          ...BLANKED_PROVIDER_ENV,
          OVERDECK_AGENT_ID: normalizedId,
          OVERDECK_ISSUE_ID: state.issueId || '',
          OVERDECK_SESSION_TYPE: recoveryRole,
          CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
          ...kimiProviderEnv,
        },
      });

      if (kimiExistingSessionsBefore) {
        const { waitForNewKimiSessionAsync, recordKimiSessionCapture } = await import('../runtimes/kimi-code.js');
        const sessionId = await waitForNewKimiSessionAsync(
          kimiHomeDefault(),
          state.workspace,
          kimiExistingSessionsBefore,
        );
        if (sessionId) {
          recordKimiSessionCapture(normalizedId, sessionId, state.workspace);
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
      await withKimiSessionCaptureLock(kimiHomeDefault(), state.workspace, launchAndCaptureKimiSession);
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
    logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (kimi-code)`);
    return { action: 'respawned', state };
  }

  const recoveryCodexFields = recoveryHarness === 'codex'
    ? getCodexLauncherFields(normalizedId, state.model, state.workspace, recoveryRole)
    : {};
  const recoveryLauncherContent = generateLauncherScript({
    role: recoveryRole,
    workingDir: state.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports: (await getProviderExportsForModel(state.model, recoveryHarness)).trimEnd(),
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
  await relaunchAgentPane({
    agentId: normalizedId,
    state,
    role: recoveryRole,
    harness: recoveryHarness,
    model: state.model,
    launcherScript,
    env: {
      ...BLANKED_PROVIDER_ENV,
      OVERDECK_AGENT_ID: normalizedId,
      OVERDECK_ISSUE_ID: state.issueId || '',
      OVERDECK_SESSION_TYPE: state.role ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work'),
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    },
  });
  if (recoveryHarness === 'codex') {
    const delivery = await deliverInitialPromptWithRetry(normalizedId, recoveryPrompt, 'recoverAgent:recovery-prompt', state.deliveryMethod);
    if (!delivery.ok) {
      console.error(`[recoverAgent] Codex recovery prompt delivery failed for ${normalizedId}: ${delivery.failure ?? 'unknown failure'}`);
    }
  }
  // Update state
  markAgentRunning(state);
  saveAgentStateSync(state);

  logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount}`);
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
  const { hasWork } = checkHook(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(state.id);
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
