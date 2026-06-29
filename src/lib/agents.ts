import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync, rmSync } from 'fs';
import { mkdir, readFile, readdir, rm, stat as statAsync, writeFile, writeFile as writeFileAsync, mkdir as mkdirAsync, rename as renameAsync } from 'fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR, encodeClaudeProjectDir, packageRoot, sessionFilePath } from './paths.js';
import { resolveBareNumericIdSync } from './issue-id.js';
import { getClaudePermissionFlagsStringSync, resolvePermissionModeSync } from './claude-permissions.js';
import { createSessionSync, createSession, killSessionSync, killSession, sendKeys, sendRawKeystroke, sessionExistsSync, sessionExists, listSessions, listSessionsSync, capturePaneSync, capturePane, listPaneValuesSync, listPaneValues, isPaneDead, setOption, exactPaneTarget } from './tmux.js';
import { initHookSync, checkHookSync, generateFixedPointPromptSync } from './hooks.js';
import { findLatestRollout, extractThreadIdFromRollout } from './runtimes/codex.js';
import { getHarnessBehavior } from './runtimes/behavior.js';
import { startWorkSync, completeWorkSync, getAgentCVSync } from './cv.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId, ComplexityLevel } from './settings.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from './providers.js';
import { loadConfigSync as loadYamlConfig, isClaudeCodeChannelsMcpEnabled, isTldrEnabledSync } from './config-yaml.js';
import type { RoleEffort } from './config-yaml.js';
import { loadConfigSync } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { getClaudeAuthStatus } from './claude-auth.js';
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
import { BRIDGE_TOKEN_HEADER, readBridgeTokenSync, writeBridgeTokenSync } from './bridge-token.js';
import { PTY_TOKEN_HEADER, readPtyToken, writePtyToken } from './pty-token.js';
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
  normalizeAgentId,
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
  inferMemoryProjectId,
  roleAgentDefinitionPath,
  roleSystemPromptInjectionSync,
  waitForPromptReady,
  waitForReadySignal,
  writeLauncherScriptAtomic,
  writeOhmypiAgentPrompt,
} from './agents/runtime-command.js';

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
  waitForReadySignal,
} from './agents/runtime-command.js';

const execAsync = promisify(exec);
type FlywheelSpawnEnv = {
  OVERDECK_FLYWHEEL_RUN_ID?: string;
  OVERDECK_FLYWHEEL_AGENT_ROLE?: Role;
};

function normalizeFlywheelRunId(runId: string | null | undefined): string | undefined {
  if (!runId) return undefined;
  const trimmed = runId.trim();
  return /^RUN-\d+$/.test(trimmed) ? trimmed : undefined;
}

function resolveFlywheelSpawnEnv(role: Role, runIdOverride?: string | null): FlywheelSpawnEnv {
  const runId = normalizeFlywheelRunId(runIdOverride ?? getFlywheelActiveRunIdSync());
  return runId
    ? { OVERDECK_FLYWHEEL_RUN_ID: runId, OVERDECK_FLYWHEEL_AGENT_ROLE: role }
    : {};
}

function flywheelEnvExports(env: FlywheelSpawnEnv): string[] {
  return [
    env.OVERDECK_FLYWHEEL_RUN_ID ? `export OVERDECK_FLYWHEEL_RUN_ID=${env.OVERDECK_FLYWHEEL_RUN_ID}` : undefined,
    env.OVERDECK_FLYWHEEL_AGENT_ROLE ? `export OVERDECK_FLYWHEEL_AGENT_ROLE=${env.OVERDECK_FLYWHEEL_AGENT_ROLE}` : undefined,
  ].filter((value): value is string => value !== undefined);
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
// Singleton runners spawn under their own bare ID (spawnRun creates the tmux
// session and agent dir from the raw ID). They MUST be listed here so
// normalizeAgentId is a no-op for them — otherwise message delivery and state
// lookups would target `agent-<id>` and miss the real session (PAN-1866: the
// sequencer spawned but its prompt was delivered to a nonexistent
// `agent-sequencer-runner` pane, leaving the agent idle).
const SINGLETON_AGENT_IDS = new Set(['flywheel-orchestrator', 'sequencer-runner']);

/** True when the input is already a fully-qualified agent ID (known prefix or singleton), not an issue ID. */
export function isQualifiedAgentId(input: string): boolean {
  const lower = input.toLowerCase();
  return SINGLETON_AGENT_IDS.has(lower) || AGENT_PREFIXES.some(p => lower.startsWith(p));
}

/**
 * Resolve a CLI-supplied agent target to an on-disk agent ID (PAN-1760).
 * Accepts bare numerics ("1148"), issue IDs ("PAN-1148"), and fully-qualified
 * agent IDs ("agent-pan-1148-ship", "strike-pan-1723", "inspect-pan-1744-x",
 * "flywheel-orchestrator"). For issue IDs, prefers the canonical work-agent
 * directory when present, then falls back to the single registered agent state
 * for that issue. If no single fallback exists, preserves the historical
 * canonical agent-* target.
 */
export function resolveAgentTargetSync(input: string): string | null {
  if (isQualifiedAgentId(input)) return input.toLowerCase();
  const issueId = resolveBareNumericIdSync(input);
  if (!issueId) return null;

  const canonicalAgentId = normalizeAgentId(issueId);
  if (getAgentStateSync(canonicalAgentId)) return canonicalAgentId;

  try {
    const wantedIssueId = issueId.toUpperCase();
    const matches = listOverdeckAgentStatesSync()
      .filter((agent) => agent.issueId.toUpperCase() === wantedIssueId)
      .map((agent) => agent.id);
    if (matches.length === 1) return matches[0].toLowerCase();
    return canonicalAgentId;
  } catch {
    return canonicalAgentId;
  }
}

// ============================================================================
// Ready Signal Management (PAN-87)
// ============================================================================

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getAgentDir(agentId), 'ready.json');
}

/**
 * Clear ready signal before spawning (clean slate)
 */
export function clearReadySignal(agentId: string): void {
  const readyPath = getReadySignalPath(agentId);
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // Ignore errors - non-critical
    }
  }
}

