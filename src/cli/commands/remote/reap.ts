/**
 * pan admin remote reap — hand completed remote agents to the review pipeline.
 *
 * Scans running remote agents for the REMOTE_DONE sentinel, materializes the
 * local worktree, creates review artifacts, writes the completion marker,
 * stops the fly machine and requests review. Deacon-lite runs the same reap
 * every 60 s; this command forces it.
 */

import { exitCli } from '../../exit.js';
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
      result.status === 'indeterminate' ? chalk.yellow :
      result.status === 'stale' ? chalk.dim : chalk.red;
    console.log(color(`${result.agentId} (${result.issueId}): ${result.status}`));
    for (const detail of result.details) {
      console.log(chalk.dim(`  - ${detail}`));
    }
    if (result.status === 'error') failures++;
  }

  if (failures > 0) return exitCli(1);
}
