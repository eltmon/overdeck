/**
 * PAN-4264: the `gh` account login, for the quota banner and doctor output.
 *
 * Read once per process with `gh api user --jq .login` (1 REST point) and kept
 * in memory only. The login is shown locally and is never sent to telemetry
 * (NFR-3). A failed read is not memoized, so the next caller tries again.
 */

import { runGh, type GhExecFn } from './run-gh.js';

let login: Promise<string | null> | null = null;

export function getGitHubLogin(exec?: GhExecFn): Promise<string | null> {
  login ??= runGh(['api', 'user', '--jq', '.login'], {
    caller: 'quota-sampler',
    timeout: 15_000,
    ...(exec ? { exec } : {}),
  }).then(({ stdout }) => {
    const value = stdout.trim();
    if (!value) throw new Error('empty login');
    return value;
  }).catch(() => {
    login = null;
    return null;
  });
  return login;
}

/** Forget the memoized login (tests only). */
export function resetGitHubLoginForTests(): void {
  login = null;
}
