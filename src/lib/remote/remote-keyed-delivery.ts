/**
 * Keyed remote delivery (PAN-2997). The REMOTE tmux server is the
 * crash-independent component for a remote session: it survives both the
 * local dashboard and the remote agent shell, so the same two-phase
 * pending/terminal marker protocol as the local tmux tier
 * (src/lib/tmux-dedup.ts) enforces the dedup key across the complete
 * paste-settle-submit transaction — paste under an atomic pending claim, a
 * liveness-gated Enter-first submit, post-submit target verification with a
 * verified rollback under a poison breadcrumb. A local dashboard crash
 * anywhere in the sequence replays into either a completed pending
 * submission (no second paste) or a terminal-marker dedup — never a lost or
 * duplicated wake.
 */

import { randomUUID } from 'node:crypto';
import {
  assertValidDedupKey,
  dedupPendingOptionName,
  dedupPoisonOptionName,
  dedupTargetOptionName,
  dedupTerminalOptionName,
  KeyedMarkerVerificationError,
  KeyedSubmitTargetDeadError,
} from '../tmux-dedup.js';
import { createFlyProvider } from './fly-provider.js';
import {
  buildRemoteTmuxCommand,
  ensureRemoteTmuxContext,
  getRemoteTmuxBaseArgs,
  REMOTE_PAN_DIR,
  runSsh,
  shellQuote,
} from './remote-tmux.js';
import type { RemoteTmuxTarget } from './remote-tmux.js';

export type RemoteKeyedDeliveryOutcome = 'delivered' | 'deduplicated';

/** Injectable command runner for tests — resolves with the command's stdout. */
export type RemoteKeyedExec = (command: string) => Promise<string>;

/**
 * Keyed delivery into `target` (PAN-4734: a linked work agent's `conv-<name>`
 * session on the VM's `overdeck` socket; legacy: the agent id on home's
 * socket). `agentId` names the prompt file and every error.
 */
