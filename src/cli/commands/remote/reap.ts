/**
 * pan admin remote reap — hand completed remote agents to the review pipeline.
 *
 * Scans remote agent states for the PAN_REMOTE_DONE marker (or an exited
 * session with a pushed branch), materializes the local worktree, creates
 * review artifacts, writes the completion marker for the cloister, and
 * stops the fly machine.
 */

import chalk from 'chalk';
import { reapCompletedRemoteAgents } from '../../../lib/remote/remote-completion.js';

export interface ReapOptions {
  issue?: string;
  dryRun?: boolean;
}

export async function reapCommand(options: ReapOptions): Promise<void> {
  const results = await reapCompletedRemoteAgents({ issueId: options.issue, dryRun: options.dryRun });

  if (results.length === 0) {
    console.log(chalk.dim('No active remote agents found.'));
    return;
  }

  let failures = 0;
  for (const result of results) {
    const color =
      result.status === 'handed-off' ? chalk.green :
      result.status === 'still-running' ? chalk.cyan :
      result.status === 'stale' ? chalk.dim : chalk.red;
    console.log(color(`${result.agentId} (${result.issueId}): ${result.status}`));
    for (const detail of result.details) {
      console.log(chalk.dim(`  - ${detail}`));
    }
    if (result.status === 'error') failures++;
  }

  if (failures > 0) process.exit(1);
}