/**
 * Wait until a hook-instrumented agent reports it is idle at the prompt, via the
 * runtime mirror (Stop / SessionStart hook → activity 'idle'), or the timeout
 * elapses. Returns true if idle was observed.
 *
 * PAN-1594/1596: this is the hook-derived "is the agent idle right now" check.
 * It replaced the tmux pane-scrape `waitForClaudePrompt` (since removed). Works
 * for any hook-instrumented session — agents AND conversations (`conv-*`), which
 * feed the runtime mirror once their heartbeat POSTs authenticate (PAN-1596). No
 * dependency on tmux output or permission mode.
 *
 * Distinct from waitForReadySignal: that answers the one-time "has this
 * (re)launched session reached the prompt" (ready.json gate, used by the
 * conversation reattach/fork paths); this answers "is the running agent idle at
 * the prompt right now".
 */
export async function waitForAgentIdle(agentId: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (getAgentRuntimeStateSync(agentId)?.state === 'idle') return true;
    await new Promise(r => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return getAgentRuntimeStateSync(agentId)?.state === 'idle';
}

export function buildDefaultResumeContinueMessage(issueId: string): string {
  return `You are resuming work on ${issueId}. Read .pan/continue.json for context and pick up where you left off — do not wait for further instructions.`;
}

async function buildResumeMessageForAgent(
  state: AgentState,
  fallbackMessage: string,
  callerMessage?: string,
): Promise<{ message?: string; redeliveringKickoff: boolean; error?: string }> {
  if (state.role !== 'work' || state.kickoffDelivered !== false) {
    return { message: callerMessage ?? fallbackMessage, redeliveringKickoff: false };
  }

  const promptPath = join(getAgentDir(state.id), 'initial-prompt.md');
  try {
    const kickoffPrompt = await readFile(promptPath, 'utf-8');
    const suffix = callerMessage
      ? `\n\n---\n\nAdditional message delivered during resume:\n\n${callerMessage}`
      : '';
    return { message: `${kickoffPrompt}${suffix}`, redeliveringKickoff: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      redeliveringKickoff: true,
      error: `kickoff prompt missing at ${promptPath}: ${reason}`,
    };
  }
}

function markKickoffRedelivered(state: AgentState): void {
  state.kickoffDelivered = true;
  saveAgentStateSync(state);
}

async function recordKickoffDeliveryFailure(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<void> {
  await Effect.runPromise(recordAgentFailure(state.id, 'kickoff delivery failed'));
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'running';
    failedState.kickoffDelivered = false;
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'running';
  state.kickoffDelivered = false;
  emitActivityEntrySync({
    source,
    level: 'error',
    message: `${state.id}: kickoff delivery failed`,
    issueId,
  });
}

interface ChannelsDecision {
  eligible: boolean;
  reason?: string;
}

interface SupervisorDecision {
  eligible: boolean;
  reason?: string;
}

export function decideSupervisorForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): SupervisorDecision {
  void options;
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'supervisor:eligible' : `supervisor:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (process.env.OVERDECK_DOCKER_WORKSPACE === '1' || process.env.PAN_DOCKER === '1') {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  const behavior = state.harness ? getHarnessBehavior(state.harness) : null;
  if (!behavior?.supportsPtySupervisor) {
    const reason = `harness-${state.harness ?? 'unknown'}`;
    log(false, reason);
    return { eligible: false, reason };
  }

  log(true);
  return { eligible: true };
}

async function prepareSupervisorForFreshLaunch(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, options, state);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

async function prepareSupervisorForRelaunch(
  agentId: string,
  state: AgentState,
  model: string,
  harness: RuntimeName,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  if (state.supervisorEnabled !== true) {
    return { useSupervisor: false };
  }

  const relaunchState: AgentState = { ...state, model, harness };
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, {
    issueId: state.issueId || agentId.replace(/^agent-/, '').toUpperCase(),
    workspace: state.workspace,
    role: 'work',
    model,
    harness,
    allowHost: state.hostOverride,
  }, relaunchState);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

function resolvePtySupervisorScriptPath(): string {
  return join(packageRoot, 'dist', 'pty-supervisor.js');
}

/**
 * Decide whether to enable Claude Code Channels for a work-agent launch.
 *
 * Eligibility (all required):
 *   - experimental.claudeCodeChannelsMcp is true in the merged config
 *   - the agent is a work agent (specialists/conversations stay off MCP)
 *   - the harness is Claude Code (not Pi or another runtime harness)
 *   - auth provider is Anthropic-direct (excludes Bedrock/Vertex/Foundry)
 *   - the workspace is not running inside a Docker container
 *
 * Logs the decision exactly once with a category prefix so users can see why
 * the bridge did or did not engage. The function is otherwise side-effect
 * free; the caller is responsible for writing the .mcp.json and mutating
 * state.channelsEnabled when eligible is true. This legacy MCP transport is now
 * opt-in for new spawns; the PTY supervisor is the default delivery transport.
 */
export function decideChannelsForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): ChannelsDecision {
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'channels:eligible' : `channels:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (!isClaudeCodeChannelsMcpEnabled()) {
    return { eligible: false, reason: 'mcp-default-off' };
  }

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (!state.harness || !getHarnessBehavior(state.harness).supportsChannelsBridge) {
    log(false, `harness-${state.harness ?? 'unknown'}`);
    return { eligible: false, reason: `harness-${state.harness ?? 'unknown'}` };
  }

  // Auth gate. The Channels capability is gated by Anthropic auth in the
  // compiled Claude Code binary; we only attempt the bridge when the model
  // routes to the anthropic provider.
  const provider = getProviderForModelSync(state.model as ModelId);
  if (provider.name !== 'anthropic') {
    log(false, `provider-${provider.name}`);
    return { eligible: false, reason: `provider-${provider.name}` };
  }

  if (
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
    process.env.CLAUDE_CODE_USE_FOUNDRY === '1'
  ) {
    log(false, 'auth-bedrock-vertex-foundry');
    return { eligible: false, reason: 'auth-bedrock-vertex-foundry' };
  }

  // Docker workspace gate. We do not yet share a socket dir between host and
  // container; deferred to a follow-up issue (see hazards H10).
  if (
    process.env.OVERDECK_DOCKER_WORKSPACE === '1' ||
    process.env.PAN_DOCKER === '1'
  ) {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  log(true);
  return { eligible: true };
}

/**
 * Write the per-agent MCP config that points claude at the overdeck-bridge
 * stdio server. The path is the workspace-local <workspace>/.pan/agent-mcp.json
 * — one config per agent, never shared, never reused.
 */
export async function writeChannelsBridgeMcpConfig(
  configPath: string,
  agentId: string,
): Promise<void> {
  const fsp = await import('fs/promises');
  await fsp.mkdir(dirname(configPath), { recursive: true });
  // Resolve the bridge entrypoint from the project root. The source file
  // lives in src/lib/channels/ and is executed directly via `bun run`
  // (Bun runs TypeScript without pre-compilation). We must point at the
  // source, not a dist copy, because the build does not copy the bridge
  // script into the bundle output.
  const here = dirname(import.meta.url.replace('file://', ''));
  const projectRoot = join(here, '..', '..');
  const repoBridgePath = join(projectRoot, 'src', 'lib', 'channels', 'overdeck-bridge.ts');
  const mcpConfig = {
    mcpServers: {
      'overdeck-bridge': {
        command: 'bun',
        args: ['run', repoBridgePath],
        env: {
          OVERDECK_AGENT_ID: agentId,
          OVERDECK_HOME: process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck'),
        },
      },
    },
  };
  await fsp.writeFile(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
}

/**
 * Dismiss the dev-channels confirmation TUI dialog rendered by
 * `claude --dangerously-load-development-channels`. The dialog text
 * 'WARNING: Loading development channels' must be on screen before any prompt
 * is delivered, otherwise the channel listener never registers and every
 * early channel push silently falls back to tmux.
 *
 * Polling budget is 20s because cold-start claude with TLDR + Playwright MCP
 * servers attached commonly takes 8–15s to render the first frame; a tighter
 * budget false-negatives. If the dialog is not detected within the timeout,
 * we proceed — the dialog is suppressed in some auth states (e.g. when the
 * binary takes a non-interactive code path), and the launch must not block
 * forever.
 *
 * Uses sendRawKeystrokeAsync intentionally: sendKeysAsync's load-buffer +
 * paste-buffer machinery is for typing message bodies, not for a single
 * Enter on a TUI prompt where mistimed paste can fire before the dialog
 * accepts input.
 *
 * Once the dialog is detected we send Enter and KEEP checking — a single
 * keystroke can be dropped if the TUI is still mid-render, which left the
 * dialog on screen with the helper already returned. We re-send Enter every
 * RESEND_INTERVAL_MS until the needle is gone (bounded by DISMISS_BUDGET_MS).
 */
export async function dismissDevChannelsDialog(agentId: string): Promise<void> {
  const TIMEOUT_MS = 20_000;
  const POLL_INTERVAL_MS = 200;
  const RESEND_INTERVAL_MS = 150;
  const DISMISS_BUDGET_MS = 5_000;
  const NEEDLE = 'WARNING: Loading development channels';
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const pane = await Effect.runPromise(capturePane(agentId, 50));
      if (pane.includes(NEEDLE)) {
        // Dialog is up. Send Enter, then keep re-sending until the needle
        // clears — the first keystroke can land before the TUI is ready to
        // accept it, leaving the dialog stuck on screen.
        const dismissStart = Date.now();
        while (Date.now() - dismissStart < DISMISS_BUDGET_MS) {
          await Effect.runPromise(sendRawKeystroke(agentId, 'C-m', 'channels:dismiss-dev-dialog'));
          await new Promise((r) => setTimeout(r, RESEND_INTERVAL_MS));
          const after = await Effect.runPromise(
            capturePane(agentId, 50).pipe(Effect.catch(() => Effect.succeed(''))),
          );
          if (!after.includes(NEEDLE)) return;
        }
        console.log(`[${agentId}] channels:dismiss:dialog-still-present-after-budget`);
        return;
      }
    } catch {
      // Capture failures are transient (tmux session not yet visible to
      // the new pane); keep polling within the budget.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`[${agentId}] channels:dismiss:dialog-not-detected`);
}

// ============================================================================
// Agent Runtime State (PAN-800: event-sourced, no more runtime.json)
export interface SpawnOptions {
  issueId: string;
  workspace: string;
  /** Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted. */
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  /**
   * Spawn role. Defaults to 'work'. The 'strike' role is the bypass path that
   * skips plan/review/test/ship and lands directly on main — see roles/strike.md.
   * Strike sessions are named `strike-<issue-id>` instead of `agent-<issue-id>`.
   */
  role?: 'work' | 'strike';
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Explicit work type ID (overrides phase-based detection)

  // PAN-1517: swarm slot fields removed (slotId, swarmItemId). Parallelism
  // is now in-context via subagents (see roles/work.md), not via slot agents.
  // `allowHost` (workspace-isolation override) stays — it predates the swarm
  // runtime and is used by review/test/ship agents independently.
  allowHost?: boolean;
  flywheelRunId?: string;
  /** Claude Code `--effort` level for the spawned session (work/strike). */
  effort?: RoleEffort;
}

export interface SpawnRunOptions {
  workspace?: string;
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  agentId?: string;
  /**
   * Sub-role within the review convoy (PAN-1059).
   * When set alongside role='review', each convoy reviewer gets its own
   * isolated tmux session using the code-review-<subRole> agent definition.
   * Values: 'security' | 'correctness' | 'performance' | 'requirements'
   */
  subRole?: string;
  /**
   * Review convoy wiring (PAN-977). When spawning a review sub-role, the
   * synthesis agent id and the reviewer's output path are passed in up front
   * so the generated launcher can own the REVIEWER_READY/FAILED/TIMEOUT signal
   * deterministically on process exit. Persisted onto AgentState too.
   */
  reviewSynthesisAgentId?: string;
  reviewOutputPath?: string;
  allowHost?: boolean;
  registerConversation?: boolean;
  effort?: RoleEffort;
  resumeSessionId?: string;
  flywheelRunId?: string;
}

/**
 * Shared tracker resolution logic for issue state transitions.
 *
 * Resolution order (by project tracker type):
 * 1. github_repo → GitHub Issues (takes priority over issue_prefix, since projects
 *    like overdeck use GitHub Issues with a prefix, not Linear)
 * 2. rally_project → Rally
 * 3. issue_prefix (no github_repo) → Linear (covers gitlab+linear and pure-linear projects)
 * 4. gitlab_repo only → warn and skip (GitLab doesn't support label-based state transitions)
 *
 * Precedence rationale: issue_prefix was renamed from linear_team but is now also set on
 * GitHub-hosted projects (e.g. issue_prefix: PAN for overdeck GitHub Issues).
 * github_repo must be checked first so GitHub projects don't misroute to Linear.
 */
async function transitionIssueState(issueId: string, state: IssueState, workspacePath?: string): Promise<void> {
  // Guard: bare numeric IDs (no alphabetic prefix, e.g. "484") must never reach
  // any tracker API. Linear's searchIssues("484") would match MIN-484 in the wrong
  // team. Log a warning and skip — the workspace's project must use prefixed IDs.
  if (/^\d+$/.test(issueId)) {
    console.warn(
      `[agents] Skipping ${state} transition for bare numeric ID "${issueId}" — ` +
      `issue IDs must include a project prefix (e.g. PAN-${issueId}). ` +
      `This workspace was likely created before the pan- prefix convention.`
    );
    return;
  }

  // Resolve the project from workspacePath — its configured tracker is authoritative.
  // Every issue MUST belong to a registered project with a tracker configured.
  const projectConfig = workspacePath ? findProjectByPathSync(workspacePath) : null;
  if (!projectConfig) {
    throw new Error(`Cannot transition ${issueId}: no project config found for workspace ${workspacePath || '(none)'}. Register the project in projects.yaml.`);
  }

  // Project has a GitHub repo — use GitHub Issues tracker.
  // Checked BEFORE issue_prefix because github_repo projects (e.g. overdeck)
  // set issue_prefix for their GitHub Issue prefix (PAN-), not for Linear.
  if (projectConfig.github_repo) {
    const [owner, repo] = projectConfig.github_repo.split('/');
    const tracker = createTracker({ type: 'github', owner, repo });
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via GitHub (${projectConfig.github_repo})`);
    return;
  }

  // Project has a Rally project — use Rally tracker
  if (projectConfig.rally_project) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.rally) {
      throw new Error(`Project ${projectConfig.name} uses Rally (project: ${projectConfig.rally_project}) but no Rally tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'rally');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Rally (project: ${projectConfig.rally_project})`);
    return;
  }

  // Project has a Linear team prefix (and no github_repo) — use Linear tracker.
  // This covers: pure-Linear projects and gitlab+Linear projects (e.g. mind-your-now).
  if (getIssuePrefix(projectConfig)) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.linear) {
      throw new Error(`Project ${projectConfig.name} uses Linear (team: ${getIssuePrefix(projectConfig)}) but no Linear tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'linear');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Linear (team: ${getIssuePrefix(projectConfig)})`);
    return;
  }

  if (projectConfig.gitlab_repo) {
    console.warn(`[agents] GitLab project detected (${projectConfig.gitlab_repo}) but GitLab does not support ${state} label transitions`);
    return;
  }

  throw new Error(`Project ${projectConfig.name} has no tracker configured (need issue_prefix, github_repo, or rally_project in projects.yaml)`);
}

export async function transitionIssueToInProgress(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_progress', workspacePath);
}

/**
 * Transitions an issue to "in_review" state in the configured issue tracker.
 * Fire-and-forget — logs warnings on failure but never blocks the pipeline.
 */
export async function transitionIssueToInReview(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_review', workspacePath);
}

export interface AgentLaunchConfig {
  launcherContent: string;
  providerEnv: Record<string, string>;
}

export async function buildAgentLaunchConfig(opts: {
  agentId: string;
  model: string;
  workspace: string;
  role: Role;
  spawnMode?: 'resume';
  resumeSessionId?: string;
  isPlanning?: boolean;
  /** Per-agent .mcp.json path for the experimental Channels bridge. */
  channelsBridgeMcpConfig?: string;
  /** MCP server name to load as a Channel; defaults to 'overdeck-bridge'. */
  channelsBridgeServerName?: string;
  useSupervisor?: boolean;
  supervisorScriptPath?: string;
  /** Claude Code session id for fresh launches that need a known id before boot. */
  sessionId?: string;
  /**
   * Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted —
   * preserves bit-for-bit pre-PAN-636 behavior. When 'pi', the launcher is
   * built via the Pi command-line generator instead of the claude path; opts
   * like agentId-as-name and agent-frontmatter are ignored because Pi has
   * no agent-definition system.
   */
  harness?: RuntimeName;
  extraEnvExports?: string[];
  /** Claude Code `--effort` level threaded into the launcher command. */
  effort?: RoleEffort;
  /** Inline prompt to embed in launch commands that still support prompt arguments. */
  promptInline?: string;
}): Promise<AgentLaunchConfig> {
  const model = requireModelOverrideSync(opts.model);

  // Substrate guard: inject permission deny rules for Overdeck infrastructure
  // paths (.claude/agents/, .claude/hooks/, ~/.overdeck/, JSONL session dirs)
  // into the workspace's .claude/settings.local.json. Idempotent. Without this
  // a vBRIEF action like "delete the legacy pan-*-agent.md files" can convince
  // an agent to brick its own runtime. PAN-1048 X1 incident, 2026-05-09.
  try {
    const { injectOverdeckInfraDeny } = await import('./claude-settings-overlay.js');
    await Effect.runPromise(injectOverdeckInfraDeny(opts.workspace));
  } catch (err) {
    console.warn(`[agents] injectOverdeckInfraDeny failed for ${opts.agentId} (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModelSync(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, opts.workspace);
  } else {
    clearCredentialFileAuthSync(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  // PAN-1048: resume/restart launchers must respect the agent's role.
  // A resumed review/test/ship run loads the wrong frontmatter (and wrong
  // tool permissions) if it always points at roles/work.md.
  const launchRole: Role = opts.isPlanning ? 'plan' : opts.role;

  // PAN-1055: ohmypi harness needs --session-dir + fifo redirect threaded into
  // the launcher; getOhmypiLauncherFields() resolves them from the agent state
  // and they're spread into generateLauncherScript() below.
  // PAN-1574: codex harness needs its per-agent CODEX_HOME path.
  const behavior = getHarnessBehavior(opts.harness);
  const piLauncherFields = behavior.usesRpcFifo
    ? await getOhmypiLauncherFields(opts.agentId, model)
    : {};
  const codexLauncherFields = behavior.usesCodexHome
    ? getCodexLauncherFields(opts.agentId, model, opts.workspace)
    : {};

  if (opts.spawnMode === 'resume' && opts.resumeSessionId) {
    // Resume sessions adopt the role definition via --agent.
    // Permissions/model/tools/hooks come from roles/<role>.md frontmatter.
    // --name <agentId> gives the resumed Claude session a human-readable handle.
    //
    // The frontmatter's permissionMode: bypassPermissions only bypasses prompts
    // INSIDE cwd. Tools that touch siblings of cwd (e.g. bd reading
    // .beads/issues.jsonl through git subprocesses, pan reading
    // ~/.overdeck/...) still hit "Do you want to proceed?" without DSP.
    // Mid-Bash dialog dismissals (deacon nudge, paste-buffer write, sibling
    // hook output) cancel the in-flight tool call and surface as
    // `Interrupted · What should Claude do instead?` (PAN-1024 reproduced
    // this loop on every fresh resume of PAN-1044/PAN-934).
    //
    // Match the fresh-spawn path: when permissionMode resolves to 'bypass'
    // (PAN_YOLO=true OR claude.permissionMode=bypass in config), prepend
    // --dangerously-skip-permissions on resume too.
    // Use the shared helper so the only string literal for DSP lives in
    // claude-permissions.ts (see scripts/lint-permissions.sh allowlist).
    const launcherContent = generateLauncherScriptSync({
      role: launchRole,
      spawnMode: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      // PAN-2087: claude-code resumes inject the role body (+ effort) as an
      // appended system prompt instead of `--agent <file>` (Claude Code 2.1.195
      // dropped --agent file support); permission flags come from the global
      // resolver. ohmypi/codex resumes route through getAgentRuntimeBaseCommand
      // which short-circuits to the omp/codex form.
      baseCommand: behavior.launchCommandKind !== 'claude-code'
        ? await getAgentRuntimeBaseCommand(model, opts.agentId, launchRole, opts.harness)
        : `claude ${getClaudePermissionFlagsStringSync()}${roleSystemPromptInjectionSync(roleAgentDefinitionPath(launchRole))}`,
      resumeSessionId: opts.resumeSessionId,
      model: behavior.launchCommandKind !== 'claude-code' || providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
      extraArgs: behavior.launchCommandKind !== 'claude-code' ? undefined : `--name ${opts.agentId}`,
      appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
      extraEnvExports: opts.extraEnvExports,
      useSupervisor: opts.useSupervisor,
      supervisorScriptPath: opts.supervisorScriptPath,
      promptInline: opts.promptInline,
      ...piLauncherFields,
      ...codexLauncherFields,
    });
    return { launcherContent, providerEnv };
  }

  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    opts.workspace,
    yamlConfig.config.caveman,
    opts.isPlanning ?? false,
  );

  // PAN-982: pass the role definition path + agentId through getAgentRuntimeBaseCommand so it
  // emits 'claude --agent roles/<role>.md --name <agentId>'.
  // PAN-636: when the harness uses the ohmypi RPC command, the helper
  // short-circuits to an omp --mode rpc line and the
  // agentName/agentDefinition arguments are ignored (Pi has no agent
  // definitions). The launcher generator's Pi branch then layers --session-dir
  // and the fifo redirect on top.
  const agentDefinition = roleAgentDefinitionPath(launchRole);
  const launcherContent = generateLauncherScriptSync({
    role: launchRole,
    workingDir: opts.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model, opts.agentId, agentDefinition, opts.harness ?? 'claude-code', opts.effort),
    sessionId: behavior.sessionIdSource === 'launcher-session-id' ? opts.sessionId : undefined,
    appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
    extraEnvExports: opts.extraEnvExports,
    useSupervisor: opts.useSupervisor,
    supervisorScriptPath: opts.supervisorScriptPath,
    promptInline: opts.promptInline,
    ...piLauncherFields,
    ...codexLauncherFields,
    ...(opts.channelsBridgeMcpConfig
      ? {
          channelsBridgeMcpConfig: opts.channelsBridgeMcpConfig,
          channelsBridgeServerName: opts.channelsBridgeServerName ?? 'overdeck-bridge',
        }
      : {}),
  });

  return { launcherContent, providerEnv };
}

function defaultRunWorkspace(issueId: string): string {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) {
    throw new Error(`Cannot spawn role run for ${issueId}: no project is configured for this issue prefix`);
  }
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

export async function retrieveSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  if (!input.prompt.trim()) return '';

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(input.workspace),
      workspaceId: basename(input.workspace),
      issueId: input.issueId,
      runId: input.agentId,
      sessionId: input.agentId,
      agentRole: input.role,
      agentHarness: input.harness,
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    return (await injectPromptTimeMemory({ prompt: input.prompt, identity, surface: 'spawn' })).context;
  } catch (error) {
    console.warn(`[agents] Spawn-time memory context unavailable for ${input.agentId}:`, error instanceof Error ? error.message : String(error));
    return '';
  }
}

