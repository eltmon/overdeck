/**
 * pan plan done <id>
 *
 * Complete planning for an issue — kills the planning tmux session,
 * promotes the xBRIEF to proposed on main, syncs beads, and transitions
 * the issue to "Planned".
 *
 * Delegates to promotePlanning() (POST /api/issues/:id/complete-planning).
 * The route reads the auto-start consent record itself, so a retry after a
 * failed finalize still starts the work agent when planning was launched
 * with auto-start (PAN-1972, PAN-5526).
 */

import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import { promotePlanning } from './plan-finalize.js';

export async function planDoneCommand(id: string, options: { prd?: boolean } = {}): Promise<void> {
  const issueId = id.toUpperCase();
  const spinner = ora(`Completing planning for ${issueId}...`).start();

  const result = await promotePlanning(issueId, { noPrd: options.prd === false });

  if (!result.success) {
    spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
    return exitCli(1);
  }

  spinner.succeed(chalk.green(`✓ Planning complete for ${issueId}`));
  if (result.message) {
    console.log(chalk.dim(`  ${result.message}`));
  }
  if (result.workAgentSpawned) {
    console.log(chalk.dim(`  Work agent started${result.workAgentMessage ? ` — ${result.workAgentMessage}` : ''}`));
  } else if (result.workAgentDeferred) {
    console.log(chalk.dim(result.workAgentRetryHeld === 'deacon-paused'
      ? `  Work agent start deferred by spawn guardrails; the retry is held while the Deacon is frozen. Unfreeze it or run pan start ${issueId}.`
      : '  Work agent start deferred by spawn guardrails; retried automatically for up to 2 hours'));
  } else if (result.workAgentSkipReason) {
    console.log(chalk.dim(`  Work agent not started: ${result.workAgentSkipReason}`));
  }
}
