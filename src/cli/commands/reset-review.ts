/**
 * pan review reset <id>
 *
 * Human-initiated full pipeline reset. Clears all specialist states,
 * resets the circuit breaker, and re-triggers the review pipeline.
 * No circuit breaker limit — this is a deliberate human override.
 * With --session, also clears the saved Claude session after the
 * review reset completes.
 */

import chalk from 'chalk';
import { getDashboardApiUrl } from '../../lib/config.js';
import { resetSessionCommand } from './reset-session.js';

const DASHBOARD_URL = getDashboardApiUrl();

export interface ResetReviewOptions {
  session?: boolean;
}

export async function resetReviewCommand(id: string, options: ResetReviewOptions = {}): Promise<void> {
  const issueId = id.toUpperCase();

  console.log(chalk.dim(`Resetting review cycles for ${issueId}...`));

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/review/${issueId}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json() as { success: boolean; message?: string; error?: string; queued?: boolean };

    if (!response.ok) {
      console.error(chalk.red(`\nError: ${result.error || 'Failed to reset review cycles'}`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ ${result.message}`));

    if (result.queued) {
      console.log(chalk.dim('  Review-agent will pick this up when available.'));
    }

    if (options.session) {
      console.error(chalk.red('\nError: Claude sessions must never be reset. Sessions are sacred — use "pan resume" to continue the existing session.'));
      process.exit(1);
      // Hidden override (future use): await resetSessionCommand(id);
    }

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('\nError: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: pan up'));
      process.exit(1);
    }
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}
