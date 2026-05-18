/**
 * pan review request <id> [message]
 *
 * Request a re-review after fixing feedback.
 * Used by agents to automatically queue for re-review (circuit breaker: max 7)
 */

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

export async function requestReviewCommand(
  id: string,
  options: RequestReviewOptions
): Promise<void> {
  const issueId = id.toUpperCase();

  console.log(chalk.dim(`Requesting re-review for ${issueId}...`));

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/review/${issueId}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: options.message }),
    });

    const result = await response.json() as RequestReviewResponse;

    if (!response.ok) {
      if (response.status === 429) {
        // Circuit breaker triggered
        console.error(chalk.red('\nCircuit breaker triggered!'));
        console.error(chalk.yellow(`Maximum automatic re-review requests (${MAX_AUTO_REQUEUES}) exceeded.`));
        console.error(chalk.dim('A human must click the Review button in the dashboard to continue.'));
        process.exit(1);
      }

      console.error(chalk.red(`\nError: ${result.error || 'Failed to request review'}`));
      if (result.hint) {
        console.error(chalk.dim(result.hint));
      }
      process.exit(1);
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

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('\nError: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: cd src/dashboard && npm run dev'));
      process.exit(1);
    }
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}
