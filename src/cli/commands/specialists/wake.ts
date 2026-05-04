/**
 * pan specialists wake <name>
 *
 * Wake up a specialist agent
 */

import chalk from 'chalk';
import { setTimeout as sleep } from 'timers/promises';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getSpecialistStatus,
  getSessionId,
  getTmuxSessionName,
  recordWake,
  isEnabled,
  type SpecialistType,
} from '../../../lib/cloister/specialists.js';
import { PANOPTICON_HOME } from '../../../lib/paths.js';
import { createSessionAsync, sendKeys } from '../../../lib/tmux.js';

const TASKS_DIR = join(PANOPTICON_HOME, 'specialists', 'tasks');

/**
 * Send a task to a specialist via tmux
 * For large prompts, writes to a file to avoid tmux paste issues
 */
function sendTask(tmuxSession: string, specialistName: string, task: string): void {
  const isLargeTask = task.length > 500 || task.includes('\n');

  if (isLargeTask) {
    // Write to file to avoid tmux paste issues ("[Pasted text #1 +N lines]")
    if (!existsSync(TASKS_DIR)) {
      mkdirSync(TASKS_DIR, { recursive: true });
    }
    const taskFile = join(TASKS_DIR, `${specialistName}-${Date.now()}.md`);
    writeFileSync(taskFile, task, 'utf-8');

    const shortMessage = `Read and execute the task in: ${taskFile}`;
    sendKeys(tmuxSession, shortMessage);
  } else {
    sendKeys(tmuxSession, task);
  }
}

interface WakeOptions {
  task?: string;
}

export async function wakeCommand(name: string, options: WakeOptions): Promise<void> {
  // Validate specialist name
  const validNames: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent', 'inspect-agent', 'uat-agent'];
  if (!validNames.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${validNames.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const status = await getSpecialistStatus(specialistName);

  console.log(chalk.bold(`\nWaking ${status.displayName}...\n`));

  // Check if already running
  if (status.isRunning) {
    console.log(chalk.yellow(`Specialist is already running in tmux session: ${status.tmuxSession}`));

    if (options.task) {
      console.log(chalk.dim('\nSending task message...'));
      try {
        await sendTask(status.tmuxSession!, specialistName, options.task);
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
    let claudeCmd = 'claude --dangerously-skip-permissions --permission-mode bypassPermissions';

    if (sessionId) {
      claudeCmd += ` --resume ${sessionId}`;
      console.log(chalk.dim(`Resuming session: ${sessionId.substring(0, 8)}...`));
    } else {
      console.log(chalk.dim('Starting fresh session (no previous session found)'));
    }

    console.log(`[claude-invoke] purpose=cli-specialist-wake | model=default | source=specialists/wake.ts | session=${tmuxSession} | specialist=${specialistName} | command="${claudeCmd}"`);

    // Create tmux session
    console.log(chalk.dim(`Creating tmux session: ${tmuxSession}`));
    await createSessionAsync(tmuxSession, cwd, claudeCmd);

    // Give Claude a moment to start
    await sleep(2000);

    // Send task if provided
    if (options.task) {
      console.log(chalk.dim('Sending task message...'));
      await sendTask(tmuxSession, specialistName, options.task);
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