async function withSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  const context = await retrieveSpawnTimeMemoryContext(input);
  return context ? `${context}\n\n---\n\n${input.prompt}` : input.prompt;
}

function runAgentId(issueId: string, role: Role, subRole?: string): string {
  const base = role === 'work'
    ? `agent-${issueId.toLowerCase()}`
    : `agent-${issueId.toLowerCase()}-${role}`;
  return subRole ? `${base}-${subRole}` : base;
}

/**
 * Spawn-time stack-rebuild self-heal state. PAN-1618: the work-spawn gate
 * (`assertWorkspaceStackHealthyForSpawn`) used to fail hard when the workspace
 * docker stack was down, with only manual recoveries (`pan workspace rebuild`
 * or interactive `--host`). Under autonomous operation a fully-planned
 * `proposed` item whose stack happened to be down could never auto-start its
 * work agent — it sat at the gate forever. This mirrors the PAN-1247
 * orphan-test self-heal one role earlier: rebuild the stack before failing,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const spawnStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean; hostFallbackNoticed?: boolean }> =
  new Map();
const SPAWN_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const SPAWN_STACK_REBUILD_MAX_ATTEMPTS = 3;

/**
 * Spawn a role-based Overdeck run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan') return;

  // PAN-1872: guard against an undefined issueId so workspace health checks do
  // not crash with `Cannot read properties of undefined (reading 'toUpperCase')`
  // while pan start is recovering from a sync-main conflict.
  const normalizedIssue = (issueId ?? '').toUpperCase();

  // PAN-1746: absence of a workspace must be a HARDER failure than an unhealthy
  // one. The host-fallback path below lets advancing roles (review/test/ship)
  // proceed when the docker stack is merely unhealthy — but a workspace
  // directory that does not exist at all means the launcher would fall back to
  // its cwd ($HOME) and wedge Claude at the folder-trust prompt while it holds
  // an advancing slot against the PAN-1665 governor. Refuse the spawn outright
  // instead of degrading to host. (`work`'s resume path already guards this in
  // restartAgent; this closes the same gap on the role-run spawn path.)
  if (workspacePath && !existsSync(workspacePath)) {
    throw new Error(
      `Workspace for ${normalizedIssue} does not exist at ${workspacePath} — refusing to spawn ${role}. `
      + `A missing workspace would land the agent in $HOME at the folder-trust prompt. `
      + `Recreate the workspace ('pan workspace rebuild ${normalizedIssue}') before retrying.`,
    );
  }

  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    spawnStackRebuildState.delete(normalizedIssue);
    return;
  }

  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host to override.`;

  if (allowHost) {
    // PAN-1556: host-override is a per-spawn detail, not user-facing activity —
    // it fired once per convoy member and buried real feed items (conversations).
    // Keep the console.warn for debugging; do not emit to the session feed.
    console.warn(`[agents] ${message}`);
    return;
  }

  // PAN-1645 + PAN-1618: an unhealthy stack must NEVER *block* the advancing
  // roles. review/test/ship all operate on the HOST workspace — ship
  // rebases/pushes against the host .git, review reads the committed diff, and
  // test runs the project's quality gates (host-run unless a gate explicitly
  // opts into a container) — so they do not need the workspace's docker
  // containers at all. The long-standing manual `--host` workaround (PAN-1645)
  // burned enormous effort just rediscovering that ship-on-broken-docker is a
  // false gate. For these roles we still attempt one bounded autonomous rebuild
  // (so a project whose test gates DO run in containers gets a healthy stack
  // when recoverable), but if it can't be made healthy we AUTO-FALL-BACK TO
  // HOST and proceed instead of throwing.
  //
  // `work` is different: a work agent may rely on the dev container's services,
  // so silently running it on the host could build/test against a missing
  // environment. work keeps the hard gate (rebuild → escalate to a human).
  const hostFallbackEligible = role !== 'work';

  const record = spawnStackRebuildState.get(normalizedIssue)
    ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  const fallbackToHost = (reason: string): void => {
    console.warn(`[agents] ${message} — auto-falling back to host for ${role} (${reason})`);
    // Emit the host-fallback notice once per issue. Use a SEPARATE latch from
    // the work-escalation latch (`escalated`): if review/test/ship trip the
    // host fallback first, a later `work` spawn for the same broken-stack issue
    // must still be able to emit its own (error-level) dead-end marker — the
    // operator's only signal that a work agent is blocked on docker.
    if (!record.hostFallbackNoticed) {
      record.hostFallbackNoticed = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'warn',
        issueId: normalizedIssue,
        message: `agent-spawn-host-fallback: ${normalizedIssue}`,
        details: `Workspace docker stack unhealthy (${details}); ${role} runs on the host (rebase/verify use host .git + host gates), so proceeding without containers. ${reason}`,
      });
    }
  };

  const blockWork = (markerMessage: string, errDetails: string): never => {
    if (!record.escalated) {
      record.escalated = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'error',
        issueId: normalizedIssue,
        message: markerMessage,
        details: errDetails,
      });
    }
    throw new Error(message);
  };

  if (record.attempts >= SPAWN_STACK_REBUILD_MAX_ATTEMPTS) {
    if (hostFallbackEligible) {
      fallbackToHost(`rebuild exhausted after ${record.attempts} attempts`);
      return;
    }
    blockWork(
      `agent-spawn-stack-rebuild-exhausted: ${normalizedIssue}`,
      `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${details}. Manual 'pan workspace rebuild ${normalizedIssue}' or retry with --host needed.`,
    );
  }

  if (now - record.lastAttempt < SPAWN_STACK_REBUILD_COOLDOWN_MS) {
    // A rebuild was attempted recently and the stack is still unhealthy —
    // don't hammer `docker compose` every spawn.
    if (hostFallbackEligible) {
      fallbackToHost('rebuild on cooldown');
      return;
    }
    blockWork(`agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`, details);
  }

  record.lastAttempt = now;
  record.attempts += 1;
  spawnStackRebuildState.set(normalizedIssue, record);
  console.log(
    `[agents] Workspace stack for ${normalizedIssue} unhealthy (${details}) — rebuilding ` +
      `before spawn (attempt ${record.attempts}/${SPAWN_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('./workspace/rebuild-stack.js');
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[agents]   ${normalizedIssue} stack rebuild: ${m}`),
    }),
  ).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err) }));

  if (result.success) {
    spawnStackRebuildState.delete(normalizedIssue);
    console.log(`[agents] Workspace stack for ${normalizedIssue} rebuilt — proceeding with spawn`);
    return;
  }

  console.warn(`[agents] Workspace stack rebuild failed for ${normalizedIssue}: ${result.error}`);
  if (hostFallbackEligible) {
    fallbackToHost(`rebuild failed: ${result.error ?? 'unknown'}`);
    return;
  }
  blockWork(`agent-spawn-stack-rebuild-failed: ${normalizedIssue}`, result.error ?? details);
}

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
  normalizeAgentId,
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


function queueAgentMail(agentId: string, message: string): void {
  const mailDir = join(getAgentDir(agentId), 'mail');
  mkdirSync(mailDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

const USER_MESSAGE_INTERVENTION_SOURCES = new Set(['pan-tell', 'dashboard:user-message']);

async function appendTellInterventionForUserSource(normalizedId: string, caller: string): Promise<void> {
  if (!USER_MESSAGE_INTERVENTION_SOURCES.has(caller)) return;

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState?.issueId) {
    console.debug(`[agents] Skipping tell intervention for ${normalizedId}; state.json has no issueId`);
    return;
  }

  await appendOperatorInterventionEvent({
    issueId: agentState.issueId,
    kind: 'tell',
    source: caller,
  });
}

export async function messageAgent(agentId: string, message: string, caller = 'internal'): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    queueAgentMail(normalizedId, message);
    logAgentLifecycleSync(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
    console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
    return;
  }

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  if (runtimeState?.state === 'suspended') {
    console.log(`[agents] Auto-resuming suspended agent ${normalizedId} to deliver message`);
    const result = await resumeAgent(normalizedId, message);
    if (!result.success) {
      throw new Error(`Failed to auto-resume agent: ${result.error}`);
    }
    if (result.messageDelivered === false) {
      throw new Error(`Agent resumed but ready signal did not fire — message not delivered. Feedback is in the mail queue.`);
    }
    // Message already sent during resume
    await appendTellInterventionForUserSource(normalizedId, caller);
    return;
  }

  // Check if agent is stopped — auto-resume to deliver feedback (PAN-367 / PAN-705)
  //
  // IMPORTANT: We delegate to resumeAgent() so we pick up the saved Claude session id
  // (`claude --resume <id>`) instead of fresh-launching with a new, empty session.
  // The previous implementation of this branch called `getAgentRuntimeBaseCommand(model)`
  // and passed an inline "You are resuming work" prompt as a positional argument,
  // which booted Claude Code in a fresh session (ctx 0%) with no memory of the
  // prior conversation, destroying agent continuity every time feedback arrived.
  //
  // We also restart when the tmux session still exists. Planning/work sessions use
  // `remain-on-exit on` so the shell persists after the agent process exits, and
  // sessionExists() returns true for that dead shell. resumeAgent() kills the zombie
  // session before re-creating it.
  if (agentState && agentState.status === 'stopped') {
    console.log(`[agents] Auto-resuming stopped agent ${normalizedId} to deliver feedback (session exists: ${await Effect.runPromise(sessionExists(normalizedId))})`);

    const resumeResult = await resumeAgent(normalizedId, message);

    // Save to mail queue regardless so the agent can re-read feedback if needed
    queueAgentMail(normalizedId, message);

    if (resumeResult.success && resumeResult.messageDelivered !== false) {
      await appendTellInterventionForUserSource(normalizedId, caller);
      console.log(`[agents] Resumed ${normalizedId} and delivered feedback`);
      return;
    }

    // Resume failed OR message was not delivered (ready signal timed out). Fall back to
    // a fresh launch so feedback is not silently dropped. This path intentionally mirrors
    // spawnAgent's launcher (provider exports + unset of leaked env vars) so the fallback
    // doesn't inherit stale ANTHROPIC_BASE_URL / OPENAI_API_KEY from the parent process.
    if (!resumeResult.success) {
      console.warn(`[agents] Resume failed for ${normalizedId}: ${resumeResult.error} — falling back to fresh launch`);
    } else {
      console.warn(`[agents] Resume succeeded for ${normalizedId} but message not delivered (ready signal timed out) — falling back to fresh launch`);
    }

    // PAN-1980: session rotation is disabled — do NOT fresh-launch a new session
    // as a fallback (that rotates the transcript and hides the resume failure).
    // Leave the agent stopped and surface it; the feedback was already queued in
    // the mail queue above, so it is not dropped.
    if (!ALLOW_SESSION_ROTATION_ON_RESUME) {
      const why = !resumeResult.success
        ? `resume failed (${resumeResult.error})`
        : 'resume succeeded but message delivery timed out';
      const stopMsg = `Not restarting ${normalizedId} with a fresh session — ${why}; session rotation is disabled (PAN-1980). Agent left stopped; feedback queued in mail.`;
      console.warn(`[agents] ${stopMsg}`);
      emitActivityEntrySync({ source: 'work-agent', level: 'error', message: `${normalizedId}: ${stopMsg}`, issueId: agentState.issueId });
      return;
    }

    const providerEnv = agentState.model ? await getProviderEnvForModel(agentState.model) : {};
    if (agentState.model) {
      const provider = getProviderForModelSync(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuthSync(provider, agentState.workspace);
      } else {
        clearCredentialFileAuthSync(agentState.workspace);
      }
    }

    clearReadySignal(normalizedId);
    if (await Effect.runPromise(sessionExists(normalizedId))) {
      try { await Effect.runPromise(killSession(normalizedId)); } catch { /* ignore */ }
    }

    const providerExports = await getProviderExportsForModel(agentState.model || 'claude-sonnet-4-6');
    const fallbackLauncher = join(getAgentDir(normalizedId), 'launcher.sh');
    // PAN-1048 C4: resume must relaunch with the agent's actual role, not
    // hardcoded 'work'. A stopped review/test/ship run was previously
    // resurrected as a work agent because launcher generation ignored the
    // saved role. Use agentState.role and route through getRoleRuntimeBaseCommand
    // so the role-specific .claude/agents/* definition file is loaded.
    const resumeRole: Role = agentState.role ?? 'work';
    // PAN-1048 review feedback 006 (S1): Pi-backed resumes need the same
    // launcher fields the fresh-spawn path threads through generateLauncherScript.
    // buildPiCommand throws on missing piSessionDir, so the previous fallback
    // emitted a launcher that would crash on resume for any Pi role agent.
    const resumeModel = agentState.model || 'claude-sonnet-4-6';
    const fallbackHarness = agentState.harness ?? 'claude-code';
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      resumeRole,
      agentState.hostOverride === true,
      agentState.workspace,
    );
    const fallbackPiFields = fallbackHarness === 'ohmypi'
      ? await getOhmypiLauncherFields(normalizedId, resumeModel)
      : {};
    const fallbackCodexFields = fallbackHarness === 'codex'
      ? getCodexLauncherFields(normalizedId, resumeModel, agentState.workspace)
      : {};
    const fallbackSupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, resumeModel, fallbackHarness);
    const fallbackContent = generateLauncherScriptSync({
      role: resumeRole,
      workingDir: agentState.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      baseCommand: await getRoleRuntimeBaseCommand(
        resumeModel,
        normalizedId,
        resumeRole,
        fallbackHarness,
      ),
      appendSystemPromptFiles: await claudeSystemPromptFiles(agentState.workspace, fallbackHarness),
      useSupervisor: fallbackSupervisorLaunch.useSupervisor,
      supervisorScriptPath: fallbackSupervisorLaunch.supervisorScriptPath,
      ...fallbackPiFields,
      ...fallbackCodexFields,
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await Effect.runPromise(createSession(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        OVERDECK_AGENT_ID: normalizedId,
        OVERDECK_ISSUE_ID: agentState.issueId || '',
        OVERDECK_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    const ready = await waitForPromptReady(normalizedId, fallbackHarness, 30);
    const fallbackResumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    const resumeMessage = await buildResumeMessageForAgent(agentState, fallbackResumePrompt, message);
    if (resumeMessage.error) {
      console.error(`[agents] Fallback-restarted ${normalizedId} but ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId: agentState.issueId,
      });
    } else if (ready && resumeMessage.message) {
      let delivered = false;
      if (fallbackHarness === 'claude-code') {
        const fallbackSessionId = getLatestSessionIdSync(normalizedId);
        if (fallbackSessionId) {
          const delivery = await deliverResumeMessageWithTranscriptConfirmation({
            agentId: normalizedId,
            workspace: agentState.workspace,
            sessionId: fallbackSessionId,
            message: resumeMessage.message,
            caller: 'resumeAgent:resume-prompt',
            deliveryMethod: resilientDeliveryMethod(agentState.deliveryMethod),
          });
          delivered = delivery.delivered;
          if (!delivery.delivered) {
            console.error(`[agents] Fallback resume prompt did not land after ${delivery.attempts} delivery attempts`);
          }
        } else {
          console.error(`[agents] Fallback-restarted ${normalizedId} but no session id was recorded — feedback in mail queue`);
        }
      } else {
        const delivery = await deliverAgentMessage(normalizedId, resumeMessage.message, 'resumeAgent:resume-prompt', resilientDeliveryMethod(agentState.deliveryMethod));
        delivered = delivery.ok;
      }
      if (delivered) {
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
        await appendTellInterventionForUserSource(normalizedId, caller);
        console.log(`[agents] Fallback-restarted ${normalizedId} and delivered feedback`);
      }
    } else {
      console.warn(`[agents] Fallback-restarted ${normalizedId} but ready signal not detected — feedback in mail queue`);
    }

    return;
  }

  // Check if this is a remote agent
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('./remote/remote-agents.js');
  const remoteState = loadRemoteAgentState(normalizedId);
  if (remoteState && remoteState.vmName) {
    console.log(`[agents] Sending message to remote agent ${normalizedId} on ${remoteState.vmName}`);
    await sendToRemoteAgent(normalizedId, remoteState.vmName, message);

    // Also save to mail queue for persistence
    queueAgentMail(normalizedId, message);
    await appendTellInterventionForUserSource(normalizedId, caller);
    return;
  }

  if (!(await Effect.runPromise(sessionExists(normalizedId)))) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  // Guard: if tmux session exists but Claude Code has exited, resume instead
  // of typing the message into a bare bash shell.
  //
  // Launchers differ: specialists `exec claude` so pane_pid IS claude, but
  // work-agent launchers run `bash launcher.sh` so pane_pid is bash and claude
  // runs as a descendant. Walk the pane's process subtree and treat the pane
  // as live if any descendant is the expected runtime for the saved harness.
  const panePids = await Effect.runPromise(listPaneValues(normalizedId, '#{pane_pid}'));
  const expectedHarness = agentState?.harness ?? 'claude-code';
  if (panePids.length > 0 && !(await hasAgentRuntimeInSubtree(panePids[0], expectedHarness))) {
    console.warn(`[agents] ${normalizedId} tmux session is a zombie (no ${expectedHarness} runtime) — attempting resume`);
    const resumeResult = await resumeAgent(normalizedId, message);
    if (resumeResult.success) {
      if (resumeResult.messageDelivered !== false) {
        await appendTellInterventionForUserSource(normalizedId, caller);
      }
      return;
    }
    throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
  }

  // Wait for the agent to be idle at the prompt before sending — reduces dropped
  // Enter when Claude Code is still rendering. PAN-1594: hook-driven (runtime
  // mirror 'idle' via Stop/SessionStart hook), not a tmux pane-scrape.
  const promptReady = await waitForAgentIdle(normalizedId, 5000);
  if (!promptReady) {
    console.warn(`[agents] ${normalizedId} not at idle prompt after 5s — sending message anyway`);
  }

  const deliveryMethod = resilientDeliveryMethod(agentState?.deliveryMethod);
  await deliverAgentMessage(normalizedId, message, `messageAgent:${caller}`, deliveryMethod);

  // Also save to mail queue
  queueAgentMail(normalizedId, message);
  await appendTellInterventionForUserSource(normalizedId, caller);
}

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
