/**
 * Specialists CLI Commands
 *
 * pan specialists <command>
 */

import { Command } from 'commander';
import { listCommand } from './list.js';
import { wakeCommand } from './wake.js';
import { resetCommand } from './reset.js';
import { doneAndExitCommand } from './done.js';
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

  // pan specialists discovery-ready review <issueId> — PAN-1862 Phase A signal
  specialists
    .command('discovery-ready <type> <issueId>')
    .description('Signal that the review parent finished shared discovery — forks + launches the convoy (PAN-1862)')
    .action(async (type: string, issueId: string) => {
      if (type !== 'review') {
        console.error(`discovery-ready only applies to the review specialist (got '${type}')`);
        process.exit(1);
      }
      const { handleReviewDiscoveryReady } = await import('../../../lib/cloister/review-agent.js');
      const result = await handleReviewDiscoveryReady(issueId, { source: 'cli-signal' });
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    });

  // pan specialists done <type> <issueId> --status <passed|failed|blocked> [--notes "..."]
  specialists
    .command('done <type> <issueId>')
    .description('Signal specialist completion (deterministic status update)')
    .requiredOption('--status <status>', 'Result status: passed, failed, or review-only blocked')
    .option('--item <itemId>', 'vBRIEF item ID (required for inspect verdicts)')
    .option('--notes <notes>', 'Optional notes about the result')
    .option('--reviewers <verdicts>', 'PAN-1862 (review only): per-reviewer verdicts, e.g. "security=passed,correctness=blocked"')
    .action(doneAndExitCommand);

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
