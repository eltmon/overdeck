/**
 * Specialists CLI Commands
 *
 * pan specialists <command>
 */

import { Command } from 'commander';
import { listCommand } from './list.js';
import { wakeCommand } from './wake.js';
import { queueCommand } from './queue.js';
import { resetCommand } from './reset.js';
import { clearQueueCommand } from './clear-queue.js';

export function registerSpecialistsCommands(program: Command): void {
  const specialists = program
    .command('specialists')
    .description('Manage specialist agents (review-agent, test-agent, merge-agent)');

  // pan specialists list
  specialists
    .command('list')
    .description('Show all specialists with their status')
    .option('--json', 'Output in JSON format')
    .action(listCommand);

  // pan specialists wake <name>
  specialists
    .command('wake <name>')
    .description('Wake up a specialist agent (for testing/debugging)')
    .option('--task <description>', 'Optional task description to wake with')
    .action(wakeCommand);

  // pan specialists queue <name>
  specialists
    .command('queue <name>')
    .description('Show pending work in a specialist\'s queue')
    .option('--json', 'Output in JSON format')
    .action(queueCommand);

  // pan specialists reset <name> or pan specialists reset --all
  specialists
    .command('reset [name]')
    .description('Reset a specialist (clear session, start fresh)')
    .option('--force', 'Skip confirmation prompt')
    .option('--all', 'Reset ALL specialists (wipe all context)')
    .action(resetCommand);

  // pan specialists clear-queue <name>
  specialists
    .command('clear-queue <name>')
    .description('Clear all items from a specialist\'s queue')
    .option('--force', 'Skip confirmation prompt')
    .option('--reset-status', 'Reset review statuses to pending')
    .action(clearQueueCommand);
}
