/**
 * pan specialists reset <name>
 *
 * Reset a specialist (clear session, start fresh)
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import * as readline from 'readline';
import {
  getSpecialistStatus,
  clearSessionId,
  getTmuxSessionName,
  type SpecialistType,
} from '../../../lib/cloister/specialists.js';

interface ResetOptions {
  force?: boolean;
}

export async function resetCommand(name: string, options: ResetOptions): Promise<void> {
  // Validate specialist name
  const validNames: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent'];
  if (!validNames.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${validNames.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const status = getSpecialistStatus(specialistName);

  console.log(chalk.bold(`\nResetting ${status.displayName}...\n`));

  // Show current state
  console.log(chalk.dim('Current state:'));
  console.log(`  Status: ${status.state}`);
  if (status.isRunning) {
    console.log(`  Running: ${chalk.yellow('yes')} (tmux: ${status.tmuxSession})`);
  }
  if (status.sessionId) {
    console.log(`  Session: ${status.sessionId.substring(0, 8)}...`);
  }
  if (status.contextTokens) {
    console.log(`  Context: ${status.contextTokens.toLocaleString()} tokens`);
  }
  console.log('');

  // Confirm if not forced
  if (!options.force) {
    const confirmed = await confirm(
      'This will clear the session and all context. Continue?'
    );

    if (!confirmed) {
      console.log(chalk.dim('Reset cancelled\n'));
      return;
    }
  }

  // Kill tmux session if running
  if (status.isRunning) {
    console.log(chalk.dim('Stopping tmux session...'));
    try {
      execSync(`tmux kill-session -t "${status.tmuxSession}"`, { encoding: 'utf-8', stdio: 'ignore' });
      console.log(chalk.green('✓ Tmux session stopped'));
    } catch (error: any) {
      console.log(chalk.yellow('⚠ Failed to stop tmux session (may not be running)'));
    }
  }

  // Clear session file
  console.log(chalk.dim('Clearing session file...'));
  const cleared = clearSessionId(specialistName);

  if (cleared) {
    console.log(chalk.green('✓ Session file cleared'));
  } else {
    console.log(chalk.dim('No session file to clear'));
  }

  console.log(chalk.green(`\n✓ Specialist ${specialistName} has been reset`));
  console.log(chalk.dim('Next wake will start a fresh session\n'));
}

/**
 * Prompt user for confirmation
 */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`${question} [y/N] `), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
