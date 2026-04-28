import chalk from 'chalk';
import { listRunningAgents } from '../../lib/agents.js';
import { getAllReviewStatusesFromDb } from '../../lib/database/review-status-db.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from '../../lib/paths.js';

export async function pendingCommand(): Promise<void> {
  const allStatuses = getAllReviewStatusesFromDb();
  const pending = Object.values(allStatuses).filter(s => s.reviewStatus === 'pending');

  if (pending.length === 0) {
    console.log(chalk.dim('No pending reviews.'));
    console.log(chalk.dim('Agents will appear here when they complete work.'));
    return;
  }

  const agents = listRunningAgents();
  const agentByIssue = new Map(agents.map(a => [a.issueId.toLowerCase(), a]));

  console.log(chalk.bold('\nPending Reviews\n'));

  for (const status of pending) {
    const agent = agentByIssue.get(status.issueId.toLowerCase());
    console.log(`${chalk.cyan(status.issueId)}`);
    if (agent) {
      console.log(`  Agent:     ${agent.id}`);
      console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);

      const completionFile = join(AGENTS_DIR, agent.id, 'completion.md');
      if (existsSync(completionFile)) {
        const content = readFileSync(completionFile, 'utf8');
        const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (firstLine) {
          console.log(`  Summary:   ${chalk.dim(firstLine.trim())}`);
        }
      }
    }
    console.log('');
  }

  console.log(chalk.dim('When review passes, click MERGE in the dashboard.'));
}
