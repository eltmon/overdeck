import chalk from 'chalk';
import { listConvoys } from '../../../lib/convoy.js';

interface ListOptions {
  status?: string;
  json?: boolean;
}

export function listCommand(options: ListOptions): void {
  const filter = options.status ? { status: options.status } : undefined;
  const convoys = listConvoys(filter);

  if (convoys.length === 0) {
    console.log(chalk.yellow('No convoys found'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(convoys, null, 2));
    return;
  }

  // Human-readable output
  console.log('');
  console.log(chalk.bold('Convoys'));
  console.log(chalk.dim('─'.repeat(80)));
  console.log('');

  for (const convoy of convoys) {
    const statusColor =
      convoy.status === 'completed' ? chalk.green :
      convoy.status === 'running' ? chalk.cyan :
      convoy.status === 'failed' ? chalk.red :
      chalk.yellow;

    const statusIcon =
      convoy.status === 'completed' ? '✓' :
      convoy.status === 'running' ? '⟳' :
      convoy.status === 'failed' ? '✗' :
      '○';

    console.log(chalk.bold(`${statusColor(statusIcon)} ${convoy.id}`));
    console.log(`  ${chalk.dim('Template:')} ${convoy.template}`);
    console.log(`  ${chalk.dim('Status:')}   ${statusColor(convoy.status)}`);
    console.log(`  ${chalk.dim('Started:')}  ${new Date(convoy.startedAt).toLocaleString()}`);

    if (convoy.completedAt) {
      console.log(`  ${chalk.dim('Completed:')} ${new Date(convoy.completedAt).toLocaleString()}`);
    }

    // Show agent status summary
    const agentCounts = convoy.agents.reduce((acc, agent) => {
      acc[agent.status] = (acc[agent.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const summary = Object.entries(agentCounts)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ');

    console.log(`  ${chalk.dim('Agents:')}   ${summary}`);
    console.log('');
  }

  console.log(chalk.dim(`Total: ${convoys.length} convoy(s)`));
  console.log('');
  console.log(chalk.dim('Use ') + chalk.cyan('pan convoy status <id>') + chalk.dim(' to see details'));
  console.log('');
}
