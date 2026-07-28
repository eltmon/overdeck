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
 *   neither option is set. A replay that finds PENDING reuses it only when the
 *   payload is still visible on the recorded pane; otherwise it re-pastes and
 *   replaces the claim. A POISON breadcrumb (a terminal marker that proved false but could not be
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
import { capturePaneText, deliveryVerifyLine, tmuxExecAsync, validateSessionName } from './tmux.js';
import { MessageDeliveryFailed } from './errors.js';
import { paneHasBlockingChoiceMenu } from './pane-choice-menu.js';

export const DEDUP_KEY_RE = /^[A-Za-z0-9:_-]+$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

/**
 * The pane_pid of the pane that received the keyed paste (cycle 13). Set
 * atomically with the paste (`set-option -F ... '#{pane_pid}'`) and required
 * by the submit condition: recovery may complete an old pending claim with
 * Enter alone ONLY when the current pane IS the pane that holds the pasted
 * content. A replaced pane gets a real re-paste instead.
 */
export function dedupTargetOptionName(dedupKey: string): string {
  return `@overdeck-dedup-target-${dedupKey}`;
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

/**
 * The pane is blocked on a harness choice menu, so Enter was deliberately not
 * sent. Recoverable: the pending outbox entry must re-drive the same key, and
 * sendKeysDedup proves the payload is still visible before reusing any pending
 * claim; a swallowed paste is re-pasted instead.
 */
export class KeyedSubmitBlockedMenuError extends MessageDeliveryFailed {
  constructor(sessionName: string, dedupKey: string, paneSnapshot: string) {
    super(
      `Keyed submit to ${sessionName} aborted: the pane is blocked on a choice menu, so Enter would answer that menu (key "${dedupKey}")`,
      sessionName,
      paneSnapshot,
    );
    this.name = 'KeyedSubmitBlockedMenuError';
  }
}

export function isKeyedSubmitBlockedMenuError(error: unknown): error is KeyedSubmitBlockedMenuError {
  return error instanceof KeyedSubmitBlockedMenuError
    || (error instanceof Error && error.name === 'KeyedSubmitBlockedMenuError');
}

/**
 * A safety-critical marker read/verification failed (cycle 13) or a poison
 * breadcrumb could not be verifiably cleared (cycle 14) — the marker state
 * is UNPROVEN, neither delivered nor lost. Recoverable: the caller's
 * recovery retries; the poison breadcrumb (if set) stays authoritative in
 * the meantime and is never bypassed by a failed read or a failed clear.
 */
export class KeyedMarkerVerificationError extends Error {
  constructor(sessionName: string, context: string, options?: { cause?: unknown }) {
    const causeText = options?.cause instanceof Error ? `: ${options.cause.message}` : '';
    super(`Keyed tmux markers for ${sessionName} could not be verified (${context})${causeText}`, options);
    this.name = 'KeyedMarkerVerificationError';
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
 * Fail-CLOSED marker read (cycle 12): `-q` makes an unset user option a clean
 * empty read, so a rejection is always a REAL failure (missing session,
 * unreachable server). Safety-critical markers (the poison breadcrumb) must
 * be read this way — interpreting a failed read as "absent" could honor a
 * false terminal marker or bypass a rollback-required state.
 */
async function readMarkerStrict(sessionName: string, option: string): Promise<string> {
  const result = await tmuxExecAsync(['show-option', '-qv', '-t', sessionName, option], { encoding: 'utf-8' });
  return String(result.stdout).trim();
}

async function paneContainsDeliveryPayload(
  sessionName: string,
  keys: string,
  readPane: (sessionName: string, lines: number) => Promise<string>,
): Promise<boolean> {
  const verifyLine = deliveryVerifyLine(keys);
  if (verifyLine.length < 3) return false;
  const pane = await readPane(sessionName, 200).catch(() => '');
  return pane.includes(verifyLine.slice(0, 40));
}

/**
 * Clear the poison breadcrumb and VERIFY it is gone with a strict read.
 * EVERY failure here — the clear command, the verification read, or a
 * surviving breadcrumb — is a recoverable KeyedMarkerVerificationError
 * (cycle 14): a repair that stops at this boundary has delivered nothing,
 * so the wake outbox must stay pending, never terminal 'failed'.
 */
async function clearPoisonVerified(
  sessionName: string,
  poisonOption: string,
  context: string,
  readStrict: (sessionName: string, option: string) => Promise<string> = readMarkerStrict,
): Promise<void> {
  try {
    await tmuxExecAsync(['set-option', '-u', '-t', sessionName, poisonOption], { encoding: 'utf-8' });
  } catch (error) {
    throw new KeyedMarkerVerificationError(sessionName, `poison clear command failed (${context})`, { cause: error });
  }
  let remaining: string;
  try {
    remaining = await readStrict(sessionName, poisonOption);
  } catch (error) {
    throw new KeyedMarkerVerificationError(sessionName, `post-clear verification read failed (${context})`, { cause: error });
  }
  if (remaining !== '') {
    throw new KeyedMarkerVerificationError(sessionName, `poison breadcrumb survived the clear (${context})`);
  }
}

export interface KeyedTmuxDeps {
  /** Test seam for marker-read failures; production uses the real tmux reads. */
  readMarker?: (sessionName: string, option: string) => Promise<string>;
  readMarkerStrict?: (sessionName: string, option: string) => Promise<string>;
  /** Test seam for target-read failures; production uses the real tmux read. */
  readPaneTarget?: (sessionName: string) => Promise<PaneTarget>;
  /** Test seam for blocking-menu detection; production captures the real pane. */
  readPaneText?: (sessionName: string, lines: number) => Promise<string>;
  /** Test seam for recovery re-paste command failures. */
  runTmuxCommand?: (args: string[]) => Promise<void>;
}

/**
 * Repair a poisoned marker set (cycle 11/12): clear the terminal marker,
 * restore a pending claim, verify both, then clear the breadcrumb — verified.
 * A poisoned terminal is PROVISIONAL: it may be a false claim (rollback was
 * interrupted) or a delivered-but-unverified one, and the tmux tier cannot
 * distinguish them — so repair always rolls back to pending and lets the
 * normal recovery re-drive. An empty Enter on the (already-submitted, live)
 * composer is the worst case; a suppressed wake is never acceptable.
 *
 * Returns normally only when the breadcrumb is verifiably gone; throws
 * otherwise (the caller must NOT submit while a stale breadcrumb survives —
 * a later replay would invalidate a legitimate terminal and re-submit).
 */
async function repairPoisonedMarkers(
  sessionName: string,
  dedupKey: string,
  sendId: string,
  readStrict: (sessionName: string, option: string) => Promise<string>,
): Promise<void> {
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);
  const poisonOption = dedupPoisonOptionName(dedupKey);
  await tmuxExecAsync([
    'set-option', '-u', '-t', sessionName, terminalOption,
    ';',
    'set-option', '-t', sessionName, pendingOption, sendId,
  ], { encoding: 'utf-8' });
  let repairedTerminal: string;
  let repairedPending: string;
  try {
    // STRICT reads (cycle 13): a failed verification read must abort while
    // the breadcrumb stays authoritative — never convert it to empty state.
    [repairedTerminal, repairedPending] = await Promise.all([
      readStrict(sessionName, terminalOption),
      readStrict(sessionName, pendingOption),
    ]);
  } catch {
    throw new KeyedMarkerVerificationError(sessionName, `repair verification of key "${dedupKey}"`);
  }
  if (repairedTerminal !== '' || repairedPending === '') {
    throw new Error(`Keyed tmux markers for ${sessionName} are poisoned and could not be repaired (key "${dedupKey}")`);
  }
  await clearPoisonVerified(sessionName, poisonOption, `repair of key "${dedupKey}"`, readStrict);
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
  deps: KeyedTmuxDeps = {},
): Promise<KeyedTmuxPhase> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const read = deps.readMarker ?? readMarker;
  const readStrict = deps.readMarkerStrict ?? readMarkerStrict;
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);
  const poisonOption = dedupPoisonOptionName(dedupKey);

  const sendId = randomUUID();

  // The poison breadcrumb invalidates any terminal marker (cycle 11/12): it
  // marks either a FALSE terminal whose rollback was interrupted or a
  // PROVISIONAL terminal whose post-submit verification never completed. The
  // read is fail-CLOSED — and a REJECTED read is unproven protocol state, so
  // it becomes the recoverable marker-error class (cycle 15): a transient
  // failure before any side effect must never close the wake as terminal
  // 'failed'. (A genuinely missing target is classified upstream at the
  // messageAgent stopped/zombie layer, which resumes and re-delivers.)
  let poisonMarker: string;
  try {
    poisonMarker = await readStrict(sessionName, poisonOption);
  } catch (error) {
    throw new KeyedMarkerVerificationError(sessionName, `initial poison read (key "${dedupKey}")`, { cause: error });
  }
  // A repaired pending claim still has to prove its pane identity below —
  // the original paste's target may be stale or missing (cycle 13).
  const repaired = poisonMarker !== '';
  if (repaired) {
    await repairPoisonedMarkers(sessionName, dedupKey, sendId, readStrict);
  }

  const targetOption = dedupTargetOptionName(dedupKey);
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  const bufferName = `pan-${sendId}`;

  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });

    if (!repaired) {
      // One server-side command: paste only when NEITHER marker is set, and
      // record OUR sendId in the pending option AND the receiving pane's pid
      // in the target option in the same breath (cycle 13 — the target
      // identity is what lets recovery decide whether the pasted content is
      // still there).
      await tmuxExecAsync([
        'if-shell', '-t', sessionName,
        `test -z "$(tmux show-option -qv -t ${sessionName} ${pendingOption})" && test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})"`,
        `paste-buffer -b ${bufferName} -p -t ${sessionName} \; set-option -t ${sessionName} ${pendingOption} ${sendId} \; set-option -F -t ${sessionName} ${targetOption} '#{pane_pid}'`,
      ], { encoding: 'utf-8' });
    }

    const [pendingMarker, terminalMarker] = await Promise.all([
      read(sessionName, pendingOption),
      read(sessionName, terminalOption),
    ]);

    if (terminalMarker !== '') return 'deduplicated';
    if (!repaired && pendingMarker === sendId) return 'pasted';
    if (pendingMarker !== '') {
      // A pending claim is reusable only when BOTH the pane identity and the
      // payload are still present. A blocking menu can swallow a paste without
      // replacing the pane, so PID equality alone cannot authorize Enter.
      const recordedTarget = await read(sessionName, targetOption);
      const currentPid = (await (deps.readPaneTarget ?? readPaneTarget)(sessionName)).pid;
      const readPane = deps.readPaneText ?? capturePaneText;
      if (
        recordedTarget !== ''
        && currentPid !== ''
        && recordedTarget === currentPid
        && await paneContainsDeliveryPayload(sessionName, keys, readPane)
      ) {
        return 'submit-pending';
      }

      // Re-paste atomically only while the exact claim we inspected is still
      // pending and no terminal marker exists. If this command fails, recovery
      // retries the same key; it can never reuse the stale claim without again
      // proving the payload is visible.
      const repasteArgs = [
        'if-shell', '-t', sessionName,
        `test "$(tmux show-option -qv -t ${sessionName} ${pendingOption})" = ${shellQuote(pendingMarker)} && ` +
        `test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})"`,
        `paste-buffer -b ${bufferName} -p -t ${sessionName} \; set-option -t ${sessionName} ${pendingOption} ${sendId} \; set-option -F -t ${sessionName} ${targetOption} '#{pane_pid}'`,
      ];
      try {
        if (deps.runTmuxCommand) {
          await deps.runTmuxCommand(repasteArgs);
        } else {
          await tmuxExecAsync(repasteArgs, { encoding: 'utf-8' });
        }
      } catch (error) {
        throw new KeyedMarkerVerificationError(sessionName, `pending payload re-paste command (key "${dedupKey}")`, { cause: error });
      }

      const [repastedPending, repastedTerminal, repastedTarget] = await Promise.all([
        read(sessionName, pendingOption),
        read(sessionName, terminalOption),
        read(sessionName, targetOption),
      ]);
      if (repastedTerminal !== '') return 'deduplicated';
      if (repastedPending === sendId) return 'pasted';
      if (repastedPending !== '') {
        // A concurrent attempt owns the claim; honor it only if its target and
        // payload both match the current pane.
        const nowPid = (await (deps.readPaneTarget ?? readPaneTarget)(sessionName)).pid;
        if (
          repastedTarget !== ''
          && nowPid !== ''
          && repastedTarget === nowPid
          && await paneContainsDeliveryPayload(sessionName, keys, readPane)
        ) {
          return 'submit-pending';
        }
      }
    }
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
 * the Enter FIRST and then sets the POISON breadcrumb and the TERMINAL
 * marker and clears pending — the terminal is PROVISIONAL from the moment it
 * exists, so a dashboard crash can never strand an honorable-but-unverified
 * terminal (cycle 12). The tmux server executes the whole sequence:
 *
 * - A pane that died during the settle window fails the liveness condition —
 *   NO marker changes and NO Enter is sent, so the wake is never recorded as
 *   delivered when it never landed. The preserved pending claim lets
 *   recovery retry after the agent resumes.
 * - The pre-branch liveness condition is NOT proof of acceptance (cycle 10):
 *   the pane can die in the shell-to-branch handoff, and tmux reports
 *   send-keys into a remain-on-exit corpse as success. So after the command
 *   the target is re-read — if the pane died, was replaced, or cannot be
 *   identified around the Enter, the terminal marker is ROLLED BACK and the
 *   pending claim restored, and KeyedSubmitTargetDeadError is thrown. The
 *   breadcrumb is lifted only after verification, and clearing it is itself
 *   verified (cycle 12): a stale breadcrumb would let a later replay
 *   invalidate a legitimate terminal and re-submit.
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
export async function completeKeyedSubmit(
  sessionName: string,
  dedupKey: string,
  deps: KeyedTmuxDeps = {},
): Promise<void> {
  validateSessionName(sessionName);
  assertValidDedupKey(dedupKey);
  const read = deps.readMarker ?? readMarker;
  const readStrict = deps.readMarkerStrict ?? readMarkerStrict;
  const readTarget = deps.readPaneTarget ?? readPaneTarget;
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const pendingOption = dedupPendingOptionName(dedupKey);
  const poisonOption = dedupPoisonOptionName(dedupKey);
  const targetOption = dedupTargetOptionName(dedupKey);

  await new Promise(resolve => setTimeout(resolve, PASTE_SETTLE_MS));

  // Snapshot the Enter target's identity BEFORE the submit. The if-shell's
  // pre-branch liveness condition is only an optimization: the pane can die
  // in the shell-to-branch handoff, and tmux reports send-keys into a
  // remain-on-exit corpse as SUCCESS. What proves acceptance is the
  // post-submit check below (cycle 10).
  const preTarget = await readTarget(sessionName);
  const pendingBefore = await read(sessionName, pendingOption);

  if (pendingBefore !== '') {
    const paneSnapshot = await (deps.readPaneText ?? capturePaneText)(sessionName, 90).catch(() => '');
    if (paneSnapshot && paneHasBlockingChoiceMenu(paneSnapshot)) {
      throw new KeyedSubmitBlockedMenuError(sessionName, dedupKey, paneSnapshot);
    }
  }

  // PROVISIONAL from birth (cycle 12): the Enter, the POISON breadcrumb, the
  // TERMINAL marker, and the pending clear are ONE server-owned command list,
  // so a dashboard crash anywhere after this command leaves poison+terminal
  // together — recovery can never find an honorable-but-unverified terminal.
  // The condition also requires the current pane to BE the pane that received
  // the paste (cycle 13): a replaced pane has an empty composer, so Enter
  // alone would be a blank submission.
  await tmuxExecAsync([
    'if-shell', '-t', sessionName,
    `test -z "$(tmux show-option -qv -t ${sessionName} ${terminalOption})" && ` +
    `test -n "$(tmux show-option -qv -t ${sessionName} ${pendingOption})" && ` +
    `test "$(tmux display-message -p -t ${sessionName} '#{pane_dead}')" = "0" && ` +
    `test "$(tmux display-message -p -t ${sessionName} '#{pane_pid}')" = "$(tmux show-option -qv -t ${sessionName} ${targetOption})"`,
    `send-keys -t ${sessionName} C-m \; set-option -t ${sessionName} ${poisonOption} 1 \; set-option -t ${sessionName} ${terminalOption} 1 \; set-option -u -t ${sessionName} ${pendingOption}`,
  ], { encoding: 'utf-8' });

  const [terminalAfter, pendingAfter, postTarget, recordedTarget] = await Promise.all([
    read(sessionName, terminalOption),
    read(sessionName, pendingOption),
    readTarget(sessionName),
    read(sessionName, targetOption),
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
    if (!targetLost) {
      // Verified delivery — lift the provisional breadcrumb, fail-closed
      // (cycle 12/13): a stale breadcrumb would let a later replay
      // invalidate this legitimate terminal and re-submit.
      await clearPoisonVerified(sessionName, poisonOption, `verified delivery of key "${dedupKey}"`, readStrict);
      return;
    }
    // The pane died, was replaced, or cannot be identified around the Enter:
    // tmux may have reported send-keys as successful while the input landed
    // nowhere, and even an accepted Enter is worthless once the receiving
    // harness is gone. ROLL THE KEY BACK and verify with STRICT reads (cycle
    // 13): the breadcrumb set by the submit list already marks the terminal
    // provisional, so a failed rollback can never leave it honorable.
    const rollbackArgs = pendingBefore === ''
      ? ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-u', '-t', sessionName, pendingOption]
      : ['set-option', '-u', '-t', sessionName, terminalOption, ';', 'set-option', '-t', sessionName, pendingOption, pendingBefore];
    await tmuxExecAsync(rollbackArgs, { encoding: 'utf-8' }).catch(() => {});
    let rolledTerminal: string;
    let restoredPending: string;
    try {
      [rolledTerminal, restoredPending] = await Promise.all([
        readStrict(sessionName, terminalOption),
        readStrict(sessionName, pendingOption),
      ]);
    } catch {
      // Verification read failed — rollback state unproven; the breadcrumb
      // stays authoritative and recovery retries.
      throw new KeyedMarkerVerificationError(sessionName, `rollback verification of key "${dedupKey}"`);
    }
    if (rolledTerminal === '' && restoredPending !== '') {
      // Verified rollback — lift the breadcrumb. If the clear fails the
      // surviving poison is idempotent-safe here (terminal is already clear,
      // so a later repair restores the same pending state and retries).
      await clearPoisonVerified(sessionName, poisonOption, `verified rollback of key "${dedupKey}"`, readStrict)
        .catch(() => {});
    }
    throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
  }
  if (pendingAfter !== '') {
    // The condition rejected the submit. A dead/replaced/unprovable pane is
    // the recoverable case: a pane whose pid no longer matches the recorded
    // paste target has an empty composer (cycle 13) — recovery must re-paste
    // the real content, which phase 1's target-mismatch path does.
    const replaced = recordedTarget === '' || postTarget.pid === '' || recordedTarget !== postTarget.pid;
    if (targetLost || replaced) throw new KeyedSubmitTargetDeadError(sessionName, dedupKey);
    throw new Error(`Keyed tmux submit for ${sessionName} was rejected with the pending claim intact on a live pane`);
  }
  throw new Error(`Keyed tmux submit for ${sessionName} found neither a pending claim nor a terminal marker — the paste vanished without submission`);
}
