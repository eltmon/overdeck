/**
 * Run claude-code-router with dangerously skip permissions
 *
 * This command provides a convenient way to invoke Claude Code through
 *   router with permissions bypass enabled.
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';

export async function ccrCommand(args: string[]): Promise<void> {
  // Build claude-code-router command with args
  const routerCmd = args.length > 0 ? ['claude-code-router', ...args] : ['claude-code-router'];

  const spinner = ora('Starting claude-code-router...').start();

  try {
    // Spawn with CCR_DANGEROUSLY_SKIP environment variable set
    const child = spawn(routerCmd[0], routerCmd.slice(1), {
      env: { ...process.env, CCR_DANGEROUSLY_SKIP: 'true' },
      stdio: 'inherit', // Inherit stdin/stdout/stderr for interactive use
      shell: false, // Direct execution, not through shell
    });

    child.on('close', (code) => {
      if (code === 0) {
        spinner.succeed('claude-code-router exited successfully');
      } else {
        spinner.fail(`claude-code-router exited with code ${code}`);
      }
    });

    child.on('error', (err) => {
      spinner.fail('Failed to start claude-code-router');
      console.error(chalk.red(err.message));
      process.exit(1);
    });

    // Handle exit of this wrapper - if router exits, we exit too
    child.on('exit', () => {
      process.exitCode = child.exitCode || 0;
    });

  } catch (error: any) {
    spinner.fail('Failed to start claude-code-router');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
