/**
 * Claude Code's send-now chord (`chat:sendNow`), PAN-4292.
 *
 * A steer types the message, then presses Ctrl+X Ctrl+S instead of Enter.
 * Claude Code interrupts the running turn and sends the message at once;
 * while idle the chord is a plain submit. Ctrl+Enter is bound to the same
 * action but cannot cross a multiplexer: tmux sends no bytes for `C-Enter`
 * and Herdr sends `\r` (a plain submit). So every backend uses Ctrl+X Ctrl+S.
 * This module is the one place that spells the chord for each backend.
 */

import type { HerdrApiClient } from './herdr-api.js';

/** How a delivery finishes: Enter (queue while busy) or the send-now chord (steer). */
export type SubmitMode = 'enter' | 'steer';

/** tmux `send-keys` names for the send-now chord (bytes `0x18 0x13`). */
export const STEER_TMUX_KEYS = ['C-x', 'C-s'] as const;

/** Herdr `pane.send_keys` names for the send-now chord. */
export const STEER_HERDR_KEYS = ['ctrl+x', 'ctrl+s'] as const;

/** Raw PTY bytes for the send-now chord. Claude Code runs its tty in raw mode (IXON off), so `0x13` reaches it. */
export const STEER_PTY_BYTES = '\x18\x13';

/** Pause between typing the steer text and pressing the chord, so the composer has rendered the paste. */
export const STEER_SETTLE_MS = 300;

/** The tmux `send-keys` names that submit the composer in the given mode. */
export function tmuxSubmitKeys(mode: SubmitMode = 'enter'): readonly string[] {
  return mode === 'steer' ? STEER_TMUX_KEYS : ['C-m'];
}

/**
 * Steer a Herdr agent pane. `agent.prompt` always ends with Enter, so a steer
 * types the text itself and presses the chord. `pane.send_text` writes raw
 * bytes with no bracketed-paste wrapping, so the text is wrapped here: a
 * multi-line message must not submit at its first newline.
 */
export async function steerHerdrPane(
  api: Pick<HerdrApiClient, 'call'>,
  paneId: string,
  text: string,
): Promise<void> {
  await api.call('pane.send_text', { pane_id: paneId, text: `\x1b[200~${text}\x1b[201~` });
  await new Promise((resolve) => setTimeout(resolve, STEER_SETTLE_MS));
  await api.call('pane.send_keys', { pane_id: paneId, keys: [...STEER_HERDR_KEYS] });
}
