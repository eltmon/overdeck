import chalk from 'chalk';
import { listRunningAgents } from '../../lib/agents.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from '../../lib/paths.js';

export async function pendingCommand(): Promise<void> {
  // Find agents with completed work (status file or convention)
  // For now, show stopped agents that might have completed work

  const agents = listRunningAgents().filter(a => !a.tmuxActive && a.status !== 'error');

  if (agents.length === 0) {
    console.log(chalk.dim('No pending reviews.'));
    console.log(chalk.dim('Agents will appear here when they complete work.'));
    return;
  }

  console.log(chalk.bold('\nPending Reviews\n'));

  for (const agent of agents) {
    console.log(`${chalk.cyan(agent.issueId)}`);
    console.log(`  Agent:     ${agent.id}`);
    console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);

    // Check for completion notes
    const completionFile = join(AGENTS_DIR, agent.id, 'completion.md');
    if (existsSync(completionFile)) {
      const content = readFileSync(completionFile, 'utf8');
      const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (firstLine) {
        console.log(`  Summary:   ${chalk.dim(firstLine.trim())}`);
      }
    }

    console.log('');
  }

  console.log(chalk.dim('Run "pan approve <id>" to approve and merge.'));
}
