/**
 * Launch path shared by every spawner (PAN-3917 FR-5, W8).
 *
 * `pan start`, `pan spawn`, the review and test specialists, `pan strike`, and
 * `pan handoff --issue` all place their pane in the issue's workspace and stamp
 * the same four metadata tokens: `issue`, `role`, `harness`, `model`. This
 * module is the one place that resolves the backend (D10 selection), finds or
 * creates the workspace, and starts the pane — so a launcher is three lines and
 * cannot forget the tokens.
 *
 * Importing it registers both adapters.
 */

import { Effect } from 'effect';

import { loadConfigSync } from '../config-yaml.js';
import './herdr.js';
import './tmux.js';
import { resolveTerminalBackend } from './registry.js';
import { selectTerminalBackend } from './select.js';
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
  let configured: { terminal?: { backend?: TerminalBackendName } } = {};
  try {
    configured = loadConfigSync() as { terminal?: { backend?: TerminalBackendName } };
  } catch {
    // An unreadable config is a selection input, not a launch failure: D10's
    // probe then decides on the binary and socket alone.
  }
  const { backend } = await selectTerminalBackend(configured);
  return resolveTerminalBackend(backend);
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

