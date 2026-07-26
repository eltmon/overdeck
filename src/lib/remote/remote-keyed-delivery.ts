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
  dedupTerminalOptionName,
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

export type RemoteKeyedDeliveryOutcome = 'delivered' | 'deduplicated';

/** Injectable command runner for tests — resolves with the command's stdout. */
export type RemoteKeyedExec = (command: string) => Promise<string>;

export async function sendToRemoteAgentKeyed(
  agentId: string,
  vmName: string,
  message: string,
  dedupKey: string,
  exec?: RemoteKeyedExec,
): Promise<RemoteKeyedDeliveryOutcome> {
  assertValidDedupKey(dedupKey);

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
  const innerTmux = ['tmux', ...getRemoteTmuxBaseArgs()].map(shellQuote).join(' ');

  const cleanup = async (): Promise<void> => {
    await run(buildRemoteTmuxCommand(['delete-buffer', '-b', bufferName])).catch(() => '');
    await run(`rm -f ${shellQuote(promptFile)}`).catch(() => '');
  };

  const readMarker = async (option: string): Promise<string> =>
    run(buildRemoteTmuxCommand(['show-option', '-qv', '-t', agentId, option]))
      .then(stdout => stdout.trim(), () => '');

  // Fail-CLOSED marker read (cycle 12): `-q` makes an unset user option a
  // clean empty read, so a rejection is always a REAL failure. The poison
  // breadcrumb must be read this way — interpreting a failed read as
  // "absent" could honor a false terminal marker.
  const readMarkerStrict = async (option: string): Promise<string> =>
    run(buildRemoteTmuxCommand(['show-option', '-qv', '-t', agentId, option]))
      .then(stdout => stdout.trim());

  // Clear the poison breadcrumb and VERIFY it is gone (cycle 12).
  const clearPoisonVerified = async (context: string): Promise<void> => {
    await run(buildRemoteTmuxCommand(['set-option', '-u', '-t', agentId, poisonOption]));
    const remaining = await readMarker(poisonOption);
    if (remaining !== '') {
      throw new Error(`Keyed remote markers for ${agentId}: poison breadcrumb could not be cleared (${context})`);
    }
  };

  try {
    // The poison breadcrumb invalidates any terminal marker (cycle 11/12):
    // it marks either a FALSE terminal whose rollback was interrupted or a
    // PROVISIONAL terminal whose post-submit verification never completed.
    // The read is fail-CLOSED — a failed poison read must never be
    // interpreted as "no poison" while a false terminal sits next to it.
    const poisonMarker = await readMarkerStrict(poisonOption);
    let skipPaste = false;
    if (poisonMarker !== '') {
      // Repair (cycle 12): a poisoned terminal may be false or
      // delivered-but-unverified, and the tmux tier cannot distinguish —
      // always roll back to pending and let normal recovery re-drive. The
      // breadcrumb must be verifiably gone before any submission.
      await run(buildRemoteTmuxCommand([
        'set-option', '-u', '-t', agentId, terminalOption,
        ';',
        'set-option', '-t', agentId, pendingOption, sendId,
      ]));
      const [repairedTerminal, repairedPending] = await Promise.all([
        readMarker(terminalOption),
        readMarker(pendingOption),
      ]);
      if (repairedTerminal !== '' || repairedPending === '') {
        throw new Error(`Keyed remote markers for ${agentId} are poisoned and could not be repaired (key "${dedupKey}")`);
      }
      await clearPoisonVerified(`repair of key "${dedupKey}"`);
      skipPaste = true;
    }

    let pendingMarker: string;
    if (skipPaste) {
      pendingMarker = sendId;
    } else {
      const messageBase64 = Buffer.from(message).toString('base64');
      await run(
        `mkdir -p ${shellQuote(`${REMOTE_PAN_DIR}/prompts`)} && echo ${shellQuote(messageBase64)} | base64 -d > ${shellQuote(promptFile)}`,
      );
      await run(buildRemoteTmuxCommand(['load-buffer', '-b', bufferName, promptFile]));

      // One server-side command: paste only when NEITHER marker is set, and
      // record OUR sendId in the pending option in the same breath.
      const condition =
        `test -z "$(${innerTmux} show-option -qv -t ${agentId} ${pendingOption})" && ` +
        `test -z "$(${innerTmux} show-option -qv -t ${agentId} ${terminalOption})"`;
      const onTrue = `paste-buffer -b ${bufferName} -p -t ${agentId} \; set-option -t ${agentId} ${pendingOption} ${sendId}`;
      await run(buildRemoteTmuxCommand(['if-shell', '-t', agentId, condition, onTrue]));

      const terminalMarker = await readMarker(terminalOption);
      pendingMarker = await readMarker(pendingOption);
      if (terminalMarker !== '') return 'deduplicated';
      if (pendingMarker === '') {
        throw new Error(`Keyed remote paste for ${agentId} did not land and no dedup marker was recorded`);
      }
    }

    // 'pasted' (our sendId) and 'submit-pending' (a prior crashed attempt's
    // sendId) both complete the same transaction WITHOUT re-pasting. The
    // SUBMISSION is one server-owned command: a single if-shell whose
    // condition requires the pending claim, no terminal marker, AND a LIVE
    // pane, and whose command list sends the Enter FIRST and only then flips
    // terminal and clears pending. The pre-branch liveness check is only an
    // optimization (cycle 10): the pane can die in the shell-to-branch
    // handoff and remote tmux reports send-keys into a corpse as success, so
    // acceptance is proven by the post-submit target re-read below.
    const readPaneTarget = async (): Promise<{ pid: string; dead: boolean }> =>
      run(buildRemoteTmuxCommand(['display-message', '-p', '-t', agentId, '#{pane_pid} #{pane_dead}']))
        .then(stdout => {
          const [pid = '', dead = ''] = stdout.trim().split(/\s+/);
          return { pid, dead: dead === '1' };
        })
        .catch(() => ({ pid: '', dead: true }));

    const preTarget = await readPaneTarget();
    const pendingBefore = pendingMarker;
    await new Promise(resolve => setTimeout(resolve, 300));
    // PROVISIONAL from birth (cycle 12): the Enter, the POISON breadcrumb,
    // the TERMINAL marker, and the pending clear are ONE server-owned command
    // list, so a dashboard crash anywhere after this command leaves
    // poison+terminal together — recovery can never find an
    // honorable-but-unverified terminal.
    const submitCondition =
      `test -z "$(${innerTmux} show-option -qv -t ${agentId} ${terminalOption})" && ` +
      `test -n "$(${innerTmux} show-option -qv -t ${agentId} ${pendingOption})" && ` +
      `test "$(${innerTmux} display-message -p -t ${agentId} '#{pane_dead}')" = "0"`;
    const submitOnTrue =
      `send-keys -t ${agentId} C-m \; ` +
      `set-option -t ${agentId} ${poisonOption} 1 \; ` +
      `set-option -t ${agentId} ${terminalOption} 1 \; ` +
      `set-option -u -t ${agentId} ${pendingOption}`;
    await run(buildRemoteTmuxCommand(['if-shell', '-t', agentId, submitCondition, submitOnTrue]));

    const [terminalAfter, pendingAfter, postTarget] = await Promise.all([
      readMarker(terminalOption),
      readMarker(pendingOption),
      readPaneTarget(),
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
    if (targetLost) {
      // The pane died, was replaced, or cannot be identified around the
      // Enter: acceptance is unprovable and the receiving harness is gone.
      // ROLL THE KEY BACK and verify; the breadcrumb set by the submit list
      // already marks the terminal provisional, so a failed rollback can
      // never leave it honorable.
      if (terminalAfter !== '') {
        const rollbackArgs = pendingBefore === ''
          ? ['set-option', '-u', '-t', agentId, terminalOption, ';', 'set-option', '-u', '-t', agentId, pendingOption]
          : ['set-option', '-u', '-t', agentId, terminalOption, ';', 'set-option', '-t', agentId, pendingOption, pendingBefore];
        await run(buildRemoteTmuxCommand(rollbackArgs)).catch(() => '');
        const [rolledTerminal, restoredPending] = await Promise.all([
          readMarker(terminalOption),
          readMarker(pendingOption),
        ]);
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
