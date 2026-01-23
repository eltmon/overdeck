/**
 * pan specialists reset <name>
 * pan specialists reset --all
 *
 * Reset a specialist (clear session, start fresh)
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import {
  getSpecialistStatus,
  clearSessionId,
  getTmuxSessionName,
  type SpecialistType,
} from '../../../lib/cloister/specialists.js';

const execAsync = promisify(exec);

interface ResetOptions {
  force?: boolean;
  all?: boolean;
}

const ALL_SPECIALISTS: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent'];

export async function resetCommand(name: string | undefined, options: ResetOptions): Promise<void> {
  // Handle --all flag
  if (options.all) {
    await resetAllSpecialists(options);
    return;
  }

  // Validate specialist name
  if (!name) {
    console.log(chalk.red('\nError: Specialist name required'));
    console.log(`Usage: pan specialists reset <name> or pan specialists reset --all`);
    console.log(`Valid specialists: ${ALL_SPECIALISTS.join(', ')}\n`);
    process.exit(1);
  }

  if (!ALL_SPECIALISTS.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${ALL_SPECIALISTS.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const status = await getSpecialistStatus(specialistName);

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
      await execAsync(`tmux kill-session -t "${status.tmuxSession}"`, { encoding: 'utf-8' });
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

/**
 * Reset all specialists (wipe all context)
 */
async function resetAllSpecialists(options: ResetOptions): Promise<void> {
  console.log(chalk.bold('\nResetting ALL specialists...\n'));

  // Show current state for all specialists
  console.log(chalk.dim('Current state:'));
  for (const specialistName of ALL_SPECIALISTS) {
    const status = await getSpecialistStatus(specialistName);
    const stateIcon = status.isRunning ? chalk.yellow('●') : status.sessionId ? chalk.blue('●') : chalk.dim('○');
    const sessionInfo = status.sessionId ? ` (${status.sessionId.substring(0, 8)}...)` : '';
    console.log(`  ${stateIcon} ${specialistName}: ${status.state}${sessionInfo}`);
  }
  console.log('');

  // Confirm if not forced
  if (!options.force) {
    const confirmed = await confirm(
      'This will wipe ALL specialist sessions and context. Continue?'
    );

    if (!confirmed) {
      console.log(chalk.dim('Reset cancelled\n'));
      return;
    }
  }

  // Reset each specialist
  let resetCount = 0;
  for (const specialistName of ALL_SPECIALISTS) {
    const status = await getSpecialistStatus(specialistName);
    const tmuxSession = getTmuxSessionName(specialistName);

    // Kill tmux session if running
    if (status.isRunning) {
      try {
        await execAsync(`tmux kill-session -t "${tmuxSession}"`, { encoding: 'utf-8' });
        console.log(chalk.dim(`  Stopped ${specialistName} tmux session`));
      } catch {
        // Session may not exist
      }
    }

    // Clear session file
    const cleared = clearSessionId(specialistName);
    if (cleared || status.sessionId) {
      console.log(chalk.green(`  ✓ ${specialistName} reset`));
      resetCount++;
    } else {
      console.log(chalk.dim(`  ○ ${specialistName} (no session to clear)`));
    }
  }

  console.log(chalk.green(`\n✓ Reset ${resetCount} specialist(s)`));
  console.log(chalk.dim('Next wake will start fresh sessions\n'));
}
