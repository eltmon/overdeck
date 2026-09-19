import type { Command } from 'commander';
import { abortReviewCommand } from './abort-review.js';
import { requestReviewCommand } from './request-review.js';
import { reviewRestartCommand } from './review-restart.js';
import { reviewSpawnReviewerCommand } from './review-spawn-reviewer.js';

export function registerReviewCommands(program: Command): void {
  const review = program
    .command('review')
    .description('Review-loop management: request re-review, abort reviewers, restart a round');

  review
    .command('request <id>')
    .description('Request re-review after fixing feedback')
    .option('-m, --message <text>', 'Message describing the fixes applied')
    .action(requestReviewCommand);

  review
    .command('abort <id>')
    .description('Kill all running reviewer sessions and leave the worker idle')
    .action(abortReviewCommand);

  review
    .command('restart <id>')
    .description('Resume review and re-dispatch reviewers missing a report')
    .option('--model <model>', 'Override model for all reviewers (e.g. gpt-5.4, claude-sonnet-5)')
    .option('--role <role>', 'Restart only a specific reviewer role (correctness/security/performance/requirements)')
    .action(reviewRestartCommand);

  // PAN-1048 R5: `pan review run` was removed. Review now runs as the role
  // primitive; this hidden command is only for convoy sub-role dispatch.
  review
    .command('spawn-reviewer <id>', { hidden: true })
    .description('Internal: spawn one review convoy sub-role')
    .requiredOption('--sub-role <role>', 'Reviewer sub-role (security/correctness/performance/requirements)')
    .requiredOption('--run-id <id>', 'Review run ID')
    .option('--workspace <path>', 'Workspace path')
    .option('--output <path>', 'Reviewer output path')
    .option('--context <path>', 'Context manifest path')
    .option('--model <model>', 'Override reviewer model')
    .action(reviewSpawnReviewerCommand);
}
