import { describe, expect, it, vi } from 'vitest';

import type { PipelineJournalEntry } from '../../../../lib/cloister/pipeline-journal.js';
import { STALE_APPROVAL_ENTRY, rereviewStaleApproval, staleApprovalHead, type StaleApprovalFacts } from '../stale-approval-rereview.js';

const HEAD_B = '697a05f82000000000000000000000000000beef';
const WORKSPACE = '/repos/overdeck/workspaces/feature-pan-4759';

/** Approved at an older head; green and mergeable at HEAD_B (the PAN-4759 / #4768 shape). */
const STALE: StaleApprovalFacts = {
  forge: 'github', open: true, draft: false, changesRequested: false,
  approved: true, approvedAtHead: false, checks: 'green', mergeable: true, headSha: HEAD_B,
};

function journalWorld(initial: PipelineJournalEntry[] = []) {
  const journal = [...initial];
  const requestReview = vi.fn(async () => ({ kind: 'started' as const, autoRequeueCount: 0 }));
  const deps = {
    workspacePathFor: () => WORKSPACE,
    exists: () => true,
    readJournal: () => journal,
    appendEntry: vi.fn((_path: string, entry: Omit<PipelineJournalEntry, 'at'>) => {
      const stamped = { at: '2026-11-02T03:00:00.000Z', ...entry };
      journal.push(stamped);
      return stamped;
    }),
    requestReview,
  };
  return { deps, journal, requestReview };
}

describe('staleApprovalHead (PAN-4772)', () => {
  it('names the head of an approved PR whose approval is not proven at that head', () => {
    expect(staleApprovalHead(STALE)).toBe(HEAD_B);
  });

  it('is null when the approval stands, is absent, or something else blocks the merge', () => {
    expect(staleApprovalHead({ ...STALE, approvedAtHead: true })).toBeNull();
    expect(staleApprovalHead({ ...STALE, approved: false })).toBeNull();
    expect(staleApprovalHead({ ...STALE, changesRequested: true })).toBeNull();
    expect(staleApprovalHead({ ...STALE, draft: true })).toBeNull();
    expect(staleApprovalHead({ ...STALE, checks: 'pending' })).toBeNull();
    // Mergeability not computed yet is a missing read, not a stale approval.
    expect(staleApprovalHead({ ...STALE, mergeable: null })).toBeNull();
    expect(staleApprovalHead({ ...STALE, forge: 'gitlab' })).toBeNull();
  });
});

describe('rereviewStaleApproval (PAN-4772)', () => {
  it('requests review once for a stale head and journals the head', async () => {
    const { deps, journal, requestReview } = journalWorld();
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe('approval is stale at 697a05f8; review re-requested (started)');
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(requestReview).toHaveBeenCalledWith('PAN-4759', expect.stringContaining('697a05f8'));
    expect(journal.at(-1)).toMatchObject({ type: STALE_APPROVAL_ENTRY, issueId: 'PAN-4759', data: { head: HEAD_B, outcome: 'started' } });

    // The next tick at the same head asks nothing.
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe('approval is stale at 697a05f8; review already re-requested for this head');
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('requests again for a newer head', async () => {
    const { deps, requestReview } = journalWorld();
    await rereviewStaleApproval('PAN-4759', STALE, deps);
    await rereviewStaleApproval('PAN-4759', { ...STALE, headSha: 'c0ffee0000000000000000000000000000000000' }, deps);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it('does not request while a review is already running', async () => {
    const { deps, requestReview } = journalWorld([
      { at: '2026-11-02T02:50:00.000Z', type: 'review.requested', issueId: 'PAN-4759', source: 'pan-done' },
      { at: '2026-11-02T02:51:00.000Z', type: 'review.dispatched', issueId: 'PAN-4759', source: 'review-convoy' },
    ]);
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe('approval is stale at 697a05f8; a review is already running');
    expect(requestReview).not.toHaveBeenCalled();
  });

  // Review of #4783: only an answer that started (or found) a review latches
  // the head. Any other answer leaves it unlatched, so a later tick asks again.
  it.each([
    ['already-passed'], ['tests-requeued'], ['circuit-breaker'], ['no-workspace'],
    ['dirty-workspace'], ['no-project'], ['already-merged'],
  ] as const)('does not latch the head when the door answers %s', async (kind) => {
    const { deps, journal, requestReview } = journalWorld();
    requestReview.mockResolvedValueOnce({ kind, autoRequeueCount: 5, error: 'dirty' } as never);
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe(`approval is stale at 697a05f8; review not started (${kind}), will ask again`);
    expect(journal).toHaveLength(0);

    await rereviewStaleApproval('PAN-4759', STALE, deps);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it('latches the head when a review is already running', async () => {
    const { deps, journal, requestReview } = journalWorld();
    requestReview.mockResolvedValueOnce({ kind: 'already-running' } as never);
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe('approval is stale at 697a05f8; review re-requested (already-running)');
    expect(journal.at(-1)).toMatchObject({ type: STALE_APPROVAL_ENTRY, data: { head: HEAD_B, outcome: 'already-running' } });

    await rereviewStaleApproval('PAN-4759', STALE, deps);
    expect(requestReview).toHaveBeenCalledOnce();
  });

  it('ignores a journaled entry whose answer started no review', async () => {
    const { deps, requestReview } = journalWorld([{
      at: '2026-11-02T02:00:00.000Z', type: STALE_APPROVAL_ENTRY, issueId: 'PAN-4759',
      source: 'stale-approval', data: { head: HEAD_B, outcome: 'already-passed' },
    }]);
    await rereviewStaleApproval('PAN-4759', STALE, deps);
    expect(requestReview).toHaveBeenCalledOnce();
  });

  it('writes nothing when no review door is registered, so a later tick can still ask', async () => {
    const { deps, journal, requestReview } = journalWorld();
    requestReview.mockResolvedValueOnce(null as never);
    await expect(rereviewStaleApproval('PAN-4759', STALE, deps))
      .resolves.toBe('approval is stale at 697a05f8; no review door in this process');
    expect(journal).toHaveLength(0);
  });

  it('skips without a workspace', async () => {
    const { deps, requestReview } = journalWorld();
    await expect(rereviewStaleApproval('PAN-4759', STALE, { ...deps, exists: () => false }))
      .resolves.toBe('approval is stale at 697a05f8; no workspace to re-review it from');
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('answers null when the approval is not stale', async () => {
    const { deps, requestReview } = journalWorld();
    await expect(rereviewStaleApproval('PAN-4759', { ...STALE, approvedAtHead: true }, deps)).resolves.toBeNull();
    expect(requestReview).not.toHaveBeenCalled();
  });
});
