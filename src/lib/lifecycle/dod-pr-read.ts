/**
 * PAN-4821: DoD rows 1, 2, 4 and 5 read the issue's PR from the forge. A failed
 * read is a different fact from "no PR exists": the old reader mapped both to
 * null, so a transient forge error closed out as "no pull request found". This
 * reader retries once, logs every failed attempt (the only trace when the retry
 * succeeds), and throws a typed error so callers report the real cause.
 */
import type { IssuePrEndpointResponse, IssuePullRequestData } from '../overdeck/pull-requests.js';

export const PR_READ_ATTEMPTS = 2;
export const PR_READ_PAUSE_MS = 1000;

export class PullRequestReadError extends Error {
  readonly issueId: string;
  readonly underlying: string;

  constructor(issueId: string, underlying: string) {
    super(`pull request read failed on the forge after ${PR_READ_ATTEMPTS} attempts: ${underlying}`);
    this.name = 'PullRequestReadError';
    this.issueId = issueId;
    this.underlying = underlying;
  }
}

/** The PR, or null when the forge answered that none exists. Throws `PullRequestReadError` when every attempt fails. */
export async function readPullRequestWithRetry(
  fetchPr: (issueId: string) => Promise<IssuePrEndpointResponse>,
  issueId: string,
): Promise<IssuePullRequestData | null> {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= PR_READ_ATTEMPTS; attempt++) {
    try {
      const response = await fetchPr(issueId);
      if (!response.error) return response.pr;
      lastError = response.error;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    console.warn(
      `[dod-gate] ${issueId.toUpperCase()} pull request read failed (attempt ${attempt} of ${PR_READ_ATTEMPTS}): ${lastError}`,
    );
    if (attempt < PR_READ_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, PR_READ_PAUSE_MS));
  }
  throw new PullRequestReadError(issueId, lastError);
}
