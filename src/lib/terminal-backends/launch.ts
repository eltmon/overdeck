/**
 * Launch path shared by every spawner (PAN-3917 FR-5, W8).
 *
 * `pan start`, `pan spawn`, the review and test specialists, and `pan strike`
 * place their pane in the issue's workspace and stamp the same four metadata
 * tokens: `issue`, `role`, `harness`, `model`. This module is the one place
 * that resolves the backend (D10 selection), finds or creates the workspace,
 * and starts the pane — so a launcher is three lines and cannot forget the
 * tokens. Conversations, forks and handoffs, and `pan flywheel start` route
 * through `launchAgentPane` too (PAN-3921): the pane is named `conv-<name>`
 * and stamped with role `conversation` unless `pan handoff --role` says
 * otherwise, so a handoff started with `--issue X --role review` is X's
 * Review row.
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
  type AgentPaneRef,
  type PaneTokens,
  type TerminalBackend,
  type TerminalBackendName,
} from './types.js';

/** Workspace that hosts operator conversations — panes with no `issue` token. */
export const CONVERSATIONS_WORKSPACE = 'conversations';

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
 * Close whatever pane already answers to this agent id on the host backend:
 * the tmux session of that name, or the Herdr agent of that name. A respawn
 * reuses the id, so the old pane must be gone before `launchAgentPane`.
 * Errors are swallowed: there is nothing to close when no pane answers.
 */
export async function closeAgentPaneByName(agentId: string, backend?: TerminalBackend): Promise<void> {
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name === 'herdr') {
    const { findHerdrAgent } = await import('./herdr.js');
    const live = await findHerdrAgent(agentId);
    if (!live) return;
    await Effect.runPromise(
      resolved.close({
        backend: 'herdr',
        workspaceId: live.workspaceId,
        paneId: live.paneId,
        terminalId: live.terminalId,
        agentName: agentId,
      }),
    ).catch(() => {});
    return;
  }
  const { killSession } = await import('../tmux.js');
  await Effect.runPromise(killSession(agentId)).catch(() => {});
}
