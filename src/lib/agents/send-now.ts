/**
 * PAN-5353: the agent-facing `sendNowToAgent` door for Claude Code's send-now
 * chord. Mirrors the refusal shape of `ClaudeLiveEffortResult`
 * (`effort-live.ts`): every refusal returns before `press` is ever called.
 */
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { PANE_CAPTURE_LINES } from '../session-pane-choice.js';
import { pressSendNowChord, resolveAgentPaneIo } from '../terminal-backends/agent-pane-io.js';
import { getAgentState, type AgentState } from './agent-state-read.js';
import { normalizeAgentId } from './identity.js';
import { ensureMainInputTarget, type EnsureMainResult } from './input-target.js';
import { parsePermissionPrompt } from './permission-prompt.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';

export type SendNowCode =
  | 'not-found'
  | 'not-running'
  | 'steer-unsupported'
  | 'permission-pending'
  | 'input-target-not-main'
  | 'press-failed'
  | 'vault-browse-copy'
  | 'conversation-released';

export type SendNowResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 422 | 502; code: SendNowCode; error: string };

export interface AgentSendNowDeps {
  getAgentState: (id: string) => AgentState | null;
  getRuntimeState: (id: string) => { state?: string } | null;
  isRemote: (id: string) => Promise<boolean>;
  readPane: (id: string) => Promise<string>;
  ensureMain: (id: string) => Promise<EnsureMainResult>;
  press: (id: string) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultIsRemote(id: string): Promise<boolean> {
  const { loadRemoteAgentState } = await import('../remote/remote-agents.js');
  return Boolean(loadRemoteAgentState(id)?.vmName);
}

/**
 * Press Claude Code's send-now chord in the agent's own pane. Each refusal
 * step returns before any later step runs, and `press` is only ever called
 * once all of them pass.
 */
export async function sendNowToAgent(rawId: string, deps: Partial<AgentSendNowDeps> = {}): Promise<SendNowResult> {
  const getState = deps.getAgentState ?? getAgentState;
  const getRuntimeState = deps.getRuntimeState ?? getAgentRuntimeStateSync;
  const isRemote = deps.isRemote ?? defaultIsRemote;
  const readPane = deps.readPane ?? (async (id: string) => (await resolveAgentPaneIo(id)).read(PANE_CAPTURE_LINES));
  const ensureMain = deps.ensureMain ?? ensureMainInputTarget;
  const press = deps.press ?? pressSendNowChord;

  const id = normalizeAgentId(rawId);
  const state = getState(id);
  if (!state) return { ok: false, status: 404, code: 'not-found', error: `Agent not found: ${id}` };

  const behavior = getHarnessBehavior(state.harness ?? 'claude-code');
  if (behavior.steerKind !== 'send-now-keys') {
    return {
      ok: false,
      status: 422,
      code: 'steer-unsupported',
      error: `Send now is supported for Claude Code only; ${id} runs ${behavior.displayName}`,
    };
  }

  let why: string | null = null;
  if (state.paused === true) why = 'paused';
  else if (getRuntimeState(id)?.state === 'suspended') why = 'suspended';
  else if (state.status === 'stopped') why = 'stopped';
  if (why) {
    return { ok: false, status: 409, code: 'not-running', error: `${id} is ${why}, so it has no running turn to interrupt` };
  }

  if (await isRemote(id)) {
    return { ok: false, status: 422, code: 'steer-unsupported', error: `Send now is not supported for remote agents (${id})` };
  }

  try {
    const text = await readPane(id);
    if (parsePermissionPrompt(text)) {
      return { ok: false, status: 409, code: 'permission-pending', error: 'Waiting: the agent needs a permission answer first' };
    }
  } catch {
    // Unreadable pane: fall through to ensure-main.
  }

  const target = await ensureMain(id);
  if (!target.ok) {
    return { ok: false, status: 409, code: 'input-target-not-main', error: target.reason };
  }

  try {
    await press(id);
  } catch (error) {
    return { ok: false, status: 502, code: 'press-failed', error: `Could not press send-now in ${id}'s pane: ${errorText(error)}` };
  }

  return { ok: true };
}
