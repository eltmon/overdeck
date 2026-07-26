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
 *   A POISON breadcrumb (a terminal marker that proved false but could not be
 *   rolled back) is repaired first and never honored as a dedup.
 * - `completeKeyedSubmit` issues ONE `if-shell`: only when PENDING is
 *   present, TERMINAL absent, and the pane alive does the tmux server send
 *   the Enter and then flip TERMINAL and clear PENDING — in that order, in a
 *   single server-executed command list. After the command the target is
 *   re-read: if the pane died, was replaced, or cannot be identified around
 *   the Enter, the terminal marker is rolled back under a poison breadcrumb
 *   and the pending claim restored. Exactly one caller can become the
 *   completer; every other concurrent or post-crash caller loses the
 *   server-side condition and sends nothing, so no stray Enter can ever land
 *   in a composer holding unrelated text.
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

/**
 * Rollback-required breadcrumb (cycle 11). Set when a post-submit check
 * proves a terminal marker FALSE but the rollback could not be verified.
 * While this marker exists the terminal marker must never be honored — the
 * next keyed call repairs the markers before anything else.
 */
export function dedupPoisonOptionName(dedupKey: string): string {
  return `@overdeck-dedup-poison-${dedupKey}`;
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

export interface PaneTarget {
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
  const poisonOption = dedupPoisonOptionName(dedupKey);

  const sendId = randomUUID();

  // The poison breadcrumb invalidates any terminal marker (cycle 11): a
  // previous post-submit check proved the terminal marker FALSE but could
  // not verify its rollback. Repair the markers FIRST — the terminal marker
  // must never be honored while the breadcrumb exists — then continue as a
  // pending completion, never as a dedup and never as a fresh paste.
  const poisonMarker = await readMarker(sessionName, poisonOption);
  if (poisonMarker !== '') {
    await tmuxExecAsync([
      'set-option', '-u', '-t', sessionName, terminalOption,
      ';',
      'set-option', '-t', sessionName, pendingOption, sendId,
    ], { encoding: 'utf-8' });
    const [repairedTerminal, repairedPending] = await Promise.all([
      readMarker(sessionName, terminalOption),
      readMarker(sessionName, pendingOption),
    ]);
    if (repairedTerminal !== '' || repairedPending === '') {
      throw new Error(`Keyed tmux markers for ${sessionName} are poisoned and could not be repaired (key "${dedupKey}")`);
    }
    await tmuxExecAsync(['set-option', '-u', '-t', sessionName, poisonOption], { encoding: 'utf-8' }).catch(() => {});
    return 'submit-pending';
  }

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
export interface KeyedSubmitDeps {
  /** Test seam for target-read failures; production uses the real tmux read. */
  readPaneTarget?: (sessionName: string) => Promise<PaneTarget>;
}

export async function completeKeyedSubmit(
  sessionName: string,
  dedupKey: string,
  deps: KeyedSubmitDeps = {},
): Promise<void> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const readTarget = deps.readPaneTarget ?? readPaneTarget;
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);
  const poisonOption = dedupPoisonOptionName(dedupKey);

  await new Promise(resolve => setTimeout(resolve, PASTE_SETTLE_MS));

  // Snapshot the Enter target's identity BEFORE the submit. The if-shell's
  // pre-branch liveness condition is only an optimization: the pane can die
  // in the shell-to-branch handoff, and tmux reports send-keys into a
  // remain-on-exit corpse as SUCCESS. What proves acceptance is the
  // post-submit check below (cycle 10).
  const preTarget = await readTarget(sessionName);
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
    readTarget(sessionName),
  ]);

  // FAIL CLOSED (cycle 11): the key may only become terminal when BOTH target
  // reads succeeded, BOTH report a live pane, and the pid identity matches.
  // An unreadable pre-target cannot prove the pane wasn't replaced (with the
  // pasted content lost), so it counts as lost.
  const targetLost =
    preTarget.dead ||
    preTarget.pid === '' ||
    postTarget.dead ||
    postTarget.pid !== preTarget.pid;

  if (terminalAfter !== '') {
    if (!targetLost) return; // Submitted to a proven-live pane — by this call or a concurrent completer.
    // The pane died, was replaced, or cannot be identified around the Enter:
    // tmux may have reported send-keys as successful while the input landed
    // nowhere, and even an accepted Enter is worthless once the receiving
    // harness is gone. ROLL THE KEY BACK as a VERIFIED protocol transition
    // (cycle 11): breadcrumb first so a failed rollback can never leave a
    // false terminal marker honorable, then rollback, then verify.
    await tmuxExecAsync(['set-option', '-t', sessionName, poisonOption, '1'], { encoding: 'utf-8' });
    const rollbackArgs = pendingBefore === ''
      ? ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-u', '-t', sessionName, pendingOption]
      : ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-t', sessionName, pendingOption, pendingBefore];
    await tmuxExecAsync(rollbackArgs, { encoding: 'utf-8' }).catch(() => {});
    const [rolledTerminal, restoredPending] = await Promise.all([
      readMarker(sessionName, terminalOption),
      readMarker(sessionName, pendingOption),
    ]);
    if (rolledTerminal === '' && restoredPending !== '') {
      // Verified — the breadcrumb is no longer needed.
      await tmuxExecAsync(['set-option', '-u', '-t', sessionName, poisonOption], { encoding: 'utf-8' }).catch(() => {});
    }
    throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
  }
  if (pendingAfter !== '') {
    // The condition rejected the submit. A dead/replaced/unprovable pane is
    // the recoverable case (the pending claim is preserved so recovery can
    // retry after resume); anything else is a definitive delivery failure.
    if (targetLost) throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
    throw new Error(`Keyed tmux submit for ${sessionName} was rejected with the pending claim intact on a live pane`);
  }
  throw new Error(`Keyed tmux submit for ${sessionName} found neither a pending claim nor a terminal marker — the paste vanished without submission`);
}
