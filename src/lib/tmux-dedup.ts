/**
 * Keyed, crash-safe tmux delivery (PAN-2997).
 *
 * The dashboard cannot dedupe a tmux paste from its own state — a crash
 * between the paste and the dashboard's acknowledgment bookkeeping would make
 * recovery re-paste. The dedup record therefore lives in the
 * crash-independent component: per-session tmux user options. All
 * check/paste/mark sequences that must not be interrupted are issued as ONE
 * `if-shell` command list, which the tmux SERVER executes — a dashboard exit
 * cannot interrupt it, and a tmux-server exit kills the agent session itself,
 * so a replay after either crash is correct.
 *
 * The protocol is two-phase so the complete paste-settle-submit transaction
 * survives a dashboard crash: the key becomes terminal only as part of the
 * server-owned submission itself.
 *
 *   (none) ──paste──► PENDING ──atomic claim+Enter──► TERMINAL
 *
 * - `sendKeysDedup` atomically pastes and sets the PENDING option only when
 *   neither option is set. A replay that finds PENDING (a prior attempt
 *   crashed before submitting) returns 'submit-pending' WITHOUT re-pasting.
 * - `completeKeyedSubmit` issues ONE `if-shell`: only when PENDING is present
 *   and TERMINAL absent does the tmux server flip TERMINAL, clear PENDING,
 *   and send the Enter — in that order, in a single server-executed command
 *   list. Exactly one caller can become the completer; every other concurrent
 *   or post-crash caller loses the server-side condition and sends nothing,
 *   so no stray Enter can ever land in a composer holding unrelated text.
 */

import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { tmuxExecAsync, validateSessionName } from './tmux.js';

export const DEDUP_KEY_RE = /^[A-Za-z0-9:_-]+$/;

/** Set once the keyed message has been SUBMITTED (Enter sent). */
export function dedupTerminalOptionName(dedupKey: string): string {
  return `@overdeck-dedup-${dedupKey}`;
}

/** Set atomically with the paste; cleared when the terminal marker lands. */
export function dedupPendingOptionName(dedupKey: string): string {
  return `@overdeck-dedup-pending-${dedupKey}`;
}

export function assertValidDedupKey(dedupKey: string): void {
  if (!DEDUP_KEY_RE.test(dedupKey)) {
    throw new Error(`dedupKey must match [A-Za-z0-9:_-]+, got: ${dedupKey.slice(0, 40)}`);
  }
}

/** Settle window between paste and Enter — mirrors the supervisor's proven timing. */
const PASTE_SETTLE_MS = 300;

export type KeyedTmuxPhase =
  /** This call pasted the message and owns the pending claim — caller must submit. */
  | 'pasted'
  /** A prior attempt pasted but crashed before/around submit — caller must complete the submit WITHOUT pasting. */
  | 'submit-pending'
  /** The key is terminal: the message was already submitted. No paste, no Enter. */
  | 'deduplicated';

/**
 * Deduplicated message paste for the tmux fallback path.
 *
 * Returns 'pasted' when this call pasted (caller must complete the submit),
 * 'submit-pending' when a prior attempt's paste is still awaiting submission
 * (caller must complete the submit — crucially WITHOUT pasting again), and
 * 'deduplicated' when the key is already terminal (caller does nothing; no
 * stray Enter, because the composer may hold unrelated operator text).
 *
 * Throws when the keyed paste did not land and no marker explains why —
 * silent loss must surface as a delivery failure, not as a false dedup.
 */
export async function sendKeysDedup(
  sessionName: string,
  keys: string,
  dedupKey: string,
  caller?: string,
): Promise<KeyedTmuxPhase> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);

  const sendId = randomUUID();
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  const bufferName = `pan-${sendId}`;

  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });

    // One server-side command: paste only when NEITHER marker is set, and
    // record OUR sendId in the pending option in the same breath. Reading the
    // markers back distinguishes "we just pasted" from "a prior attempt is
    // mid-transaction" from "already submitted".
    await tmuxExecAsync([
      'if-shell', '-t', sessionName,
      `test -z "$(tmux show-option -qv -t ${sessionName} ${pendingOption})" && test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})"`,
      `paste-buffer -b ${bufferName} -p -t ${sessionName} \; set-option -t ${sessionName} ${pendingOption} ${sendId}`,
    ], { encoding: 'utf-8' });

    const [pendingMarker, terminalMarker] = await Promise.all([
      tmuxExecAsync(['show-option', '-qv', '-t', sessionName, pendingOption], { encoding: 'utf-8' })
        .then(result => String(result.stdout).trim(), () => ''),
      tmuxExecAsync(['show-option', '-qv', '-t', sessionName, terminalOption], { encoding: 'utf-8' })
        .then(result => String(result.stdout).trim(), () => ''),
    ]);

    if (terminalMarker !== '') return 'deduplicated';
    if (pendingMarker === sendId) return 'pasted';
    if (pendingMarker !== '') return 'submit-pending';
    throw new Error(
      `Keyed tmux paste for ${sessionName} did not land and no dedup marker was recorded` +
      (caller ? ` (caller: ${caller})` : ''),
    );
  } finally {
    await unlink(tmpFile).catch(() => {});
    await tmuxExecAsync(['delete-buffer', '-b', bufferName], { encoding: 'utf-8' }).catch(() => {});
  }
}

/**
 * Complete the paste-settle-submit transaction for a keyed tmux delivery.
 *
 * After the settle window, the SUBMISSION is one server-owned command: a
 * single `if-shell` whose condition requires the pending claim present and
 * the terminal marker absent, and whose command list flips the key TERMINAL
 * and clears pending BEFORE sending the Enter. The tmux server executes the
 * whole sequence, so exactly one caller can ever become the completer —
 * concurrent same-key completers lose the condition and send nothing, and a
 * dashboard that retries after a crash never has to decide whether a prior
 * standalone Enter landed: the server-side condition answers that. No code
 * path sends a stray Enter into a composer that may hold unrelated operator
 * text (review cycle 8).
 *
 * Safe to call for both 'pasted' and 'submit-pending' phases; a call whose
 * key is already terminal is a no-op. Throws when neither marker is present
 * after the command — the pending claim vanished without a submission, which
 * must surface as a delivery failure rather than silent loss.
 */
export async function completeKeyedSubmit(sessionName: string, dedupKey: string): Promise<void> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);

  await new Promise(resolve => setTimeout(resolve, PASTE_SETTLE_MS));
  await tmuxExecAsync([
    'if-shell', '-t', sessionName,
    `test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})" && test -n "$(tmux show-option -qv -t ${sessionName} ${pendingOption})"`,
    `set-option -t ${sessionName} ${terminalOption} 1 \; set-option -u -t ${sessionName} ${pendingOption} \; send-keys -t ${sessionName} C-m`,
  ], { encoding: 'utf-8' });

  const [terminalMarker, pendingMarker] = await Promise.all([
    tmuxExecAsync(['show-option', '-qv', '-t', sessionName, terminalOption], { encoding: 'utf-8' })
      .then(result => String(result.stdout).trim(), () => ''),
    tmuxExecAsync(['show-option', '-qv', '-t', sessionName, pendingOption], { encoding: 'utf-8' })
      .then(result => String(result.stdout).trim(), () => ''),
  ]);
  if (terminalMarker === '' && pendingMarker === '') {
    throw new Error(`Keyed tmux submit for ${sessionName} found neither a pending claim nor a terminal marker — the paste vanished without submission`);
  }
}
