/**
 * PAN-4264: metering for the GitHub App REST door (`githubApiWithToken` in
 * `src/lib/github-app.ts`).
 *
 * The App door spends the `app` pool's REST bucket. A call made outside any
 * `withGitHubCaller` context is recorded as `app-rest` (essential); a call
 * inside a non-essential context such as `pipeline-membership` is skipped
 * while `app:rest` is paused. Kept apart from github-app.ts so that file only
 * gains call-site edits (NFR-6).
 */

import type { GitHubQuotaCaller } from '@overdeck/contracts';
import { currentGitHubCaller } from './caller-context.js';
import { classifyGitHubRefusal, type GitHubRefusal } from './classify.js';
import { appendLedgerEntry, type LedgerEntry } from './ledger.js';
import { assertGitHubCallAllowed, GitHubRateLimitedError, recordGitHubRefusal } from './pause-gate.js';

/** Resolve the App-door caller and check the pause gate before the request. */
export function beginAppRestCall(): GitHubQuotaCaller {
  const caller = currentGitHubCaller() ?? 'app-rest';
  assertGitHubCallAllowed(caller, 'app', 'rest');
  return caller;
}

function parseHeaderInt(headers: Headers | undefined, name: string): number | undefined {
  const raw = typeof headers?.get === 'function' ? headers.get(name) : null;
  if (raw == null || !/^\d+$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

/** Ledger fields read from `x-ratelimit-*` response headers. */
export function rateLimitHeaderFields(headers: Headers | undefined): Partial<LedgerEntry> {
  const remaining = parseHeaderInt(headers, 'x-ratelimit-remaining');
  const limit = parseHeaderInt(headers, 'x-ratelimit-limit');
  const resetSec = parseHeaderInt(headers, 'x-ratelimit-reset');
  return {
    ...(remaining !== undefined ? { remaining } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(resetSec !== undefined ? { resetAt: new Date(resetSec * 1000).toISOString() } : {}),
  };
}

/**
 * Record one App REST response. A rate-limit refusal records a pause and
 * throws `GitHubRateLimitedError`; any other response appends one ledger line
 * and returns, leaving the caller's own error handling unchanged. Metering
 * itself never throws (NFR-2).
 */
export async function finishAppRestCall(
  caller: GitHubQuotaCaller,
  response: { ok: boolean; status: number; headers?: Headers },
  errorText?: string,
): Promise<void> {
  let refusal: GitHubRefusal | null = null;
  let headerFields: Partial<LedgerEntry> = {};
  try {
    headerFields = rateLimitHeaderFields(response.headers);
    if (!response.ok) {
      refusal = classifyGitHubRefusal({ status: response.status, message: errorText, headers: response.headers });
    }
  } catch {
    refusal = null;
  }

  if (refusal) {
    const pause = await recordGitHubRefusal({
      pool: 'app', bucket: 'rest', caller, refusal, ledger: { estimated: false, ...headerFields },
    });
    throw new GitHubRateLimitedError(pause);
  }

  await appendLedgerEntry({
    kind: 'call',
    caller,
    pool: 'app',
    bucket: 'rest',
    cost: 1,
    estimated: false,
    outcome: response.ok ? 'ok' : 'error',
    ...headerFields,
  });
}
