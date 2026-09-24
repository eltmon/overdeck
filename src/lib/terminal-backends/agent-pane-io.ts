/**
 * Read an agent's pane, and key raw input into a Herdr pane, through the
 * host's terminal backend (review of #3992, L1 and M2).
 *
 * The TUI readiness waiters and the resume-summary gate read the pane's screen.
 * They used tmux `capture-pane` alone, which answers nothing for a Herdr pane:
 * a relaunch that now lands on Herdr never looked ready, and a menu on its
 * screen was never seen.
 *
 * Conversations stay on tmux on every host until PAN-3921, so the conversation
 * pane-choice route keeps its own tmux reads; this module is for agents.
 */

import { Effect } from 'effect';

import { getHerdrApiClient, type HerdrApiClient } from './herdr-api.js';
import type { TerminalBackend } from './types.js';

/**
 * The recent text of an agent's pane on the host's backend. On tmux this is
 * `capture-pane` (which answers `''` for a missing session, as it always did);
 * on Herdr it is `pane.read` on the pane holding the agent id, and it THROWS
 * when Herdr holds no such pane or the read fails — a caller must be able to
 * tell "the screen is empty" from "the screen could not be read".
 */
export async function readAgentPaneText(
  agentId: string,
  lines: number,
  backend?: TerminalBackend,
): Promise<string> {
  const { resolveLaunchBackend } = await import('./launch.js');
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name !== 'herdr') {
    const { capturePane } = await import('../tmux.js');
    return await capturePane(agentId, lines);
  }
  const { findHerdrAgentPane, readHerdrPaneText } = await import('./herdr.js');
  const pane = await findHerdrAgentPane(agentId);
  if (!pane) throw new Error(`herdr holds no pane for ${agentId}`);
  return await readHerdrPaneText(pane.paneId, lines);
}

/** Is the agent's pane still there: yes, no, or the probe could not tell. */
export type AgentPanePresence = 'present' | 'gone' | 'unknown';

/**
 * Presence of an agent's pane on the host's backend, for waiters that poll it
 * (review of #4018, L4). On Herdr this is `probeHerdrAgentLiveness`, which
 * keeps a socket timeout apart from "no such agent": `agentPaneExists` folds
 * both into false, so one slow `agent.get` ended a readiness wait. On tmux it
 * is `has-session`, as before.
 */
export async function probeAgentPane(agentId: string, backend?: TerminalBackend): Promise<AgentPanePresence> {
  const { resolveLaunchBackend } = await import('./launch.js');
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name !== 'herdr') {
    const { sessionExists } = await import('../tmux.js');
    return (await Effect.runPromise(sessionExists(agentId))) ? 'present' : 'gone';
  }
  const { probeHerdrAgentLiveness } = await import('./herdr.js');
  const probe = await probeHerdrAgentLiveness(agentId);
  if (probe.kind === 'alive') return 'present';
  if (probe.kind === 'indeterminate') return 'unknown';
  return 'gone';
}

/**
 * Herdr's logical key name for a tmux `send-keys` key name. `enter` is the key
 * the Herdr adapter's own launch path sends; the others follow Herdr's
 * lower-case logical names (`esc`, `ctrl+c` in its agent skill). Herdr
 * validates every key before writing any byte, so an unknown name fails the
 * whole call without typing anything.
 */
function toHerdrKey(tmuxKey: string): string {
  switch (tmuxKey) {
    case 'Enter': return 'enter';
    case 'Escape': return 'esc';
    case 'Up': return 'up';
    case 'Down': return 'down';
    default: return tmuxKey.toLowerCase();
  }
}

/**
 * Send raw keys to a Herdr pane with `pane.send_keys`. This is the only way to
 * answer a menu on a Herdr agent: `agent.prompt` refuses an agent that is
 * blocked on a dialog (`agent_blocked`). Throws when the call fails.
 */
export async function sendHerdrPaneKeys(
  paneId: string,
  tmuxKeys: readonly string[],
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<void> {
  await api.call('pane.send_keys', { pane_id: paneId, keys: tmuxKeys.map(toHerdrKey) });
}
