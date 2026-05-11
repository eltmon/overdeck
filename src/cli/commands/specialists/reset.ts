/**
 * pan specialists reset <name>
 * pan specialists reset --all
 *
 * Legacy specialist session files were removed by PAN-1048. Role-based agents
 * are managed through the normal agent lifecycle.
 */

import chalk from 'chalk';

interface ResetOptions {
  force?: boolean;
  all?: boolean;
}

export async function resetCommand(name: string | undefined, options: ResetOptions): Promise<void> {
  const target = options.all ? 'all legacy specialists' : (name ?? 'the requested specialist');
  console.log(chalk.red(`\nLegacy specialist reset is no longer supported for ${target}.`));
  console.log(chalk.dim('Use role-agent controls or stop the relevant tmux session/agent from the dashboard.\n'));
  process.exit(1);
}
