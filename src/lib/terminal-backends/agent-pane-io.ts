/**
 * Read an agent's pane, and key raw input into a Herdr pane, through the
 * host's terminal backend (review of #3992, L1 and M2).
 *
 * The TUI readiness waiters and the resume-summary gate read the pane's screen.
 * They used tmux `capture-pane` alone, which answers nothing for a Herdr pane:
 * a relaunch that now lands on Herdr never looked ready, and a menu on its
 * screen was never seen.
 *
 * Conversation readiness reads through here too (PAN-3921); only the
 * conversation pane-choice route keeps its own tmux reads.
 */

import { stripVTControlCharacters } from 'node:util';

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
  /** Herdr only: `visible` for readiness — `recent` is empty on a full-screen TUI's alternate screen. */
  source: 'recent' | 'visible' = 'recent',
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
  return await readHerdrPaneText(pane.paneId, lines, source);
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

/** The keys ensure-main may send (PAN-4268). Never printable text, `x`, or `Left`. */
export type SelectorKey = 'Up' | 'Down' | 'Enter' | 'Escape';

/** Read and key one agent's pane, bound to whichever backend holds it. */
export interface AgentPaneIo {
  readonly backend: 'herdr' | 'tmux';
  read(lines: number): Promise<string>;
  sendKey(key: SelectorKey): Promise<void>;
}

/**
 * Resolve the pane once (PAN-4268). On a Herdr host with a Herdr pane for the
 * agent: `pane.read` (source `visible`) and `pane.send_keys`. Otherwise — a tmux
 * host, or a Herdr host whose agent Herdr does not hold (legacy tmux agents on
 * `tmux -L overdeck`, the same fallback `deliverAgentMessage` takes) — tmux
 * `capturePane` and `sendKeysAsync`.
 */
export async function resolveAgentPaneIo(agentId: string, backend?: TerminalBackend): Promise<AgentPaneIo> {
  const { resolveLaunchBackend } = await import('./launch.js');
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name === 'herdr') {
    const { findHerdrAgentPane, readHerdrPaneText } = await import('./herdr.js');
    const pane = await findHerdrAgentPane(agentId);
    if (pane) {
      return {
        backend: 'herdr',
        read: (lines) => readHerdrPaneText(pane.paneId, lines, 'visible'),
        sendKey: (key) => sendHerdrPaneKeys(pane.paneId, [key]),
      };
    }
  }
  const { capturePane, sendKeysAsync } = await import('../tmux.js');
  return {
    backend: 'tmux',
    read: (lines) => capturePane(agentId, lines),
    sendKey: (key) => sendKeysAsync(agentId, key, 'input-target'),
  };
}

/** How long a refusal waits for the screen before it reports without it. */
const BLOCKED_SCREEN_READ_MS = 3_000;
const BLOCKED_EXCERPT_LINES = 6;
const BLOCKED_EXCERPT_CHARS = 240;

/**
 * The last few non-empty lines of a blocked agent's screen, flattened to one
 * bounded line: control sequences and box-drawing borders removed, lines joined
 * with ` / `, and the TAIL kept when it is too long (a dialog's options and
 * footer are at the bottom). Empty when nothing readable is left.
 */
export function blockedDialogExcerpt(screen: string): string {
  const lines = stripVTControlCharacters(screen)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u2500-\u257F]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const excerpt = lines.slice(-BLOCKED_EXCERPT_LINES).join(' / ');
  return excerpt.length > BLOCKED_EXCERPT_CHARS ? `…${excerpt.slice(-(BLOCKED_EXCERPT_CHARS - 1))}` : excerpt;
}

/**
 * The failure text for a Herdr prompt refusal. `agent_blocked` means the agent
 * sits at an approval or question dialog, which only keys can answer, so the
 * text says so and quotes the screen. The instruction comes first: the
 * composer shows one ellipsized line with the whole text on hover. Reading the
 * screen is bounded and best-effort; a failed read still names the dialog.
 */
export async function describeHerdrRefusal(reason: string, paneId: string): Promise<string> {
  if (reason !== 'agent_blocked') return `refused: ${reason}`;
  const hint = 'refused: agent_blocked — the agent is waiting at a dialog; open the Terminal tab to answer it';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { readHerdrPaneText } = await import('./herdr.js');
    const screen = await Promise.race([
      readHerdrPaneText(paneId, 40, 'visible'),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve(''), BLOCKED_SCREEN_READ_MS); }),
    ]);
    const excerpt = blockedDialogExcerpt(screen);
    return excerpt ? `${hint}: "${excerpt}"` : hint;
  } catch {
    return hint;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
