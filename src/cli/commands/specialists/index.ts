/**
 * Specialists CLI Commands
 *
 * pan specialists <command>
 */

import { Command } from 'commander';
import { lazyAction } from '../../lazy-action.js';

export function registerSpecialistsCommands(program: Command): void {
  const specialists = program
    .command('specialists')
    .description('Manage specialist agents (review-agent, test-agent, merge-agent)');

  // pan specialists list
  specialists
    .command('list')
    .description('Show all specialists with their status')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./list.js'), 'listCommand'));

  // pan specialists wake <name>
  specialists
    .command('wake <name>')
    .description('Wake up a specialist agent (for testing/debugging)')
    .option('--task <description>', 'Optional task description to wake with')
    .action(lazyAction(() => import('./wake.js'), 'wakeCommand'));

  // pan specialists reset <name> or pan specialists reset --all
  specialists
    .command('reset [name]')
    .description('Reset a specialist (clear session, start fresh)')
    .option('--force', 'Skip confirmation prompt')
    .option('--all', 'Reset ALL specialists (wipe all context)')
    .action(lazyAction(() => import('./reset.js'), 'resetCommand'));

  // pan specialists done <type> <issueId> --status <passed|failed|blocked> [--notes "..."]
  specialists
    .command('done <type> <issueId>')
    .description('Post a specialist verdict to the issue\'s pull/merge request (review, test, uat)')
    .requiredOption('--status <status>', 'Result status: passed, failed, or review-only blocked')
    .option('--notes <notes>', 'Optional notes about the result')
    .option('--uat-status <status>', 'Test only: required browser UAT result (passed or failed)')
    .option('--uat-notes <notes>', 'Test only: browser UAT evidence or blocking condition')
    .option('--tested-sha <sha>', 'Test/UAT only: the commit the run exercised (git rev-parse HEAD before the gates)')
    .option('--run-id <runId>', 'Review cycle ID used to deduplicate review feedback')
    .action(lazyAction(() => import('./done.js'), 'doneAndExitCommand'));
}
