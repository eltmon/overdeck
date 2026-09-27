/**
 * PAN-4264: metering for GitHub calls made with `fetch` — the GitHub App REST
 * door (`githubApiWithToken` in `src/lib/github-app.ts`, pool `app`) and the
 * PAT client (`ghFetch` in `src/dashboard/server/services/github-client.ts`,
 * pool `pat`).
 *
 * Each response appends one ledger line with its `x-ratelimit-*` headers, or,
 * for a rate-limit refusal, records a pause for the pool's REST bucket. Kept
 * apart from the callers so those files only gain call-site edits (NFR-6).
 */

import type { GitHubQuotaCaller, GitHubQuotaPool } from '@overdeck/contracts';
import { currentGitHubCaller } from './caller-context.js';
import { classifyGitHubRefusal, type GitHubRefusal } from './classify.js';
import { appendLedgerEntry, type LedgerEntry } from './ledger.js';
import {
  assertGitHubCallAllowed,
  activeGitHubPause,
  GitHubRateLimitedError,
  recordGitHubRefusal,
  type PauseRecord,
} from './pause-gate.js';

interface MeteredResponse {
  ok: boolean;
  status: number;
  headers?: Headers;
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
 * Record one REST response in `pool`. Returns the pause when the response is
 * a rate-limit refusal, else appends an ok/error ledger line and returns
 * `null`. Never throws (NFR-2); the caller decides which error to raise.
 */
export async function recordRestResponse(input: {
  caller: GitHubQuotaCaller;
  pool: GitHubQuotaPool;
  response: MeteredResponse;
  errorText?: string;
}): Promise<PauseRecord | null> {
  const { caller, pool, response, errorText } = input;
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
    try {
      return await recordGitHubRefusal({
        pool, bucket: 'rest', caller, refusal, ledger: { estimated: false, ...headerFields },
      });
    } catch {
      return null;
    }
  }

  await appendLedgerEntry({
    kind: 'call',
    caller,
    pool,
    bucket: 'rest',
    cost: 1,
    estimated: false,
    outcome: response.ok ? 'ok' : 'error',
    ...headerFields,
  });
  return null;
}

/**
 * App door: resolve the caller (context, else `app-rest`) and check the pause
 * gate before the request. A non-essential caller throws
 * `GitHubQuotaPausedError` while `app:rest` is paused.
 */
export function beginAppRestCall(): GitHubQuotaCaller {
  const caller = currentGitHubCaller() ?? 'app-rest';
  assertGitHubCallAllowed(caller, 'app', 'rest');
  return caller;
}

/**
 * App door: record the response. A rate-limit refusal throws
 * `GitHubRateLimitedError`; any other response returns and leaves the
 * caller's own error handling unchanged.
 */
export async function finishAppRestCall(
  caller: GitHubQuotaCaller,
  response: MeteredResponse,
  errorText?: string,
): Promise<void> {
  const pause = await recordRestResponse({ caller, pool: 'app', response, errorText });
  if (pause) throw new GitHubRateLimitedError(pause);
}

/**
 * PAT client: record the response as caller `tracker-client` (essential, never
 * gated). The refusal body is read from a clone so the caller can still read
 * the original.
 */
export async function recordPatResponse(response: Response): Promise<PauseRecord | null> {
  let errorText: string | undefined;
  if (!response.ok && (response.status === 403 || response.status === 429) && typeof response.clone === 'function') {
    errorText = await response.clone().text().catch(() => undefined);
  }
  return recordRestResponse({ caller: 'tracker-client', pool: 'pat', response, errorText });
}

function octokitHeaders(raw: unknown): Headers {
  const headers = new Headers();
  if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') headers.set(name, String(value));
    }
  }
  return headers;
}

/** Octokit (PAT) poller: record one successful response page. Never throws. */
export async function recordOctokitPage(caller: GitHubQuotaCaller, rawHeaders: unknown): Promise<void> {
  try {
    await recordRestResponse({ caller, pool: 'pat', response: { ok: true, status: 200, headers: octokitHeaders(rawHeaders) } });
  } catch {
    // NFR-2: metering never fails the poll.
  }
}

/**
 * Octokit (PAT) poller: record a failed request when it is a 403/429, so a
 * rate-limit refusal pauses the PAT REST bucket. Never throws.
 */
export async function recordOctokitFailure(caller: GitHubQuotaCaller, error: unknown): Promise<void> {
  try {
    const { status, message, response } = (error ?? {}) as { status?: unknown; message?: unknown; response?: { headers?: unknown } };
    if (status !== 403 && status !== 429) return;
    await recordRestResponse({
      caller,
      pool: 'pat',
      response: { ok: false, status, headers: octokitHeaders(response?.headers) },
      errorText: typeof message === 'string' ? message : undefined,
    });
  } catch {
    // NFR-2: metering never fails the poll.
  }
}

/**
 * Octokit (PAT) poller: milliseconds until the active `pat:rest` pause ends,
 * capped at `capMs`; 0 when the bucket is not paused.
 */
export function patRestPauseDelayMs(capMs = 3_600_000, nowMs: number = Date.now()): number {
  const pause = activeGitHubPause('pat', 'rest', nowMs);
  return pause ? Math.min(Math.max(Date.parse(pause.until) - nowMs, 0), capMs) : 0;
}
