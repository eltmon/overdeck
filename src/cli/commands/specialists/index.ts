/**
 * Specialists CLI Commands
 *
 * pan specialists <command>
 */

import { Command } from 'commander';
import { listCommand } from './list.js';
import { wakeCommand } from './wake.js';
import { resetCommand } from './reset.js';
import { doneCommand } from './done.js';
import { logsCommand, cleanupLogsCommand } from './logs.js';

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

  // pan specialists reset <name> or pan specialists reset --all
  specialists
    .command('reset [name]')
    .description('Reset a specialist (clear session, start fresh)')
    .option('--force', 'Skip confirmation prompt')
    .option('--all', 'Reset ALL specialists (wipe all context)')
    .action(resetCommand);

  // pan specialists done <type> <issueId> --status <passed|failed|blocked> [--notes "..."]
  specialists
    .command('done <type> <issueId>')
    .description('Signal specialist completion (deterministic status update)')
    .requiredOption('--status <status>', 'Result status: passed, failed, or review-only blocked')
    .option('--notes <notes>', 'Optional notes about the result')
    .action(doneCommand);

  // pan specialists logs <project> <type> [runId]
  specialists
    .command('logs [project] [type] [runId]')
    .description('View specialist run logs')
    .option('--json', 'Output in JSON format')
    .option('--limit <count>', 'Number of runs to show (default: 10)')
    .option('--tail', 'Follow active run log in real-time')
    .action(logsCommand);

  // pan specialists cleanup-logs <project> <type> or --all
  specialists
    .command('cleanup-logs [project] [type]')
    .description('Clean up old specialist logs')
    .option('--force', 'Skip confirmation prompt')
    .option('--all', 'Clean up logs for all projects')
    .action(cleanupLogsCommand);
}
