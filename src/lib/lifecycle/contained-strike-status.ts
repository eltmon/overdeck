import type { PanIssuePipelineRecord } from '../pan-dir/record.js';
import type { ReviewStatus } from '../review-status.js';

type Awaitable<T> = T | Promise<T>;

export const NEGATIVE_STRIKE_VERDICTS = new Set(['failed', 'blocked', 'dispatch_failed']);

export async function loadContainedStrikeStatus(
  issueId: string,
  deps: {
    getReviewStatus: (id: string) => Awaitable<ReviewStatus | null>;
    getJournalStatus: (id: string) => Awaitable<PanIssuePipelineRecord | null>;
  },
): Promise<ReviewStatus | null> {
  const [live, journal] = await Promise.all([
    Promise.resolve(deps.getReviewStatus(issueId)).catch(() => null),
    Promise.resolve(deps.getJournalStatus(issueId)).catch(() => null),
  ]);
  if (!live) return journal as ReviewStatus | null;
  if (!journal) return live;

  const reconciled = { ...live } as ReviewStatus;
  const target = reconciled as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(journal)) {
    if (target[key] === undefined && value !== undefined) target[key] = value;
  }

  // A negative durable verdict remains a blocker even when the cache projection
  // still carries an earlier non-terminal value. The matching strike marker at
  // the caller binds this journal evidence to the exact contained branch tip.
  if (NEGATIVE_STRIKE_VERDICTS.has(journal.reviewStatus)) {
    reconciled.reviewStatus = journal.reviewStatus as ReviewStatus['reviewStatus'];
  }
  if (NEGATIVE_STRIKE_VERDICTS.has(journal.testStatus)) {
    reconciled.testStatus = journal.testStatus as ReviewStatus['testStatus'];
  }
  if (NEGATIVE_STRIKE_VERDICTS.has(journal.verificationStatus ?? '')) {
    reconciled.verificationStatus = journal.verificationStatus as ReviewStatus['verificationStatus'];
  }
  return reconciled;
}
