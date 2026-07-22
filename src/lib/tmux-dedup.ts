/**
 * Keyed, crash-safe tmux delivery (PAN-2997).
 *
 * The dashboard cannot dedupe a tmux paste from its own state — a crash
 * between the paste and the dashboard's acknowledgment bookkeeping would make
 * recovery re-paste. The dedup record therefore lives in the
 * crash-independent component: a per-session tmux user option. The check,
 * the paste, and the option set are issued as ONE `if-shell` command list,
 * which the tmux SERVER executes — a dashboard exit cannot interrupt it, and
 * a tmux-server exit kills the agent session itself, so a replay after
 * either crash is correct.
 */

import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { tmuxExecAsync, validateSessionName } from './tmux.js';

const DEDUP_KEY_RE = /^[A-Za-z0-9:_-]+$/;

/** Standalone Enter keystroke (no paste), used to submit after a dedup-checked paste. */
export async function sendEnterKey(sessionName: string): Promise<void> {
  validateSessionName(sessionName);
  await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
}

/**
 * Deduplicated message delivery for the tmux fallback path.
 *
 * Returns 'delivered' when this call pasted, 'deduplicated' when the key was
 * already recorded (no paste, no Enter). Submission (C-m) is only sent by the
 * caller on a 'delivered' result; a deduplicated replay deliberately sends no
 * stray Enter, because the composer may hold unrelated operator text.
 */
export async function sendKeysDedup(
  sessionName: string,
  keys: string,
  dedupKey: string,
  caller?: string,
): Promise<'delivered' | 'deduplicated'> {
  validateSessionName(sessionName);
  if (!DEDUP_KEY_RE.test(dedupKey)) {
    throw new Error(`dedupKey must match [A-Za-z0-9:_-]+, got: ${dedupKey.slice(0, 40)}`);
  }
  const optionName = `@overdeck-dedup-${dedupKey}`;

  const sendId = randomUUID();
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  const bufferName = `pan-${sendId}`;

  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });

    // One server-side command: paste only when the option is unset, and set
    // the option to OUR sendId in the same breath. Reading the value back
    // distinguishes "we just pasted" from "a prior delivery already marked
    // this key".
    await tmuxExecAsync([
      'if-shell', '-t', sessionName,
      `test -z "$(tmux show-option -qv -t ${sessionName} ${optionName})"`,
      `paste-buffer -b ${bufferName} -p -t ${sessionName} \; set-option -t ${sessionName} ${optionName} ${sendId}`,
    ], { encoding: 'utf-8' });

    const marker = await tmuxExecAsync(
      ['show-option', '-qv', '-t', sessionName, optionName],
      { encoding: 'utf-8' },
    ).then(result => String(result.stdout).trim(), () => '');

    return marker === sendId ? 'delivered' : 'deduplicated';
  } finally {
    await unlink(tmpFile).catch(() => {});
    await tmuxExecAsync(['delete-buffer', '-b', bufferName], { encoding: 'utf-8' }).catch(() => {});
  }
}
