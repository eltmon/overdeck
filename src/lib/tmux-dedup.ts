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
 * Thrown when a keyed submit found the target pane DEAD (the harness exited
 * between the paste and the submission) or dying around the Enter. The
 * pending claim is deliberately preserved/restored and the key is NOT
 * terminal, so no recovery ever suppresses the wake as delivered: the
 * caller's recovery leaves its receipt pending and re-drives the delivery
 * after the agent resumes (PAN-2997 cycle 9/10).
 */
export class KeyedSubmitTargetDeadError extends Error {
  constructor(sessionName: string, dedupKey: string) {
    super(
      `Keyed tmux submit for ${sessionName} found a dead pane — the Enter was NOT accepted by a live harness, ` +
      `the pending claim for key "${dedupKey}" is preserved, and the key is not terminal`,
    );
    this.name = 'KeyedSubmitTargetDeadError';
  }
}

interface PaneTarget {
  pid: string;
  dead: boolean;
}

/** pane_pid + pane_dead in one read — the identity of the Enter's target. */
async function readPaneTarget(sessionName: string): Promise<PaneTarget> {
  return tmuxExecAsync(['display-message', '-p', '-t', sessionName, '#{pane_pid} #{pane_dead}'], { encoding: 'utf-8' })
    .then(result => {
      const [pid = '', dead = ''] = String(result.stdout).trim().split(/\s+/);
      return { pid, dead: dead === '1' };
    })
    // An unreadable target cannot be proven alive — treat it as dead so the
    // key is never claimed on guesswork.
    .catch(() => ({ pid: '', dead: true }));
}

async function readMarker(sessionName: string, option: string): Promise<string> {
  return tmuxExecAsync(['show-option', '-qv', '-t', sessionName, option], { encoding: 'utf-8' })
    .then(result => String(result.stdout).trim(), () => '');
}

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
 * single `if-shell` whose condition requires the pending claim present, the
 * terminal marker absent, AND the pane alive, and whose command list sends
 * the Enter FIRST and only then flips the key TERMINAL and clears pending.
 * The tmux server executes the whole sequence (cycle 9 ordering):
 *
 * - A pane that died during the settle window fails the liveness condition —
 *   NO marker changes and NO Enter is sent, so the wake is never recorded as
 *   delivered when it never landed. The preserved pending claim lets
 *   recovery retry after the agent resumes.
 * - The pre-branch liveness condition is NOT proof of acceptance (cycle 10):
 *   the pane can die in the shell-to-branch handoff, and tmux reports
 *   send-keys into a remain-on-exit corpse as success. So after the command
 *   the target is re-read — if the pane died or its pid changed around the
 *   Enter, the terminal marker is ROLLED BACK, the pending claim restored,
 *   and KeyedSubmitTargetDeadError is thrown.
 * - The Enter precedes the terminal transition inside the transaction, so a
 *   failed Enter (which aborts the command list) can never leave the key
 *   terminal.
 * - Exactly one caller becomes the completer; concurrent or post-crash
 *   callers lose the server-side condition and send no stray Enter into a
 *   composer that may hold unrelated operator text.
 *
 * Safe to call for both 'pasted' and 'submit-pending' phases; a call whose
 * key is already terminal is a no-op. Throws KeyedSubmitTargetDeadError when
 * the pane is dead (pending claim preserved), and a generic error when both
 * markers vanished without a submission.
 */
export async function completeKeyedSubmit(sessionName: string, dedupKey: string): Promise<void> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);

  await new Promise(resolve => setTimeout(resolve, PASTE_SETTLE_MS));

  // Snapshot the Enter target's identity BEFORE the submit. The if-shell's
  // pre-branch liveness condition is only an optimization: the pane can die
  // in the shell-to-branch handoff, and tmux reports send-keys into a
  // remain-on-exit corpse as SUCCESS. What proves acceptance is the
  // post-submit check below (cycle 10).
  const preTarget = await readPaneTarget(sessionName);
  const pendingBefore = await readMarker(sessionName, pendingOption);

  await tmuxExecAsync([
    'if-shell', '-t', sessionName,
    `test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})" && ` +
    `test -n "$(tmux show-option -qv -t ${sessionName} ${pendingOption})" && ` +
    `test "$(tmux display-message -p -t ${sessionName} '#{pane_dead}')" = "0"`,
    `send-keys -t ${sessionName} C-m \; set-option -t ${sessionName} ${terminalOption} 1 \; set-option -u -t ${sessionName} ${pendingOption}`,
  ], { encoding: 'utf-8' });

  const [terminalAfter, pendingAfter, postTarget] = await Promise.all([
    readMarker(sessionName, terminalOption),
    readMarker(sessionName, pendingOption),
    readPaneTarget(sessionName),
  ]);

  const targetLost = postTarget.dead || (preTarget.pid !== '' && postTarget.pid !== preTarget.pid);

  if (terminalAfter !== '') {
    if (!targetLost) return; // Submitted to a live pane — by this call or a concurrent completer.
    // The pane died or was replaced around the Enter: tmux may have reported
    // send-keys as successful while the input landed nowhere, and even an
    // accepted Enter is worthless once the receiving harness is gone. ROLL
    // THE KEY BACK — clear the terminal marker and restore the pending claim
    // — so recovery re-drives the wake after resume instead of suppressing
    // it as delivered (cycle 10).
    const rollbackArgs = pendingBefore === ''
      ? ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-u', '-t', sessionName, pendingOption]
      : ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-t', sessionName, pendingOption, pendingBefore];
    await tmuxExecAsync(rollbackArgs, { encoding: 'utf-8' }).catch(() => {});
    throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
  }
  if (pendingAfter !== '') {
    // The condition rejected the submit. A dead/replaced pane is the
    // recoverable case (the pending claim is preserved so recovery can retry
    // after resume); anything else is a definitive delivery failure.
    if (targetLost) throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
    throw new Error(`Keyed tmux submit for ${sessionName} was rejected with the pending claim intact on a live pane`);
  }
  throw new Error(`Keyed tmux submit for ${sessionName} found neither a pending claim nor a terminal marker — the paste vanished without submission`);
}
