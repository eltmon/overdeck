/**
 * `pan flywheel start | stop | status` (PAN-3917 D12, FR-13).
 *
 * The flywheel is a conversation running the `pan-flywheel` skill, not a
 * service with a run record. There is no run state, no telemetry, no substrate
 * bug weights, and no parked report: the loop lives in the skill, its inputs
 * are the order books and the parked list under `.pan/`, and whether it is
 * running is answered by asking the terminal for its session.
 */

import { randomUUID } from 'node:crypto';

import chalk from 'chalk';
import { Command } from 'commander';
import { Effect } from 'effect';

import { loadConfigSync } from '../../lib/config-yaml/load.js';
import { resolveModel } from '../../lib/config-yaml/roles.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
import { resolveHarness } from '../../lib/harness-resolve.js';
import { createConversation } from '../../lib/overdeck/conversations.js';
import {
  spawnConversationSession,
  waitForConversationRuntimeReady,
  waitForTmuxSession,
} from '../../lib/overdeck/conversation-runtime.js';
import { killSession, sendKeysAsync, sessionExists } from '../../lib/tmux.js';

/** The one flywheel conversation. A second one would be a second orchestrator. */
export const FLYWHEEL_CONVERSATION_SESSION = 'conv-flywheel';

/** The skill the conversation runs. W10 ships v2. */
export const FLYWHEEL_SKILL_COMMAND = '/pan-flywheel';

export interface FlywheelStartOptions {
  model?: string;
  harness?: string;
  cwd?: string;
  /** Order book the flywheel should work from. Named in the opening prompt. */
  orders?: string;
}

export interface FlywheelStatusOptions {
  json?: boolean;
}

export async function flywheelStartCommand(options: FlywheelStartOptions = {}): Promise<void> {
  if (await Effect.runPromise(sessionExists(FLYWHEEL_CONVERSATION_SESSION))) {
    console.log(chalk.yellow(`The flywheel conversation is already running (${FLYWHEEL_CONVERSATION_SESSION}).`));
    console.log(chalk.dim(`  Stop it with: pan flywheel stop`));
    return;
  }

  const { config } = loadConfigSync();
  const cwd = options.cwd ?? process.cwd();
  const model = options.model ?? resolveModel('flywheel', undefined, config);
  const harness = await resolveHarness({ explicit: options.harness as RuntimeName | undefined, role: 'flywheel', model });

  // Register the conversation before the session exists, so the dashboard's
  // conversation list and the issue tree see it the moment it comes up. An
  // operator conversation carries no `issue` token (FR-5).
  const claudeSessionId = randomUUID();
  createConversation({
    name: FLYWHEEL_CONVERSATION_SESSION,
    tmuxSession: FLYWHEEL_CONVERSATION_SESSION,
    cwd,
    claudeSessionId,
    title: 'Flywheel',
    titleSource: 'manual',
    model,
    effort: 'high',
    harness,
  });

  await spawnConversationSession(
    FLYWHEEL_CONVERSATION_SESSION,
    cwd,
    claudeSessionId,
    model,
    'high',
    undefined,
    false,
    harness,
  );
  await waitForTmuxSession(FLYWHEEL_CONVERSATION_SESSION);
  await waitForConversationRuntimeReady(FLYWHEEL_CONVERSATION_SESSION, harness, 'spawn');

  // The loop is the skill. Hand it the slash command and let it run.
  const prompt = options.orders
    ? `${FLYWHEEL_SKILL_COMMAND} ${options.orders}`
    : FLYWHEEL_SKILL_COMMAND;
  await sendKeysAsync(FLYWHEEL_CONVERSATION_SESSION, prompt, 'pan flywheel start');
  await sendKeysAsync(FLYWHEEL_CONVERSATION_SESSION, 'Enter', 'pan flywheel start');

  console.log(chalk.green(`✓ Flywheel started in ${FLYWHEEL_CONVERSATION_SESSION} (${harness}, ${model})`));
  console.log(chalk.dim(`  Running ${prompt} in ${cwd}`));
}

/**
 * `pan orders start <book>` — the order book is an input to the flywheel, so
 * starting one starts the flywheel conversation and names the book.
 */
export async function startFlywheelRun(options: FlywheelStartOptions = {}): Promise<{ runId: string }> {
  await flywheelStartCommand(options);
  return { runId: FLYWHEEL_CONVERSATION_SESSION };
}

export async function flywheelStopCommand(): Promise<void> {
  if (!(await Effect.runPromise(sessionExists(FLYWHEEL_CONVERSATION_SESSION)))) {
    console.log(chalk.dim('The flywheel is not running.'));
    return;
  }
  await Effect.runPromise(killSession(FLYWHEEL_CONVERSATION_SESSION));
  console.log(chalk.green('✓ Flywheel stopped.'));
}

export async function flywheelStatusCommand(options: FlywheelStatusOptions = {}): Promise<void> {
  const running = await Effect.runPromise(sessionExists(FLYWHEEL_CONVERSATION_SESSION));
  if (options.json) {
    console.log(JSON.stringify({ running, session: FLYWHEEL_CONVERSATION_SESSION }, null, 2));
    return;
  }
  console.log(running
    ? chalk.green(`Flywheel running in ${FLYWHEEL_CONVERSATION_SESSION}.`)
    : chalk.dim('Flywheel not running.'));
}

export function registerFlywheelCommands(program: Command): void {
  const flywheel = program
    .command('flywheel')
    .description('Start, stop, or check the flywheel conversation');

  flywheel
    .command('start')
    .description(`Launch a conversation running ${FLYWHEEL_SKILL_COMMAND}`)
    .option('--model <model>', 'Model for the flywheel conversation')
    .option('--harness <harness>', 'Harness for the flywheel conversation')
    .option('--cwd <path>', 'Working directory (default: cwd)')
    .action(flywheelStartCommand);

  flywheel
    .command('stop')
    .description('Stop the flywheel conversation')
    .action(flywheelStopCommand);

  flywheel
    .command('status')
    .description('Say whether the flywheel conversation is running')
    .option('--json', 'Output as JSON')
    .action(flywheelStatusCommand);
}
