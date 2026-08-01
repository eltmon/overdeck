import type { Command } from 'commander';
import { abortReviewCommand } from './abort-review.js';
import { pendingCommand } from './pending.js';
import { requestReviewCommand } from './request-review.js';
import { resetReviewCommand } from './reset-review.js';
import { resyncReviewCommand } from './resync-review.js';
import { reviewModeCommand, reviewScopeCommand } from './review-mode.js';
import { reviewRestartCommand } from './review-restart.js';
import { reviewSpawnReviewerCommand } from './review-spawn-reviewer.js';

export function registerReviewCommands(program: Command): void {
  const review = program
    .command('review')
    .description('Review-loop management: pending items, request re-review, reset cycles');

  review
    .command('pending')
    .description('List completed work awaiting review')
    .option('--ready', 'List issues ready for merge (review+test green, not merged) regardless of origin')
    .option('--blocked', 'List issues blocked in review/test/merge from the SQLite review-status store')
    .action(pendingCommand);

  review
    .command('request <id>')
    .description('Request re-review after fixing feedback')
    .option('-m, --message <text>', 'Message describing the fixes applied')
    .action(requestReviewCommand);

  review
    .command('reset <id>')
    .description('Reset review/test/merge cycles (human override)')
    .option('--session', 'Also clear all saved Claude review-session pointers')
    .action(resetReviewCommand);

  review
    .command('resync <id>')
    .description('Re-emit canonical review status (heal a lost pipeline event)')
    .action(resyncReviewCommand);

  review
    .command('abort <id>')
    .description('Kill all running reviewer sessions and leave the worker idle')
    .action(abortReviewCommand);

  review
    .command('mode <id> <mode>')
    .description('Set per-issue review mode (quick, full, or none)')
    .action(reviewModeCommand);

  review
    .command('scope <id> <scope>')
    .description('Set per-issue re-review scope (all, changed, or blockers) — which convoy reviewers re-run (PAN-1874)')
    .action(reviewScopeCommand);

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