export async function deliverRemoteKeyed(
  agentId: string,
  target: RemoteTmuxTarget,
  vmName: string,
  message: string,
  dedupKey: string,
  exec?: RemoteKeyedExec,
): Promise<RemoteKeyedDeliveryOutcome> {
  assertValidDedupKey(dedupKey);
  const { session, socket } = target;
  const tmuxCommand = (args: string[]): string => buildRemoteTmuxCommand(args, socket);

  let run: RemoteKeyedExec;
  if (exec) {
    run = exec;
  } else {
    const fly = createFlyProvider();
    await ensureRemoteTmuxContext(fly, vmName);
    // Every protocol command must fail loudly (cycle 8): a non-zero exit on
    // a write, buffer load, marker transition, or the Enter-submit must never
    // be acknowledged as delivery. The marker READS are the only tolerant
    // calls — an unset user option is a legitimate empty state, and a failed
    // read collapses into the loud "did not land" path rather than a false
    // success.
    run = async (command: string) => {
      const result = await runSsh(fly, vmName, command);
      if (result.exitCode !== 0) {
        throw new Error(
          `remote keyed-delivery command failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`,
        );
      }
      return result.stdout;
    };
  }

  const pendingOption = dedupPendingOptionName(dedupKey);
  const terminalOption = dedupTerminalOptionName(dedupKey);
  const poisonOption = dedupPoisonOptionName(dedupKey);
  const sendId = randomUUID();
  const bufferName = `pan-keyed-${sendId}`;
  const promptFile = `${REMOTE_PAN_DIR}/prompts/${agentId}-keyed-${sendId}.txt`;
  // Inner marker reads must target the managed remote server explicitly —
  // the if-shell condition cannot rely on a TMUX env the remote server may
  // not have inherited.
  const innerTmux = ['tmux', ...getRemoteTmuxBaseArgs(socket)].map(shellQuote).join(' ');

  const cleanup = async (): Promise<void> => {
    await run(tmuxCommand(['delete-buffer', '-b', bufferName])).catch(() => '');
    await run(`rm -f ${shellQuote(promptFile)}`).catch(() => '');
  };

  const readMarker = async (option: string): Promise<string> =>
    run(tmuxCommand(['show-option', '-qv', '-t', session, option]))
      .then(stdout => stdout.trim(), () => '');

  // Fail-CLOSED marker read (cycle 12/13): `-q` makes an unset user option a
  // clean empty read, so a rejection is always a REAL failure. Safety-critical
  // markers (the poison breadcrumb, every verification read) must be read
  // this way — interpreting a failed read as "absent" could honor a false
  // terminal marker or bypass a rollback-required state.
  const readMarkerStrict = async (option: string): Promise<string> =>
    run(tmuxCommand(['show-option', '-qv', '-t', session, option]))
      .then(stdout => stdout.trim());

  // Clear the poison breadcrumb and VERIFY it is gone with a strict read.
  // EVERY failure here — the clear command, the verification read, or a
  // surviving breadcrumb — is a recoverable KeyedMarkerVerificationError
  // (cycle 14): a repair that stops at this boundary has delivered nothing,
  // so the wake outbox must stay pending, never terminal 'failed'.
  const clearPoisonVerified = async (context: string): Promise<void> => {
    try {
      await run(tmuxCommand(['set-option', '-u', '-t', session, poisonOption]));
    } catch (error) {
      throw new KeyedMarkerVerificationError(agentId, `poison clear command failed (${context})`, { cause: error });
    }
    let remaining: string;
    try {
      remaining = await readMarkerStrict(poisonOption);
    } catch (error) {
      throw new KeyedMarkerVerificationError(agentId, `post-clear verification read failed (${context})`, { cause: error });
    }
    if (remaining !== '') {
      throw new KeyedMarkerVerificationError(agentId, `poison breadcrumb survived the clear (${context})`);
    }
  };

  const readPaneTarget = async (): Promise<{ pid: string; dead: boolean }> =>
    run(tmuxCommand(['display-message', '-p', '-t', session, '#{pane_pid} #{pane_dead}']))
      .then(stdout => {
        const [pid = '', dead = ''] = stdout.trim().split(/\s+/);
        return { pid, dead: dead === '1' };
      })
      .catch(() => ({ pid: '', dead: true }));

  try {
    // The poison breadcrumb invalidates any terminal marker (cycle 11/12):
    // it marks either a FALSE terminal whose rollback was interrupted or a
    // PROVISIONAL terminal whose post-submit verification never completed.
    // The read is fail-CLOSED — and a REJECTED read is unproven protocol
    // state, so it becomes the recoverable marker-error class (cycle 15): a
    // transient failure before any side effect must never close the wake as
    // terminal 'failed'.
    let poisonMarker: string;
    try {
      poisonMarker = await readMarkerStrict(poisonOption);
    } catch (error) {
      throw new KeyedMarkerVerificationError(agentId, `initial poison read (key "${dedupKey}")`, { cause: error });
    }
    // A repaired pending claim still has to prove its pane identity below —
    // the original paste's target may be stale or missing (cycle 13).
    const repaired = poisonMarker !== '';
    if (repaired) {
      // Repair (cycle 12): a poisoned terminal may be false or
      // delivered-but-unverified, and the tmux tier cannot distinguish —
      // always roll back to pending and let normal recovery re-drive. STRICT
      // verification reads (cycle 13): a failed read aborts with the
      // breadcrumb authoritative, never converted to empty state.
      await run(tmuxCommand([
        'set-option', '-u', '-t', session, terminalOption,
        ';',
        'set-option', '-t', session, pendingOption, sendId,
      ]));
      let repairedTerminal: string;
      let repairedPending: string;
      try {
        [repairedTerminal, repairedPending] = await Promise.all([
          readMarkerStrict(terminalOption),
          readMarkerStrict(pendingOption),
        ]);
      } catch {
        throw new KeyedMarkerVerificationError(agentId, `repair verification of key "${dedupKey}"`);
      }
      if (repairedTerminal !== '' || repairedPending === '') {
        throw new Error(`Keyed remote markers for ${agentId} are poisoned and could not be repaired (key "${dedupKey}")`);
      }
      await clearPoisonVerified(`repair of key "${dedupKey}"`);
    }

    const targetOption = dedupTargetOptionName(dedupKey);
    // The buffer is needed for a fresh paste AND for a re-paste after a
    // repair or a target mismatch.
    const messageBase64 = Buffer.from(message).toString('base64');
    await run(
      `mkdir -p ${shellQuote(`${REMOTE_PAN_DIR}/prompts`)} && echo ${shellQuote(messageBase64)} | base64 -d > ${shellQuote(promptFile)}`,
    );
    await run(tmuxCommand(['load-buffer', '-b', bufferName, promptFile]));

    let pendingMarker: string;
    if (repaired) {
      pendingMarker = sendId;
    } else {
      // One server-side command: paste only when NEITHER marker is set, and
      // record OUR sendId in the pending option AND the receiving pane's pid
      // in the target option in the same breath (cycle 13).
      const condition =
        `test -z "$(${innerTmux} show-option -qv -t ${session} ${pendingOption})" && ` +
        `test -z "$(${innerTmux} show-option -qv -t ${session} ${terminalOption})"`;
      const onTrue =
        `paste-buffer -b ${bufferName} -p -t ${session} \; ` +
        `set-option -t ${session} ${pendingOption} ${sendId} \; ` +
        `set-option -F -t ${session} ${targetOption} '#{pane_pid}'`;
      await run(tmuxCommand(['if-shell', '-t', session, condition, onTrue]));

      const terminalMarker = await readMarker(terminalOption);
      pendingMarker = await readMarker(pendingOption);
      if (terminalMarker !== '') return 'deduplicated';
      if (pendingMarker === '') {
        throw new Error(`Keyed remote paste for ${agentId} did not land and no dedup marker was recorded`);
      }
    }

    // A pending claim (fresh, prior, or repaired) is only completable with
    // Enter alone when the current pane IS the pane that received the paste
    // (cycle 13): a replaced pane has an empty composer, so Enter alone
    // would be a blank submission. Re-paste the real content instead.
    const recordedTarget = await readMarker(targetOption);
    const currentPid = (await readPaneTarget()).pid;
    if (!(recordedTarget !== '' && currentPid !== '' && recordedTarget === currentPid)) {
      // One server-side command: re-paste only when the pending claim still
      // stands, no terminal exists, and the recorded target does NOT match
      // the current pane — and record the NEW target in the same breath.
      const repasteCondition =
        `test -n "$(${innerTmux} show-option -qv -t ${session} ${pendingOption})" && ` +
        `test -z "$(${innerTmux} show-option -qv -t ${session} ${terminalOption})" && ` +
        `! test "$(${innerTmux} display-message -p -t ${session} '#{pane_pid}')" = "$(${innerTmux} show-option -qv -t ${session} ${targetOption})"`;
      const repasteOnTrue =
        `paste-buffer -b ${bufferName} -p -t ${session} \; ` +
        `set-option -t ${session} ${pendingOption} ${sendId} \; ` +
        `set-option -F -t ${session} ${targetOption} '#{pane_pid}'`;
      await run(tmuxCommand(['if-shell', '-t', session, repasteCondition, repasteOnTrue]));
      const [repastedPending, repastedTerminal] = await Promise.all([
        readMarker(pendingOption),
        readMarker(terminalOption),
      ]);
      if (repastedTerminal !== '') return 'deduplicated';
      if (repastedPending === '') {
        throw new Error(`Keyed remote paste for ${agentId} did not land and no dedup marker was recorded`);
      }
      pendingMarker = repastedPending;
    }

    // The SUBMISSION is one server-owned command: a single if-shell whose
    // condition requires the pending claim, no terminal marker, a LIVE pane,
    // AND the current pane matching the recorded paste target (cycle 13).
    // The pre-branch liveness check is only an optimization (cycle 10): the
    // pane can die in the shell-to-branch handoff and remote tmux reports
    // send-keys into a corpse as success, so acceptance is proven by the
    // post-submit target re-read below.
    const preTarget = await readPaneTarget();
    const pendingBefore = pendingMarker;
    await new Promise(resolve => setTimeout(resolve, 300));
    // PROVISIONAL from birth (cycle 12): the Enter, the POISON breadcrumb,
    // the TERMINAL marker, and the pending clear are ONE server-owned command
    // list, so a dashboard crash anywhere after this command leaves
    // poison+terminal together — recovery can never find an
    // honorable-but-unverified terminal.
    const submitCondition =
      `test -z "$(${innerTmux} show-option -qv -t ${session} ${terminalOption})" && ` +
      `test -n "$(${innerTmux} show-option -qv -t ${session} ${pendingOption})" && ` +
      `test "$(${innerTmux} display-message -p -t ${session} '#{pane_dead}')" = "0" && ` +
      `test "$(${innerTmux} display-message -p -t ${session} '#{pane_pid}')" = "$(${innerTmux} show-option -qv -t ${session} ${targetOption})"`;
    const submitOnTrue =
      `send-keys -t ${session} C-m \; ` +
      `set-option -t ${session} ${poisonOption} 1 \; ` +
      `set-option -t ${session} ${terminalOption} 1 \; ` +
      `set-option -u -t ${session} ${pendingOption}`;
    await run(tmuxCommand(['if-shell', '-t', session, submitCondition, submitOnTrue]));

    const [terminalAfter, pendingAfter, postTarget, recordedTargetAfter] = await Promise.all([
      readMarker(terminalOption),
      readMarker(pendingOption),
      readPaneTarget(),
      readMarker(targetOption),
    ]);
    // FAIL CLOSED (cycle 11): the key may only become terminal when BOTH
    // target reads succeeded, BOTH report a live pane, and the pid identity
    // matches. An unreadable pre-target cannot prove the pane wasn't
    // replaced (with the pasted content lost), so it counts as lost.
    const targetLost =
      preTarget.dead ||
      preTarget.pid === '' ||
      postTarget.dead ||
      postTarget.pid !== preTarget.pid;

    if (terminalAfter === '' && pendingAfter === '') {
      throw new Error(`Keyed remote submit for ${agentId} found neither a pending claim nor a terminal marker — the paste vanished without submission`);
    }
    if (terminalAfter === '' && (targetLost || recordedTargetAfter === '' || recordedTargetAfter !== postTarget.pid)) {
      // The condition rejected the submit: a dead/replaced/unprovable pane
      // is the recoverable case — recovery re-pastes the real content via
      // the target-mismatch path above.
      throw new KeyedSubmitTargetDeadError(agentId, dedupKey);
    }
    if (targetLost) {
      // The pane died, was replaced, or cannot be identified around the
      // Enter: acceptance is unprovable and the receiving harness is gone.
      // ROLL THE KEY BACK and verify with STRICT reads (cycle 13): the
      // breadcrumb set by the submit list already marks the terminal
      // provisional, so a failed rollback can never leave it honorable.
      if (terminalAfter !== '') {
        const rollbackArgs = pendingBefore === ''
          ? ['set-option', '-u', '-t', session, terminalOption, ';', 'set-option', '-u', '-t', session, pendingOption]
          : ['set-option', '-u', '-t', session, terminalOption, ';', 'set-option', '-t', session, pendingOption, pendingBefore];
        await run(tmuxCommand(rollbackArgs)).catch(() => '');
        let rolledTerminal: string;
        let restoredPending: string;
        try {
          [rolledTerminal, restoredPending] = await Promise.all([
            readMarkerStrict(terminalOption),
            readMarkerStrict(pendingOption),
          ]);
        } catch {
          throw new KeyedMarkerVerificationError(agentId, `rollback verification of key "${dedupKey}"`);
        }
        if (rolledTerminal === '' && restoredPending !== '') {
          // Verified rollback — lift the breadcrumb. A failed clear is
          // idempotent-safe here (terminal is already clear).
          await clearPoisonVerified(`verified rollback of key "${dedupKey}"`).catch(() => '');
        }
      }
      throw new KeyedSubmitTargetDeadError(agentId, dedupKey);
    }
    if (terminalAfter === '') {
      throw new Error(`Keyed remote submit for ${agentId} was rejected with the pending claim intact on a live pane`);
    }
    // Verified delivery — lift the provisional breadcrumb, fail-closed
    // (cycle 12): a stale breadcrumb would let a later replay invalidate
    // this legitimate terminal and re-submit.
    await clearPoisonVerified(`verified delivery of key "${dedupKey}"`);
    return 'delivered';
  } finally {
    await cleanup();
  }
}
