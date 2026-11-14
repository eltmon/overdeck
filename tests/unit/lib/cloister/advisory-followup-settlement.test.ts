import { describe, expect, it } from 'vitest';

import {
  advisoryCandidates,
  isAdvisoryCandidateClosed,
  settleAdvisoryDelivery,
  threadIdsNamedInNote,
  type AdvisoryThreadRecord,
  type PullRequestSettlementFacts,
} from '../../../../src/lib/cloister/advisory-followup-settlement.js';
import type { PipelineJournalEntry } from '../../../../src/lib/cloister/pipeline-journal.js';

const T0 = '2026-11-13T21:00:00.000Z';
const BEFORE = '2026-11-13T20:59:00.000Z';
const AFTER = '2026-11-13T21:05:00.000Z';

const NO_FACTS: PullRequestSettlementFacts = { commits: [], repliedThreadIds: [] };

function thread(id: number, path?: string): AdvisoryThreadRecord {
  return { id, ...(path ? { path, line: 10 } : {}), severity: 'Major', title: `finding ${id}` };
}

function delivered(reviewId: number, threads: AdvisoryThreadRecord[], at = T0): PipelineJournalEntry {
  return {
    at,
    type: 'feedback.delivered',
    issueId: 'PAN-1',
    source: 'coderabbit-feedback',
    data: {
      kind: 'coderabbit', dedupKey: `coderabbit-feedback:pan-1:${reviewId}`, agentId: 'agent-pan-1',
      repo: 'eltmon/overdeck', prNumber: 42, reviewId, threads,
    },
  };
}

function entry(type: PipelineJournalEntry['type'], at: string, data: Record<string, unknown>): PipelineJournalEntry {
  return { at, type, issueId: 'PAN-1', data };
}

function reviewRequested(note: string, at = AFTER): PipelineJournalEntry {
  return entry('review.requested', at, { note });
}

function threadIds(result: ReturnType<typeof settleAdvisoryDelivery>): number[] {
  return result.outcome === 'unsettled' ? result.threads.map((t) => t.id) : [];
}

describe('settleAdvisoryDelivery: delivery-level rows', () => {
  it('returns already-filed / already-failed before reading any facts', () => {
    const candidate = delivered(5, [thread(11)]);
    const throwingFacts = {
      get commits(): never { throw new Error('read facts'); },
      get repliedThreadIds(): never { throw new Error('read facts'); },
    } as unknown as PullRequestSettlementFacts;
    const filed = entry('feedback.followup_filed', AFTER, { kind: 'coderabbit', dedupKey: 'coderabbit-feedback:pan-1:5' });
    const failed = entry('feedback.followup_failed', AFTER, { kind: 'coderabbit', dedupKey: 'coderabbit-feedback:pan-1:5' });
    expect(settleAdvisoryDelivery(candidate, [candidate, filed], throwingFacts).outcome).toBe('already-filed');
    expect(settleAdvisoryDelivery(candidate, [candidate, failed], throwingFacts).outcome).toBe('already-failed');
    expect(isAdvisoryCandidateClosed([candidate, failed], 'coderabbit-feedback:pan-1:5')).toBe(true);
    expect(isAdvisoryCandidateClosed([candidate], 'coderabbit-feedback:pan-1:5')).toBe(false);
  });

  it('returns legacy for an entry without data.threads', () => {
    const legacy = entry('feedback.delivered', T0, { kind: 'coderabbit', dedupKey: 'k', agentId: 'a' });
    expect(settleAdvisoryDelivery(legacy, [legacy], NO_FACTS).outcome).toBe('legacy');
  });

  it('returns settled when no thread is left', () => {
    const candidate = delivered(5, [thread(11)]);
    expect(settleAdvisoryDelivery(candidate, [candidate], { commits: [], repliedThreadIds: [11] }).outcome).toBe('settled');
  });
});

