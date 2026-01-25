import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { stopConvoy, getConvoyStatus } from '../../../lib/convoy.js';

interface StopOptions {
  force?: boolean;
}

export async function stopCommand(
  convoyId: string,
  options: StopOptions
): Promise<void> {
  const convoy = getConvoyStatus(convoyId);
  if (!convoy) {
    console.error(chalk.red(`Convoy not found: ${convoyId}`));
    process.exit(1);
  }

  if (convoy.status !== 'running') {
    console.log(chalk.yellow(`Convoy is not running (status: ${convoy.status})`));
    return;
  }

  // Confirm unless --force
  if (!options.force) {
    const runningAgents = convoy.agents.filter(a => a.status === 'running');

    console.log('');
    console.log(chalk.bold(`Stopping convoy: ${convoy.id}`));
    console.log(chalk.dim(`  Template: ${convoy.template}`));
    console.log(chalk.dim(`  Running agents: ${runningAgents.length}`));
    console.log('');

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Are you sure you want to stop this convoy?',
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.dim('Cancelled'));
      return;
    }
  }

  const spinner = ora('Stopping convoy...').start();

  try {
    await stopConvoy(convoyId);
    spinner.succeed(chalk.green('Convoy stopped'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to stop convoy'));
    if (error instanceof Error) {
      console.error(chalk.red('\n' + error.message));
    }
    process.exit(1);
  }
}
