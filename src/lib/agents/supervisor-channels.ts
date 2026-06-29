import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { isClaudeCodeChannelsMcpEnabled } from '../config-yaml.js';
import type { ModelId } from '../settings.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { packageRoot } from '../paths.js';
import { getProviderForModelSync } from '../providers.js';
import { writePtyToken } from '../pty-token.js';
import { capturePane, sendRawKeystroke } from '../tmux.js';
import {
  getAgentDir,
  getAgentState,
  recordAgentFailure,
  saveAgentState,
  saveAgentStateSync,
  type AgentState,
  type Role,
} from './agent-state.js';
import { stopAgent } from './termination.js';

interface SupervisorChannelsSpawnOptions {
  issueId: string;
  workspace: string;
  role?: Role;
  model?: string;
  harness?: RuntimeName;
  allowHost?: boolean;
}

export function buildDefaultResumeContinueMessage(issueId: string): string {
  return `You are resuming work on ${issueId}. Read .pan/continue.json for context and pick up where you left off — do not wait for further instructions.`;
}

export async function buildResumeMessageForAgent(
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

export function markKickoffRedelivered(state: AgentState): void {
  state.kickoffDelivered = true;
  saveAgentStateSync(state);
}

export async function recordKickoffDeliveryFailure(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<void> {
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

// PAN-2179: a work-agent kickoff that fails delivery must NOT be left running
// (the silent-zombie failure mode that produced plan-only "completions"). Stop
// the session so liveness checks see it as not-running, mark it troubled, and
// throw so the spawn fails loudly. The resume path re-delivers the kickoff
// (buildResumeMessageForAgent re-reads initial-prompt.md when kickoffDelivered
// is false) once the operator clears the troubled gate.
export async function recordFatalWorkKickoffDeliveryFailure(
  state: AgentState,
  issueId: string,
  failure: string,
): Promise<never> {
  await Effect.runPromise(recordAgentFailure(state.id, 'kickoff delivery failed'));
  try {
    await Effect.runPromise(stopAgent(state.id));
  } catch (err) {
    console.warn(`[${state.id}] failed to stop after kickoff delivery failure:`, err instanceof Error ? err.message : String(err));
  }
  const now = new Date().toISOString();
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'stopped';
    failedState.stoppedAt = now;
    delete failedState.stoppedByUser;
    failedState.kickoffDelivered = false;
    failedState.troubled = true;
    failedState.troubledAt ??= now;
    failedState.lastFailureReason = 'kickoff delivery failed';
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'stopped';
  state.stoppedAt = now;
  delete state.stoppedByUser;
  state.kickoffDelivered = false;
  state.troubled = true;
  state.troubledAt ??= now;
  state.lastFailureReason = 'kickoff delivery failed';
  emitActivityEntrySync({
    source: 'work-agent',
    level: 'error',
    message: `${state.id}: fatal kickoff delivery failed`,
    issueId,
  });
  throw new Error(`Agent ${state.id} kickoff delivery failed: ${failure}`);
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
  options: SupervisorChannelsSpawnOptions,
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

export async function prepareSupervisorForFreshLaunch(
  agentId: string,
  options: SupervisorChannelsSpawnOptions,
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

export async function prepareSupervisorForRelaunch(
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
  options: SupervisorChannelsSpawnOptions,
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
