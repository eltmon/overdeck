/**
 * pan plan done <id>
 *
 * Complete planning for an issue — kills the planning tmux session,
 * promotes the vBRIEF to proposed on main, syncs beads, and transitions
 * the issue to "Planned".
 *
 * Delegates to promotePlanning() (POST /api/issues/:id/complete-planning),
 * which now carries backoff retries and the auto-start handoff so a Done-retry
 * after a transient finalize failure still re-fires the work-agent auto-start
 * when the planning agent was launched with --auto-start (PAN-1972).
 */

import chalk from 'chalk';
import ora from 'ora';
import { promotePlanning, readAutoSpawnOnFinalize } from './plan-finalize.js';

export async function planDoneCommand(id: string, options: { prd?: boolean } = {}): Promise<void> {
  const issueId = id.toUpperCase();
  const spinner = ora(`Completing planning for ${issueId}...`).start();

  // Re-fire auto-start on the retry path: if the planning agent was launched
  // with --auto-start, a `pan plan done` retry must carry that intent too, or a
  // once-failed finalize can never relaunch the work agent (PAN-1972).
  const autoSpawn = readAutoSpawnOnFinalize(issueId);
  const result = await promotePlanning(issueId, autoSpawn, { noPrd: options.prd === false });

  if (!result.success) {
    spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
    process.exit(1);
  }

  spinner.succeed(chalk.green(`✓ Planning complete for ${issueId}`));
  if (result.message) {
    console.log(chalk.dim(`  ${result.message}`));
  }
  if (result.workAgentSpawned) {
    console.log(chalk.dim(`  Work agent started${result.workAgentMessage ? ` — ${result.workAgentMessage}` : ''}`));
  } else if (result.workAgentSkipReason) {
    console.log(chalk.dim(`  Work agent not started: ${result.workAgentSkipReason}`));
  }
}
