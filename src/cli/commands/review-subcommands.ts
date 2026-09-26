import type { Command } from 'commander';
import { lazyAction } from '../lazy-action.js';

export function registerReviewCommands(program: Command): void {
  const review = program
    .command('review')
    .description('Review-loop management: request re-review, abort reviewers, restart a round');

  review
    .command('request <id>')
    .description('Request re-review after fixing feedback')
    .option('-m, --message <text>', 'Message describing the fixes applied')
    .action(lazyAction(() => import('./request-review.js'), 'requestReviewCommand'));

  review
    .command('abort <id>')
    .description('Kill all running reviewer sessions and leave the worker idle')
    .action(lazyAction(() => import('./abort-review.js'), 'abortReviewCommand'));

  review
    .command('restart <id>')
    .description('Resume review and re-dispatch reviewers missing a report')
    .option('--model <model>', 'Override model for all reviewers (e.g. gpt-5.4, claude-sonnet-5)')
    .option('--role <role>', 'Restart only a specific reviewer role (correctness/security/performance/requirements)')
    .action(lazyAction(() => import('./review-restart.js'), 'reviewRestartCommand'));

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
    .action(lazyAction(() => import('./review-spawn-reviewer.js'), 'reviewSpawnReviewerCommand'));
}
