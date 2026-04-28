import chalk from 'chalk';

export async function approveCommand(_id: string): Promise<void> {
  console.log(chalk.yellow('pan approve has been removed.'));
  console.log('');
  console.log('Use the dashboard MERGE button instead:');
  console.log(chalk.dim('  1. Review passes → readyForMerge becomes true'));
  console.log(chalk.dim('  2. Click MERGE in the dashboard'));
  console.log(chalk.dim('  3. Server orchestrates rebase, verification, squash merge, and cleanup'));
  console.log('');
  console.log(chalk.dim('The dashboard merge path handles merge queue serialization, post-merge'));
  console.log(chalk.dim('lifecycle (Docker cleanup, label cleanup, issue close), and idempotency'));
  console.log(chalk.dim('guards that pan approve bypassed.'));
  process.exit(1);
}
