/**
 * Launch path shared by every spawner (PAN-3917 FR-5, W8).
 *
 * `pan start`, `pan spawn`, the review and test specialists, and `pan strike`
 * place their pane in the issue's workspace and stamp the same four metadata
 * tokens: `issue`, `role`, `harness`, `model`. This module is the one place
 * that resolves the backend (D10 selection), finds or creates the workspace,
 * and starts the pane — so a launcher is three lines and cannot forget the
 * tokens. `pan handoff --issue` does not route through here yet — the forked
 * conversation still inherits its parent's cwd (or an explicit `--cwd`), not
 * the issue's workspace; giving it the same pane placement is a post-release
 * follow-up (docs/THE-CUT.md).
 *
 * Importing it registers both adapters.
 */

import { Effect } from 'effect';

import './herdr.js';
import './tmux.js';
import { resolveTerminalBackend } from './registry.js';
import { hostTerminalBackendName } from './select.js';
import {
  isUnsupported,
  type AgentDetectionPolicy,
  type AgentPaneRef,
  type PaneTokens,
  type TerminalBackend,
  type TerminalBackendName,
} from './types.js';

/** Workspace that hosts operator conversations — panes with no `issue` token. */
export const CONVERSATIONS_WORKSPACE = 'conversations';

/**
 * Per-harness detection policy (PAN-3917 W12).
 *
 * Herdr's agent detector reads the pane's FOREGROUND PROCESS and matches it
 * against its own agent manifest. That works for `claude-code`, whose launcher
 * execs the real `claude` binary (proven live: detected in ~2s). It can never
 * work for a harness Overdeck runs through a host/transport process — the codex
 * app-server (`node dist/codex-app-server-host.js`), the ACP host, kimi-code,
 * ohmypi/muse — because the foreground process is node, not the harness. On
 * 2026-09-19 `agent-pan-3705-review` (codex, gpt-5.6-sol) went
 * `starting → error` exactly 61s after launch for that reason: the app-server
 * host had connected fine, and the adapter closed its pane anyway.
 *
 * Those harnesses are therefore launched PANE-BOUND: the pane is stamped,
 * launched and returned immediately, and everything that used to go through
 * Herdr's agent record (liveness, delivery) goes through the pane and the
 * harness's own transport instead.
 *
 * Codex with `codex.transport: tui` runs the codex TUI, which Herdr could
 * detect — it is still launched pane-bound, which costs it only `agent.prompt`
 * (delivery falls through to `codex-exec-resume`, the tmux path).
 */
export function detectionPolicyFor(harness: string): AgentDetectionPolicy {
  return harness === 'claude-code' ? 'required' : 'not-required';
}

/** The backend this host launches into, with both adapters registered. */
export async function resolveLaunchBackend(): Promise<TerminalBackend> {
  return resolveTerminalBackend(await hostTerminalBackendName());
}

/**
 * Close a pane a launch already created (PAN-3917 FR-3). `stopAgent` and
 * `killSession` reach a tmux session; on Herdr there is none, so the pane is
 * closed through the reference `launchAgentPane` returned. A tmux pane (or a
 * launch that never got a reference) falls through to the tmux path the caller
 * already runs.
 */
export async function closeBackendPane(pane: AgentPaneRef | null): Promise<void> {
  if (!pane || pane.backend === 'tmux') return;
  const { resolveTerminalBackend: resolve } = await import('./registry.js');
  await Effect.runPromise(resolve(pane.backend).close(pane)).catch(() => {});
}

export interface LaunchPaneRequest {
  /** Issue the pane belongs to; absent for an operator conversation. */
  readonly issueId?: string;
  /** Working directory for the pane (the workspace checkout). */
  readonly cwd: string;
  /** Agent id — the tmux session name, and the Herdr live agent name. */
  readonly agentId: string;
  /** Command line to run in the pane (Overdeck's generated launcher). */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly tokens: PaneTokens;
}

/**
 * Place a pane in the issue workspace, run the launcher in it, and stamp its
 * tokens. Behaves exactly as `createSession` did on tmux.
 */
export async function launchAgentPane(
  request: LaunchPaneRequest,
  backend?: TerminalBackend,
): Promise<AgentPaneRef> {
  const resolved = backend ?? (await resolveLaunchBackend());
  const workspace = await Effect.runPromise(
    resolved.workspaceFor(request.issueId ?? CONVERSATIONS_WORKSPACE, request.cwd),
  );
  if (isUnsupported(workspace)) {
    throw new Error(`${resolved.name} cannot host an issue workspace: ${workspace.reason}`);
  }
  const pane = await Effect.runPromise(
    resolved.startAgent(workspace, {
      kind: request.tokens.harness,
      argv: request.argv,
      env: request.env,
      tokens: request.tokens,
      name: request.agentId,
      cwd: request.cwd,
      detection: detectionPolicyFor(request.tokens.harness),
    }),
  );
  if (isUnsupported(pane)) {
    throw new Error(`${resolved.name} could not start ${request.agentId}: ${pane.reason}`);
  }
  return pane;
}

/**
 * Does a pane for this agent id already exist on the host's backend? On tmux
 * that is a live session; on Herdr, a live agent with that name. The spawn
 * guards use it so a second dispatch cannot stomp a running agent on either
 * backend.
 */
export async function agentPaneExists(agentId: string, backend?: TerminalBackend): Promise<boolean> {
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name === 'herdr') {
    const { findHerdrAgent } = await import('./herdr.js');
    return (await findHerdrAgent(agentId)) !== null;
  }
  const { sessionExists } = await import('../tmux.js');
  return await Effect.runPromise(sessionExists(agentId));
}

/**
 * Close the pane `agentPaneExists` sees for an agent. `stopAgent` reaches only
 * a tmux session (plus a launcher-path process sweep that cannot match a Herdr
 * pane's bare `/bin/bash`), so on Herdr a finished agent's pane — and the idle
 * harness inside it — outlives every stop until the pane itself is closed.
 * Returns true when a Herdr pane was closed; false when there was nothing to
 * close or the host runs tmux (where `stopAgent`'s `killSession` already did it).
 */
export async function closeAgentPane(agentId: string, backend?: TerminalBackend): Promise<boolean> {
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name !== 'herdr') return false;
  const { findHerdrAgent } = await import('./herdr.js');
  const ref = await findHerdrAgent(agentId);
  if (!ref) return false;
  await Effect.runPromise(resolved.close({
    backend: 'herdr',
    workspaceId: ref.workspaceId,
    paneId: ref.paneId,
    terminalId: ref.terminalId,
    agentName: agentId,
  })).catch(() => {});
  return true;
}
