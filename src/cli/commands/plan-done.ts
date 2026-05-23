/**
 * pan plan done <id>
 *
 * Complete planning for an issue — kills the planning tmux session,
 * promotes the vBRIEF to proposed on main, syncs beads, and transitions
 * the issue to "Planned".
 *
 * Delegates to POST /api/issues/:id/complete-planning on the dashboard server.
 */

import chalk from 'chalk';
import ora from 'ora';
import { getDashboardApiUrlSync } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrlSync();

interface CompletePlanningResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export async function planDoneCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();
  const spinner = ora(`Completing planning for ${issueId}...`).start();

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/issues/${issueId}/complete-planning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json() as CompletePlanningResponse;

    if (!response.ok) {
      spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
      process.exit(1);
    }

    spinner.succeed(chalk.green(`✓ Planning complete for ${issueId}`));
    if (result.message) {
      console.log(chalk.dim(`  ${result.message}`));
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to reach dashboard: ${error.message}`));
    console.error(chalk.dim(`Make sure the dashboard is running: pan up`));
    process.exit(1);
  }
}
