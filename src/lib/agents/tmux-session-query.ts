/**
 * A bounded, three-part tmux `has-session` for the liveness oracle's legacy
 * tmux check on a Herdr host (review of #4018, L2).
 *
 * `sessionExists` folds every failure into false, so a tmux probe that errored
 * read as "no session" and a live legacy agent could be confirmed dead. And
 * `tmuxExecAsync` sets no timeout, so a hung tmux server (still up for
 * conversations until PAN-3921) stalled every `isAlive` call Herdr answered
 * `absent`. This answers `exists`, `missing`, or `error`, and a probe that
 * does not answer in time is `error`.
 */

import { exactSession, tmuxExecAsync } from '../tmux.js';

export type TmuxSessionAnswer = 'exists' | 'missing' | 'error';

/** How long the legacy tmux check may take before it counts as "could not answer". */
export const LEGACY_TMUX_PROBE_TIMEOUT_MS = 2_000;

/**
 * Classify an async `has-session` failure. `execFile`'s promise rejects with
 * the exit code in `code` (only the sync call sets `status`), and with
 * `killed` when its timeout fired. A tmux server that is not running, or whose
 * socket is gone, holds no session: that is `missing`, not `error` — on a
 * Herdr host with no tmux server, every probe lands there.
 */
export function classifyHasSessionFailure(cause: unknown): Exclude<TmuxSessionAnswer, 'exists'> {
  const error = cause as { stderr?: string | Buffer; code?: string | number; killed?: boolean };
  if (error?.killed) return 'error';
  const stderr = String(error?.stderr ?? '');
  const noSuchSession = /can't find session:|no server running on|error connecting to .*\(No such file or directory\)/i;
  return error?.code === 1 && noSuchSession.test(stderr) ? 'missing' : 'error';
}

/** `has-session` with a timeout; never throws. */
export async function queryTmuxSession(
  agentId: string,
  timeoutMs: number = LEGACY_TMUX_PROBE_TIMEOUT_MS,
): Promise<TmuxSessionAnswer> {
  try {
    await tmuxExecAsync(['has-session', '-t', exactSession(agentId)], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    return 'exists';
  } catch (cause) {
    return classifyHasSessionFailure(cause);
  }
}
