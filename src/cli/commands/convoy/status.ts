import chalk from 'chalk';
import { getConvoyStatus, listConvoys } from '../../../lib/convoy.js';

interface StatusOptions {
  json?: boolean;
}

export function statusCommand(
  convoyId: string | undefined,
  options: StatusOptions
): void {
  // If no ID specified, show most recent running convoy
  let id = convoyId;
  if (!id) {
    const running = listConvoys({ status: 'running' });
    if (running.length === 0) {
      console.log(chalk.yellow('No running convoys'));
      return;
    }
    id = running[0].id;
  }

  const convoy = getConvoyStatus(id);
  if (!convoy) {
    console.error(chalk.red(`Convoy not found: ${id}`));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(convoy, null, 2));
    return;
  }

  // Human-readable output
  const statusColor =
    convoy.status === 'completed' ? chalk.green :
    convoy.status === 'running' ? chalk.cyan :
    convoy.status === 'failed' ? chalk.red :
    chalk.yellow;

  console.log('');
  console.log(chalk.bold('Convoy Status'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.dim('  ID:       ') + convoy.id);
  console.log(chalk.dim('  Template: ') + convoy.template);
  console.log(chalk.dim('  Status:   ') + statusColor(convoy.status));
  console.log(chalk.dim('  Started:  ') + new Date(convoy.startedAt).toLocaleString());

  if (convoy.completedAt) {
    console.log(chalk.dim('  Completed:') + new Date(convoy.completedAt).toLocaleString());
  }

  console.log(chalk.dim('  Output:   ') + convoy.outputDir);
  console.log('');

  console.log(chalk.bold('Agents:'));
  for (const agent of convoy.agents) {
    const statusColor =
      agent.status === 'completed' ? chalk.green :
      agent.status === 'running' ? chalk.cyan :
      agent.status === 'failed' ? chalk.red :
      chalk.dim;

    const statusIcon =
      agent.status === 'completed' ? '✓' :
      agent.status === 'running' ? '⟳' :
      agent.status === 'failed' ? '✗' :
      '○';

    console.log(`  ${statusColor(statusIcon)} ${chalk.bold(agent.role)} (${agent.subagent})`);
    console.log(`    ${chalk.dim('Status:')} ${statusColor(agent.status)}`);
    console.log(`    ${chalk.dim('Tmux:')}  ${agent.tmuxSession}`);

    if (agent.outputFile) {
      console.log(`    ${chalk.dim('Output:')} ${agent.outputFile}`);
    }

    if (agent.startedAt) {
      console.log(`    ${chalk.dim('Started:')} ${new Date(agent.startedAt).toLocaleString()}`);
    }

    if (agent.completedAt) {
      console.log(`    ${chalk.dim('Completed:')} ${new Date(agent.completedAt).toLocaleString()}`);
    }

    console.log('');
  }

  // Show helpful commands
  if (convoy.status === 'running') {
    console.log(chalk.dim('Commands:'));
    const runningAgent = convoy.agents.find(a => a.status === 'running');
    if (runningAgent) {
      console.log(chalk.dim('  Attach to agent: ') + chalk.cyan(`tmux attach -t ${runningAgent.tmuxSession}`));
    }
    console.log(chalk.dim('  Stop convoy:     ') + chalk.cyan(`pan convoy stop ${convoy.id}`));
  }

  if (convoy.status === 'completed') {
    console.log(chalk.dim('View outputs in: ') + chalk.cyan(convoy.outputDir));
  }

  console.log('');
}
