/**
 * PAN-4264: the `gh` account login, for the quota banner and doctor output.
 *
 * Read once per process with `gh api user --jq .login` (1 REST point) and kept
 * in memory only. The login is shown locally and is never sent to telemetry
 * (NFR-3). A failed read is retried only after `LOGIN_RETRY_MS`: the snapshot
 * publisher asks every 30 seconds, and on a host without an authenticated gh
 * (or during the very rate limit this reports) a retry per tick would spawn
 * gh — and record a refusal — twice a minute.
 */

import { runGh, type GhExecFn } from './run-gh.js';

export const LOGIN_RETRY_MS = 10 * 60_000;

let login: Promise<string | null> | null = null;
let failedAt: number | null = null;

export function getGitHubLogin(exec?: GhExecFn): Promise<string | null> {
  if (login) return login;
  if (failedAt !== null && Date.now() - failedAt < LOGIN_RETRY_MS) return Promise.resolve(null);
  login = runGh(['api', 'user', '--jq', '.login'], {
    caller: 'quota-sampler',
    timeout: 15_000,
    ...(exec ? { exec } : {}),
  }).then(({ stdout }) => {
    const value = stdout.trim();
    if (!value) throw new Error('empty login');
    failedAt = null;
    return value;
  }).catch(() => {
    login = null;
    failedAt = Date.now();
    return null;
  });
  return login;
}

/** Forget the memoized login and failure (tests only). */
export function resetGitHubLoginForTests(): void {
  login = null;
  failedAt = null;
}
