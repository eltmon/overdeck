/**
 * pan specialists wake <name>
 *
 * Wake up a specialist agent
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import {
  getSpecialistStatus,
  getSessionId,
  getTmuxSessionName,
  recordWake,
  isEnabled,
  type SpecialistType,
} from '../../../lib/cloister/specialists.js';

interface WakeOptions {
  task?: string;
}

export function wakeCommand(name: string, options: WakeOptions): void {
  // Validate specialist name
  const validNames: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent'];
  if (!validNames.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${validNames.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const status = getSpecialistStatus(specialistName);

  console.log(chalk.bold(`\nWaking ${status.displayName}...\n`));

  // Check if already running
  if (status.isRunning) {
    console.log(chalk.yellow(`Specialist is already running in tmux session: ${status.tmuxSession}`));

    if (options.task) {
      console.log(chalk.dim('\nSending task message...'));
      try {
        const escapedTask = options.task.replace(/'/g, "'\\''");
        execSync(`tmux send-keys -t "${status.tmuxSession}" '${escapedTask}' C-m`, { encoding: 'utf-8' });
        console.log(chalk.green('✓ Task message sent'));
      } catch (error: any) {
        console.log(chalk.red(`Failed to send message: ${error.message}`));
      }
    } else {
      console.log(chalk.dim('Use --task to send a message to the running specialist'));
    }

    console.log('');
    return;
  }

  // Check if specialist is enabled
  if (!status.enabled) {
    console.log(chalk.yellow(`Warning: Specialist '${specialistName}' is disabled in registry`));
    console.log(chalk.dim('You can still wake it manually, but it won\'t auto-wake\n'));
  }

  // Get session ID (may be null for first time)
  const sessionId = getSessionId(specialistName);
  const tmuxSession = getTmuxSessionName(specialistName);
  const cwd = process.env.HOME || '/home/eltmon';

  try {
    // Build Claude command
    let claudeCmd = 'claude --dangerously-skip-permissions';

    if (sessionId) {
      claudeCmd += ` --resume ${sessionId}`;
      console.log(chalk.dim(`Resuming session: ${sessionId.substring(0, 8)}...`));
    } else {
      console.log(chalk.dim('Starting fresh session (no previous session found)'));
    }

    // Create tmux session
    console.log(chalk.dim(`Creating tmux session: ${tmuxSession}`));
    execSync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "${claudeCmd}"`,
      { encoding: 'utf-8' }
    );

    // Give Claude a moment to start
    execSync('sleep 2', { encoding: 'utf-8' });

    // Send task if provided
    if (options.task) {
      console.log(chalk.dim('Sending task message...'));
      const escapedTask = options.task.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t "${tmuxSession}" '${escapedTask}' C-m`, { encoding: 'utf-8' });
    }

    // Record wake event
    recordWake(specialistName);

    console.log(chalk.green(`✓ Specialist ${specialistName} woken up successfully`));
    console.log(chalk.dim(`  Tmux session: ${tmuxSession}`));
    console.log(chalk.dim(`  Attach with: tmux attach -t ${tmuxSession}`));
    console.log('');
  } catch (error: any) {
    console.log(chalk.red(`\nFailed to wake specialist: ${error.message}\n`));
    process.exit(1);
  }
}
