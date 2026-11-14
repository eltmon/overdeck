/**
 * PAN-5218: the post-merge filer files one follow-up per unsettled advisory
 * delivery, never twice, and raises Needs-you whenever it cannot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdvisoryThreadRecord, PullRequestSettlementFacts } from '../../../../src/lib/cloister/advisory-followup-settlement.js';
import {
  __resetAdvisoryFollowupsForTests,
  fileAdvisoryFollowups,
  type AdvisoryFollowupDeps,
} from '../../../../src/lib/cloister/advisory-followup.js';
import type { PipelineJournalEntry } from '../../../../src/lib/cloister/pipeline-journal.js';

const WS = '/projects/overdeck/workspaces/feature-pan-1';
const DELIVERED_AT = '2026-11-13T21:00:37.000Z';
const MERGED_AT = '2026-11-13T21:10:53.000Z';
const LATER = '2026-11-13T21:05:00.000Z';

function thread(id: number, path?: string): AdvisoryThreadRecord {
  return { id, ...(path ? { path, line: id } : {}), severity: 'Major', title: `finding ${id}`, url: `https://github.com/x/${id}` };
}

function candidate(reviewId: number, threads: AdvisoryThreadRecord[], overrides: Partial<PipelineJournalEntry> = {}, extra: Record<string, unknown> = {}): PipelineJournalEntry {
  return {
    at: DELIVERED_AT,
    type: 'feedback.delivered',
    issueId: 'PAN-1',
    source: 'coderabbit-feedback',
    data: {
      kind: 'coderabbit', dedupKey: `coderabbit-feedback:pan-1:${reviewId}`, agentId: 'agent-pan-1',
      repo: 'eltmon/overdeck', prNumber: 42, reviewId,
      reviewUrl: `https://github.com/eltmon/overdeck/pull/42#pullrequestreview-${reviewId}`, threads, ...extra,
    },
    ...overrides,
  };
}

const MERGED: PipelineJournalEntry = { at: MERGED_AT, type: 'merge.completed', issueId: 'PAN-1', source: 'post-merge-lifecycle' };
const NO_FACTS: PullRequestSettlementFacts = { commits: [], repliedThreadIds: [] };

function harness(journal: PipelineJournalEntry[], overrides: Partial<AdvisoryFollowupDeps> = {}) {
  const deps = {
    readJournal: vi.fn(() => [...journal]),
    fetchFacts: vi.fn(async () => NO_FACTS),
    resolveTrackerRepo: vi.fn(() => ({ owner: 'eltmon', repo: 'overdeck' })),
    appConfigured: vi.fn(() => true),
    findExisting: vi.fn(async () => null),
    createIssue: vi.fn(async () => ({ number: 5300, url: 'https://github.com/eltmon/overdeck/issues/5300' })),
    appendEntry: vi.fn((_ws: string, entry: Omit<PipelineJournalEntry, 'at'>) => {
      const stamped = { at: '2026-11-13T21:11:00.000Z', ...entry } as PipelineJournalEntry;
      journal.push(stamped);
      return stamped;
    }),
    surfaceNeedsYou: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
  return deps as typeof deps & AdvisoryFollowupDeps;
}

function appendedTypes(deps: ReturnType<typeof harness>): string[] {
  return deps.appendEntry.mock.calls.map(([, entry]) => entry.type);
}

function createdBody(deps: ReturnType<typeof harness>): string {
  return (deps.createIssue.mock.calls[0] as unknown as [string, string, { body: string }])[2].body;
}

beforeEach(() => __resetAdvisoryFollowupsForTests());

describe('fileAdvisoryFollowups', () => {
  it('files exactly one issue for an unsettled delivery, and never again on the grown journal', async () => {
    const journal = [candidate(900, [thread(11, 'src/a.ts'), thread(12, 'src/b.ts')]), MERGED];
    const deps = harness(journal);

    const outcomes = await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(outcomes).toEqual([{
      dedupKey: 'coderabbit-feedback:pan-1:900', outcome: 'filed', issueNumber: 5300,
      issueUrl: 'https://github.com/eltmon/overdeck/issues/5300', recovered: false,
    }]);
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
    expect(deps.createIssue).toHaveBeenCalledWith('eltmon', 'overdeck', expect.objectContaining({
      title: 'CodeRabbit follow-up for PAN-1 (PR #42): 2 unsettled finding(s)',
    }));
    const body = createdBody(deps);
    expect(body).toContain('- `src/a.ts:11` [Major] finding 11 (https://github.com/x/11)');
    expect(body).toContain('They were relayed to agent-pan-1 at 2026-11-13T21:00:37.000Z');
    expect(body).toContain('Delivery key: `coderabbit-feedback:pan-1:900`.');
    expect(deps.appendEntry).toHaveBeenCalledTimes(1);
    expect(deps.appendEntry).toHaveBeenCalledWith(WS, expect.objectContaining({
      type: 'feedback.followup_filed',
      data: expect.objectContaining({ dedupKey: 'coderabbit-feedback:pan-1:900', issueNumber: 5300, threads: 2 }),
    }));

    __resetAdvisoryFollowupsForTests();
    const again = harness(journal);
    await expect(fileAdvisoryFollowups('PAN-1', WS, again)).resolves.toEqual([
      { dedupKey: 'coderabbit-feedback:pan-1:900', outcome: 'already-filed' },
    ]);
    expect(again.createIssue).not.toHaveBeenCalled();
    expect(again.fetchFacts).not.toHaveBeenCalled();
  });

  it('files nothing when every thread is settled, and never re-reads the forge for it', async () => {
    const journal = [candidate(900, [thread(11, 'src/a.ts'), thread(12, 'src/b.ts')]), MERGED];
    const deps = harness(journal, {
      fetchFacts: vi.fn(async () => ({ commits: [{ sha: 's', authoredAt: LATER, files: ['src/b.ts'] }], repliedThreadIds: [11] })),
    });

    await expect(fileAdvisoryFollowups('PAN-1', WS, deps)).resolves.toEqual([
      { dedupKey: 'coderabbit-feedback:pan-1:900', outcome: 'settled' },
    ]);
    expect(deps.createIssue).not.toHaveBeenCalled();

    await fileAdvisoryFollowups('PAN-1', WS, deps);
    expect(deps.fetchFacts).toHaveBeenCalledTimes(1);
  });

  it('lists only the unsettled thread when one of two is settled', async () => {
    const deps = harness([candidate(900, [thread(11, 'src/a.ts'), thread(12, 'src/b.ts')]), MERGED], {
      fetchFacts: vi.fn(async () => ({ commits: [], repliedThreadIds: [12] })),
    });

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    const body = createdBody(deps);
    expect(body).toContain('finding 11');
    expect(body).not.toContain('finding 12');
  });

  it('repairs the journal from an existing issue instead of creating a second one', async () => {
    const deps = harness([candidate(900, [thread(11)]), MERGED], {
      findExisting: vi.fn(async () => ({ number: 9, url: 'https://github.com/eltmon/overdeck/issues/9' })),
    });

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(deps.appendEntry).toHaveBeenCalledWith(WS, expect.objectContaining({
      type: 'feedback.followup_filed', data: expect.objectContaining({ issueNumber: 9, recovered: true }),
    }));
  });

  it('raises Needs-you and creates nothing when the duplicate check fails', async () => {
    const deps = harness([candidate(900, [thread(11)]), MERGED], {
      findExisting: vi.fn(async () => { throw new Error('gh: 502'); }),
    });

    const [outcome] = await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(outcome).toMatchObject({ outcome: 'needs-you', reason: expect.stringContaining('duplicate check') });
    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(appendedTypes(deps)).toEqual(['feedback.followup_failed']);
  });

  it('raises Needs-you naming the missing Issues permission when the App is refused', async () => {
    const deps = harness([candidate(900, [thread(11, 'src/a.ts')]), MERGED], {
      createIssue: vi.fn(async () => { throw new Error('GitHub API POST /repos/o/r/issues failed: 403 Resource not accessible by integration'); }),
    });

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(deps.surfaceNeedsYou).toHaveBeenCalledWith(
      'PAN-1',
      expect.stringContaining('Issues: Read and write'),
      expect.objectContaining({ prNumber: 42, findings: ['- `src/a.ts:11` [Major] finding 11 (https://github.com/x/11)'] }),
    );
    expect(appendedTypes(deps)).toEqual(['feedback.followup_failed']);
  });

  it('raises Needs-you and creates nothing for an issue not tracked on GitHub', async () => {
    const deps = harness([candidate(900, [thread(11)]), MERGED], { resolveTrackerRepo: vi.fn(() => null) });

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(appendedTypes(deps)).toEqual(['feedback.followup_failed']);
  });

  it('files an undelivered candidate, naming why no agent took it', async () => {
    const undelivered = candidate(900, [thread(11)], { type: 'feedback.undelivered' }, { agentId: undefined, reason: 'no work agent for PAN-1' });
    const deps = harness([undelivered, MERGED]);

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(createdBody(deps)).toContain('They were relayed to no work agent: no work agent for PAN-1');
  });

  it('reads the forge once for two deliveries on one PR, from the earlier one', async () => {
    const first = candidate(900, [thread(11)]);
    const second = candidate(901, [thread(21)], { at: LATER });
    const deps = harness([first, second, MERGED]);

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    expect(deps.fetchFacts).toHaveBeenCalledTimes(1);
    expect(deps.fetchFacts).toHaveBeenCalledWith('eltmon/overdeck', 42, DELIVERED_AT);
    expect(deps.createIssue).toHaveBeenCalledTimes(2);
  });

  it('lists every one of 120 unsettled threads', async () => {
    const threads = Array.from({ length: 120 }, (_, index) => thread(1000 + index, `src/f${index}.ts`));
    const deps = harness([candidate(900, threads), MERGED]);

    await fileAdvisoryFollowups('PAN-1', WS, deps);

    const lines = createdBody(deps).split('\n').filter((line) => line.startsWith('- `src/f'));
    expect(lines).toHaveLength(120);
  });

  it('skips a legacy entry without forge reads, and never throws when the journal read throws', async () => {
    const legacy: PipelineJournalEntry = {
      at: DELIVERED_AT, type: 'feedback.delivered', issueId: 'PAN-1', data: { kind: 'coderabbit', dedupKey: 'k', agentId: 'a' },
    };
    const deps = harness([legacy, MERGED]);
    await expect(fileAdvisoryFollowups('PAN-1', WS, deps)).resolves.toEqual([{ dedupKey: 'k', outcome: 'legacy' }]);
    expect(deps.fetchFacts).not.toHaveBeenCalled();

    const broken = harness([], { readJournal: vi.fn(() => { throw new Error('EIO'); }) });
    await expect(fileAdvisoryFollowups('PAN-1', WS, broken)).resolves.toEqual([]);
  });
});