describe('settleAdvisoryDelivery: per-thread evidence', () => {
  it('T: a non-CodeRabbit reply settles only its thread', () => {
    const candidate = delivered(5, [thread(11), thread(12)]);
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], { commits: [], repliedThreadIds: [12] }))).toEqual([11]);
  });

  it('P: a later commit settles a thread on its path only', () => {
    const candidate = delivered(5, [thread(11, 'src/a.ts')]);
    const toB = { commits: [{ sha: 'b', authoredAt: AFTER, files: ['src/b.ts'] }], repliedThreadIds: [] };
    const toA = { commits: [{ sha: 'a', authoredAt: AFTER, files: ['src/a.ts'] }], repliedThreadIds: [] };
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], toB))).toEqual([11]);
    expect(settleAdvisoryDelivery(candidate, [candidate], toA).outcome).toBe('settled');
  });

  it('P: a commit authored before the delivery but rebased after it settles nothing', () => {
    // The fetch reports author dates, which a rebase keeps; this is the replayed commit's author date.
    const candidate = delivered(5, [thread(11, 'src/a.ts')]);
    const rebased = { commits: [{ sha: 'r', authoredAt: BEFORE, files: ['src/a.ts'] }], repliedThreadIds: [] };
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], rebased))).toEqual([11]);
  });

  it('P: an earlier commit settles nothing', () => {
    const candidate = delivered(5, [thread(11, 'src/a.ts')]);
    const facts = { commits: [{ sha: 'a', authoredAt: BEFORE, files: ['src/a.ts'] }], repliedThreadIds: [] };
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], facts))).toEqual([11]);
  });

  it('R: a later re-review note naming the thread id settles it', () => {
    const candidate = delivered(5, [thread(11), thread(12)]);
    const journal = [candidate, reviewRequested('Agent re-review request (1/3): CodeRabbit 12: guarded it')];
    expect(threadIds(settleAdvisoryDelivery(candidate, journal, NO_FACTS))).toEqual([11]);
  });

  it('R: an earlier note, or a note naming another id, settles nothing', () => {
    const candidate = delivered(5, [thread(11)]);
    const earlier = [reviewRequested('CodeRabbit 11: fixed', BEFORE), candidate];
    const other = [candidate, reviewRequested('Agent re-review request (1/3): CodeRabbit 12: fixed')];
    expect(threadIds(settleAdvisoryDelivery(candidate, earlier, NO_FACTS))).toEqual([11]);
    expect(threadIds(settleAdvisoryDelivery(candidate, other, NO_FACTS))).toEqual([11]);
  });

  it('R: thread ids match exactly, so 111 never settles 11', () => {
    const candidate = delivered(5, [thread(11), thread(111)]);
    const journal = [candidate, reviewRequested('Agent re-review request (2/3): CodeRabbit 111: fixed thread 11 too')];
    expect(threadIds(settleAdvisoryDelivery(candidate, journal, NO_FACTS))).toEqual([11]);
    expect([...threadIdsNamedInNote('CodeRabbit #21, 22: x; CodeRabbit 7: y')]).toEqual([21, 22, 7]);
  });

  it('the worked two-review case: only the thread with evidence is settled', () => {
    const reviewA = delivered(100, [thread(11, 'src/a.ts')]);
    const reviewB = delivered(200, [thread(21, 'src/b.ts')]);
    const journal = [reviewA, reviewB, reviewRequested('Agent re-review request (1/3): CodeRabbit 21: guarded b')];
    const facts = { commits: [{ sha: 'b', authoredAt: AFTER, files: ['src/b.ts'] }], repliedThreadIds: [] };
    expect(settleAdvisoryDelivery(reviewB, journal, facts).outcome).toBe('settled');
    const a = settleAdvisoryDelivery(reviewA, journal, facts);
    expect(a.outcome).toBe('unsettled');
    expect(threadIds(a)).toEqual([11]);
  });

  it('failed reads count as no evidence', () => {
    const candidate = delivered(5, [thread(11, 'src/a.ts'), thread(12, 'src/b.ts')]);
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], { commits: null, repliedThreadIds: null }))).toEqual([11, 12]);
    const unreadCommit = { commits: [{ sha: 'a', authoredAt: AFTER, files: null }], repliedThreadIds: [] };
    expect(threadIds(settleAdvisoryDelivery(candidate, [candidate], unreadCommit))).toEqual([11, 12]);
  });
});

describe('advisoryCandidates', () => {
  it('keeps the latest entry per key and ignores non-advisory kinds', () => {
    const first = entry('feedback.undelivered', T0, { kind: 'coderabbit', dedupKey: 'k1', reason: 'no agent', threads: [] });
    const second = entry('feedback.delivered', AFTER, { kind: 'coderabbit', dedupKey: 'k1', threads: [] });
    const review = entry('feedback.delivered', T0, { kind: 'review', dedupKey: 'r1' });
    const other = entry('feedback.delivered', BEFORE, { kind: 'coderabbit', dedupKey: 'k2', threads: [] });
    expect(advisoryCandidates([first, review, other, second])).toEqual([other, second]);
  });
});
