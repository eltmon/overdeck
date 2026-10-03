/**
 * PAN-4492: Herdr's `agent.prompt` types text and presses Enter in the same
 * breath, so a large paste that is still rendering into Claude Code's
 * composer can swallow the Enter — the message sits in the input box while
 * delivery reports it sent. This module pastes, waits for the paste to show
 * in the composer, settles, presses the submit keystroke itself, and watches
 * the composer afterward so the Enter's fate is actually known.
 *
 * Never presses a keystroke when a permission prompt or choice menu is on
 * screen, or the agent is `blocked` — an unverified Enter there answers a
 * question nobody asked (PAN-3212, PAN-4278). At most one resubmit per
 * delivery; a second miss is left for the caller to investigate rather than
 * risk stacking a duplicate by re-pasting.
 */

import { screenComposerPayloadPresence, type ComposerPayloadPresence } from '../pane-composer.js';
import { paneHasBlockingChoiceMenu } from '../pane-choice-menu.js';
import { STEER_HERDR_KEYS, type SubmitMode } from './steer-keys.js';

/** Structural, like steer-keys.ts: importing herdr-api here would close an import cycle through types.ts. */
export interface HerdrSubmitApi { call(method: string, params: Record<string, unknown>): Promise<unknown> }
export interface HerdrSubmitDeps { readonly sleep?: (ms: number) => Promise<void>; readonly now?: () => number }
export type HerdrSubmitOutcome = 'submitted' | 'resubmitted' | 'held' | 'unconfirmed' | 'blocked';

export const PASTE_VISIBLE_TIMEOUT_MS = 3_000;
export const SUBMIT_CONFIRM_MS = 2_000;
export const POLL_INTERVAL_MS = 50;
const SCREEN_LINES = 200;

/** The tmux formula (src/lib/tmux.ts sendKeys): 600 ms to 3 s, by line count and size. */
export function pasteSettleMs(text: string): number {
  return Math.max(600, Math.min(3000, text.split('\n').length * 15 + Math.floor(text.length / 1000) * 50));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function pasteAndSubmitHerdrPane(
  api: HerdrSubmitApi,
  paneId: string,
  text: string,
  mode: SubmitMode = 'enter',
  deps: HerdrSubmitDeps = {},
): Promise<HerdrSubmitOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const keys = mode === 'steer' ? [...STEER_HERDR_KEYS] : ['enter'];
  const label = mode === 'steer' ? 'the steer chord' : 'Enter';

  const read = async (): Promise<string | null> => {
    try {
      const result = await api.call('pane.read', {
        pane_id: paneId, source: 'visible', lines: SCREEN_LINES, strip_ansi: true,
      }) as { text?: string } | null;
      return result?.text ?? '';
    } catch {
      return null;
    }
  };

  const blocked = async (): Promise<boolean> => {
    try {
      const result = await api.call('agent.get', { target: paneId }) as { agent?: { agent_status?: string } } | null;
      return result?.agent?.agent_status === 'blocked';
    } catch {
      return false;
    }
  };

  // Step 1: a throw here propagates — nothing was typed.
  await api.call('pane.send_text', { pane_id: paneId, text: `\x1b[200~${text}\x1b[201~` });

  // Step 2: poll until the paste shows in the composer, or the timeout passes.
  const start = now();
  let lastScreen = '';
  let presence: ComposerPayloadPresence = 'unproven';
  for (;;) {
    const screen = await read();
    if (screen !== null) lastScreen = screen;
    presence = screen === null ? 'unproven' : screenComposerPayloadPresence(screen, text);
    if (presence === 'present' || now() - start >= PASTE_VISIBLE_TIMEOUT_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }
  const settleRemaining = pasteSettleMs(text) - (now() - start);
  if (settleRemaining > 0) await sleep(settleRemaining);

  // Step 3: the paste was never seen — only a blocked pane or menu withholds the keystroke.
  if (presence !== 'present' && (await blocked() || paneHasBlockingChoiceMenu(lastScreen))) {
    console.warn(
      `[herdr-submit] ${paneId}: paste not visible and the pane is blocked on a menu; not pressing ${label} (PAN-4492)`,
    );
    return 'blocked';
  }

  // Step 4: press the submit keystroke.
  await api.call('pane.send_keys', { pane_id: paneId, keys: [...keys] });

  // Step 5: poll for the composer to clear.
  const confirmStart = now();
  let lastPresence: ComposerPayloadPresence = 'unproven';
  while (now() - confirmStart < SUBMIT_CONFIRM_MS) {
    await sleep(POLL_INTERVAL_MS);
    const screen = await read();
    if (screen !== null) lastScreen = screen;
    lastPresence = screen === null ? 'unproven' : screenComposerPayloadPresence(screen, text);
    if (lastPresence === 'absent') return 'submitted';
  }

  // Step 6: the composer still holds the payload (or we never proved it cleared).
  if (lastPresence === 'unproven') return 'unconfirmed';
  if (await blocked() || paneHasBlockingChoiceMenu(lastScreen)) {
    console.warn(
      `[herdr-submit] ${paneId}: still holds the message but a menu or permission prompt is showing; not resending ${label} (PAN-4492)`,
    );
    return 'held';
  }
  console.warn(
    `[herdr-submit] ${paneId}: message still in Claude Code's input box ${SUBMIT_CONFIRM_MS} ms after ${label}; resubmitting once (PAN-4492)`,
  );
  await api.call('pane.send_keys', { pane_id: paneId, keys: [...keys] });
  return 'resubmitted';
}
