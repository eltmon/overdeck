/**
 * PAN-4264: recognize a GitHub rate-limit refusal from any transport.
 *
 * `gh` execs only expose a message/stderr; `fetch` paths also expose the HTTP
 * status and headers. Both feed the same classifier so every caller reports
 * refusals the same way. Anything that is not a rate limit returns `null`, and
 * the caller keeps its own error handling.
 */

import type { GitHubRateLimitKind } from '@overdeck/contracts';

export interface GitHubRefusal {
  kind: GitHubRateLimitKind;
  /** Seconds GitHub asked the client to wait (`retry-after`). */
  retryAfterSec?: number;
  /**
   * Epoch seconds the hourly window resets (`x-ratelimit-reset`). Set for
   * primary refusals only: on a secondary refusal the header describes the
   * hourly window, not the burst limit, so it must not size the pause.
   */
  resetAtSec?: number;
}

export interface GitHubRefusalInput {
  status?: number;
  message?: string;
  stderr?: string;
  headers?: Headers;
}

const SECONDARY_PATTERN = /secondary rate limit|abuse detection/i;
const PRIMARY_PATTERN = /API rate limit (already )?exceeded|graphql_rate_limit|rate limit exceeded/i;
const RETRY_AFTER_TEXT_PATTERN = /retry[- ]after:?\s*(\d+)/i;

function parseNonNegativeInt(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** Classify a failed GitHub call as a primary or secondary rate limit, or `null`. */
export function classifyGitHubRefusal(input: GitHubRefusalInput): GitHubRefusal | null {
  const text = `${input.message ?? ''}\n${input.stderr ?? ''}`;
  const isErrorStatus = input.status === undefined || input.status >= 400;
  const headerRetryAfter = isErrorStatus ? parseNonNegativeInt(input.headers?.get('retry-after')) : undefined;
  const textRetryAfter = parseNonNegativeInt(RETRY_AFTER_TEXT_PATTERN.exec(text)?.[1]);
  const retryAfterSec = headerRetryAfter ?? textRetryAfter;

  if (SECONDARY_PATTERN.test(text) || headerRetryAfter !== undefined) {
    return retryAfterSec === undefined ? { kind: 'secondary' } : { kind: 'secondary', retryAfterSec };
  }

  const exhaustedHeader =
    (input.status === 403 || input.status === 429) &&
    input.headers?.get('x-ratelimit-remaining')?.trim() === '0';
  if (PRIMARY_PATTERN.test(text) || exhaustedHeader) {
    const resetAtSec = parseNonNegativeInt(input.headers?.get('x-ratelimit-reset'));
    return resetAtSec === undefined ? { kind: 'primary' } : { kind: 'primary', resetAtSec };
  }

  return null;
}
