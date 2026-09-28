/**
 * PAN-4264: which logical Overdeck subsystem is spending GitHub quota.
 *
 * A caller sets its name once around a unit of work with `withGitHubCaller`;
 * every metered GitHub call inside it (`runGh`, the App REST door) reads the
 * name with `currentGitHubCaller` and records it in the ledger. Calls outside
 * any context are recorded as `other` by the metering sites.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { GitHubQuotaCaller } from '@overdeck/contracts';

const githubCaller = new AsyncLocalStorage<GitHubQuotaCaller>();

/** Run `fn` with `caller` as the GitHub quota caller for every call it makes. */
export function withGitHubCaller<T>(caller: GitHubQuotaCaller, fn: () => Promise<T>): Promise<T> {
  return githubCaller.run(caller, fn);
}

/** The caller set by the nearest enclosing `withGitHubCaller`, if any. */
export function currentGitHubCaller(): GitHubQuotaCaller | undefined {
  return githubCaller.getStore();
}
