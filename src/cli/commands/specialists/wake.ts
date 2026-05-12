/**
 * pan specialists wake <name>
 *
 * Legacy specialist wake was removed by PAN-1048. Role-based runs now spawn
 * plan/work/review/test/ship agents directly.
 */

import chalk from 'chalk';

interface WakeOptions {
  task?: string;
}

export async function wakeCommand(name: string, _options: WakeOptions): Promise<void> {
  console.log(chalk.red(`\nLegacy specialist wake is no longer supported for '${name}'.`));
  console.log(chalk.dim('Use the issue lifecycle / role runner instead: plan, work, review, test, or ship.\n'));
  process.exit(1);
}
