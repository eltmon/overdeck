import chalk from 'chalk';
import { listRunningAgentsSync } from '../../lib/agents.js';
import { getAllReviewStatusesFromDb } from '../../lib/database/review-status-db.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from '../../lib/paths.js';
import type { ReviewStatus } from '../../lib/review-status.js';

const REVIEW_BLOCKED_STATUSES = new Set(['failed', 'blocked']);
const TEST_BLOCKED_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_BLOCKED_STATUSES = new Set(['failed']);

function blockerKind(status: ReviewStatus): string | null {
  const blockerTypes = status.blockerReasons?.map(reason => reason.type) ?? [];
  if (blockerTypes.length > 0) return blockerTypes.join(',');
  if (REVIEW_BLOCKED_STATUSES.has(status.reviewStatus)) return `review=${status.reviewStatus}`;
  if (TEST_BLOCKED_STATUSES.has(status.testStatus)) return `test=${status.testStatus}`;
  if (MERGE_BLOCKED_STATUSES.has(status.mergeStatus ?? '')) return `merge=${status.mergeStatus}`;
  if (status.stuck) return status.stuckReason ? `stuck=${status.stuckReason}` : 'stuck';
  return null;
}

export async function pendingCommand(options: { ready?: boolean; blocked?: boolean } = {}): Promise<void> {
  const allStatuses = getAllReviewStatusesFromDb();

  if (options.ready) {
    // Mergeable work regardless of origin — review+test green, not merged.
    // Used by the flywheel tick to adopt externally-completed issues into
    // the merge queue (PAN-1735).
    const ready = Object.values(allStatuses).filter(
      s => s.readyForMerge && s.mergeStatus !== 'merged'
    );
    if (ready.length === 0) {
      console.log(chalk.dim('No issues are ready for merge.'));
      return;
    }
    console.log(chalk.bold('\nReady for Merge\n'));
    for (const status of ready) {
      console.log(`${chalk.green(status.issueId)}  review=${status.reviewStatus} test=${status.testStatus}${status.prUrl ? `  ${chalk.dim(status.prUrl)}` : ''}`);
    }
    console.log('');
    return;
  }

  if (options.blocked) {
    const blocked = Object.values(allStatuses)
      .map(status => ({ status, kind: blockerKind(status) }))
      .filter((entry): entry is { status: ReviewStatus; kind: string } => entry.kind !== null);
    if (blocked.length === 0) {
      console.log(chalk.dim('No blocked reviews/tests/merges.'));
      return;
    }
    console.log(chalk.bold('\nBlocked Reviews / Tests / Merges\n'));
    for (const { status, kind } of blocked) {
      console.log(`${chalk.red(status.issueId)}  ${kind}  review=${status.reviewStatus} test=${status.testStatus} merge=${status.mergeStatus ?? 'pending'}${status.prUrl ? `  ${chalk.dim(status.prUrl)}` : ''}`);
    }
    console.log('');
    return;
  }

  const pending = Object.values(allStatuses).filter(s => s.reviewStatus === 'pending');

  if (pending.length === 0) {
    console.log(chalk.dim('No pending reviews.'));
    console.log(chalk.dim('Agents will appear here when they complete work.'));
    return;
  }

  const agents = listRunningAgentsSync();
  const agentByIssue = new Map(agents.map(a => [a.issueId.toLowerCase(), a]));

  console.log(chalk.bold('\nPending Reviews\n'));

  for (const status of pending) {
    const agent = agentByIssue.get(status.issueId.toLowerCase());
    console.log(`${chalk.cyan(status.issueId)}`);
    if (agent) {
      console.log(`  Agent:     ${agent.id}`);
      console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);

      const completionFile = join(AGENTS_DIR, agent.id, 'completion.md');
      if (existsSync(completionFile)) {
        const content = readFileSync(completionFile, 'utf8');
        const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (firstLine) {
          console.log(`  Summary:   ${chalk.dim(firstLine.trim())}`);
        }
      }
    }
    console.log('');
  }

  console.log(chalk.dim('When review passes, click MERGE in the dashboard.'));
}
