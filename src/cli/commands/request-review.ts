/**
 * pan review request <id> [message]
 *
 * Request a re-review after fixing feedback.
 * Used by agents to automatically queue for re-review (circuit breaker: max 7)
 */

import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { getDashboardApiUrl } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrl();

interface RequestReviewOptions {
  message?: string;
}

interface RequestReviewResponse {
  message?: string;
  error?: string;
  hint?: string;
  queued?: boolean;
  autoRequeueCount?: number;
  remainingRequeues?: number;
}

const MAX_AUTO_REQUEUES = 25;

/**
 * The one CLI door to `POST /api/review/:issueId/request` (PAN-3917 W12).
 * `pan review request` prints it; `pan done` calls it as its last step, so the
 * review convoy starts from the submit command instead of waiting for someone
 * to ask. `unreachable` is a dashboard that did not answer at all — the caller
 * decides whether that is fatal.
 */
export type ReviewRequestResult =
  | { kind: 'ok'; status: number; result: RequestReviewResponse }
  | { kind: 'rejected'; status: number; result: RequestReviewResponse }
  | { kind: 'unreachable'; error: string };

export async function requestReviewViaDashboard(
  issueId: string,
  message?: string,
  timeoutMs = 120_000,
  /** Who asked — journalled by the server as the `review.requested` source. */
  source: 'pan-review-request' | 'pan-done' | 'pan-unpause' = 'pan-review-request',
): Promise<ReviewRequestResult> {
  let response: Response;
  try {
    response = await fetch(`${DASHBOARD_URL}/api/review/${issueId}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, source }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    // Node's fetch rejects with TypeError('fetch failed') and keeps the socket
    // error on `.cause`; a timeout rejects with TimeoutError. Either way the
    // dashboard did not answer.
    return { kind: 'unreachable', error: error?.cause?.code ?? error?.message ?? String(error) };
  }

  let result: RequestReviewResponse = {};
  try {
    result = await response.json() as RequestReviewResponse;
  } catch { /* a body-less response is still a verdict */ }

  return response.ok
    ? { kind: 'ok', status: response.status, result }
    : { kind: 'rejected', status: response.status, result };
}

export async function requestReviewCommand(
  id: string,
  options: RequestReviewOptions
): Promise<void> {
  const issueId = id.toUpperCase();

  console.log(chalk.dim(`Requesting re-review for ${issueId}...`));

  const response = await requestReviewViaDashboard(issueId, options.message);

  if (response.kind === 'unreachable') {
    console.error(chalk.red('\nError: Dashboard not running'));
    console.error(chalk.dim(`  ${response.error}`));
    console.error(chalk.dim('Start the dashboard with: pan up'));
    return exitCli(1);
  }

  const result = response.result;

  if (response.kind === 'rejected') {
    if (response.status === 429) {
      // Circuit breaker triggered
      console.error(chalk.red('\nCircuit breaker triggered!'));
      console.error(chalk.yellow(`Maximum automatic re-review requests (${MAX_AUTO_REQUEUES}) exceeded.`));
      console.error(chalk.dim('A human must click the Review button in the dashboard to continue.'));
      return exitCli(1);
    }

    console.error(chalk.red(`\nError: ${result.error || 'Failed to request review'}`));
    if (result.hint) {
      console.error(chalk.dim(result.hint));
    }
    return exitCli(1);
  }

  console.log(chalk.green(`\n✓ ${result.message}`));

  if (result.remainingRequeues !== undefined) {
    const remaining = result.remainingRequeues;
    const color = remaining === 0 ? chalk.red : remaining === 1 ? chalk.yellow : chalk.dim;
    console.log(color(`  Remaining auto-requeues: ${remaining}`));
  }

  if (result.queued) {
    console.log(chalk.dim('  Review-agent will pick this up when available.'));
  }
}
