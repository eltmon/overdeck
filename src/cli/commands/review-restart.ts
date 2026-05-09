/**
 * `pan review restart <id> [--model <model>]`
 *
 * Kills all running reviewer + coordinator sessions for an issue, then
 * dispatches a fresh review pipeline. When `--model` is provided, every
 * reviewer spawns with that model instead of the configured per-role models.
 *
 * This is the CLI equivalent of the dashboard's right-click → "Restart all
 * reviewers (with model)" context menu.
 */

import chalk from 'chalk';
import { getDashboardApiUrl } from '../../lib/config.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';

const DASHBOARD_URL = getDashboardApiUrl();

export interface ReviewRestartOptions {
  model?: string;
  role?: string;
}

export async function reviewRestartCommand(
  id: string,
  opts: ReviewRestartOptions = {},
): Promise<void> {
  const issueId = id.toUpperCase();

  const resolved = resolveProjectFromIssue(issueId);
  if (!resolved) {
    console.error(chalk.red(`\nError: cannot resolve project for ${issueId}`));
    process.exit(1);
  }

  const modelLabel = opts.model ? ` with model ${chalk.cyan(opts.model)}` : '';
  const roleLabel = opts.role ? ` (role: ${opts.role})` : '';
  console.log(chalk.dim(`Restarting review for ${issueId}${roleLabel}${modelLabel}...`));

  try {
    const endpoint = opts.role
      ? `${DASHBOARD_URL}/api/specialists/${resolved.projectKey}/${issueId}/reviewer/${opts.role}/restart`
      : `${DASHBOARD_URL}/api/specialists/${resolved.projectKey}/${issueId}/review/restart`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model }),
    });

    const result = await response.json() as {
      success: boolean;
      message?: string;
      error?: string;
      killed?: string[] | number;
      model?: string;
    };

    if (!response.ok) {
      console.error(chalk.red(`\nError: ${result.error || 'Failed to restart review'}`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ Review restarted for ${issueId}`));
    if (result.message) console.log(chalk.dim(`  ${result.message}`));
    if (result.model) console.log(chalk.dim(`  model: ${result.model}`));
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
