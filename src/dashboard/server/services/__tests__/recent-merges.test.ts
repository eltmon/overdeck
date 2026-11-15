import { describe, expect, it } from 'vitest';

import { recentMergesForProject, type MergedPr, type RecentMergesDeps } from '../recent-merges.js';
import type { PendingAutoMerge, UatGeneration } from '../../../../lib/overdeck/merge-types.js';
import type { PipelineJournalEntry } from '../../../../lib/cloister/pipeline-journal.js';

const pr = (issueId: string, mergedAt: string, extra: Partial<MergedPr> = {}): MergedPr => ({
  issueId, branch: `feature/${issueId.toLowerCase()}`, url: `https://github.com/o/r/pull/${issueId.split('-')[1]}`,
  mergedAt, sha: 'abc1234', ...extra,
});

const row = (issueId: string, status: PendingAutoMerge['status'], extra: Partial<PendingAutoMerge> = {}): PendingAutoMerge => ({
  id: 1, issueId, prUrl: `https://github.com/o/r/pull/${issueId.split('-')[1]}`, projectKey: 'overdeck', forge: 'github',
  status, scheduledAt: '2026-11-14T09:55:00.000Z', scheduledMergeAt: '2026-11-14T10:00:00.000Z', ...extra,
});

function deps(overrides: Partial<RecentMergesDeps> & { merged: MergedPr[] }): RecentMergesDeps {
  return {
    listMerged: async () => overrides.merged,
    listPromoted: overrides.listPromoted ?? (() => []),
    latestAutoMerge: overrides.latestAutoMerge ?? (() => null),
    journal: overrides.journal ?? (() => []),
  };
}

describe('recentMergesForProject (PAN-4753 WI-7, R8)', () => {
  it('attributes a merged auto-merge row to auto-merge', async () => {
    const out = await recentMergesForProject(deps({
      merged: [pr('PAN-1', '2026-11-14T10:00:30.000Z')],
      latestAutoMerge: () => row('PAN-1', 'merged'),
    }));
    expect(out).toEqual([{ issueIds: ['PAN-1'], sha: 'abc1234', mergedAt: '2026-11-14T10:00:30.000Z', via: 'auto-merge' }]);
  });

  it('groups members of a promoted batch into one entry', async () => {
    const gen = {
      name: 'uat/pan-train-otter-1114-1', status: 'promoted', updatedAt: '2026-11-14T10:00:00.000Z',
      members: [{ issueId: 'PAN-1', mergeOrder: 1 }, { issueId: 'PAN-2', mergeOrder: 2 }], repos: [{ promotedAt: null, mergeSha: 'fedcba987654' }],
    } as unknown as UatGeneration;
    const out = await recentMergesForProject(deps({
      merged: [pr('PAN-1', '2026-11-14T10:01:00.000Z'), pr('PAN-2', '2026-11-14T10:01:05.000Z'), pr('PAN-3', '2026-11-14T08:00:00.000Z')],
      listPromoted: () => [gen],
    }));
    expect(out[0]).toEqual({
      issueIds: ['PAN-1', 'PAN-2'], sha: 'fedcba9', mergedAt: '2026-11-14T10:01:05.000Z', via: 'batch', batchName: gen.name,
    });
    expect(out[1]!.issueIds).toEqual(['PAN-3']);
  });

  it('attributes an operator merge door from the journal', async () => {
    const journal: PipelineJournalEntry[] = [{ at: '2026-11-14T09:50:00.000Z', type: 'merge.attempted', issueId: 'PAN-1' }];
    const out = await recentMergesForProject(deps({
      merged: [pr('PAN-1', '2026-11-14T10:00:00.000Z')],
      journal: () => journal,
    }));
    expect(out[0]!.via).toBe('overdeck');
  });

  it('notes an outside-train merge that beat its cooldown, and never refuses it', async () => {
    const out = await recentMergesForProject(deps({
      merged: [pr('PAN-4296', '2026-11-14T09:56:00.000Z')],
      latestAutoMerge: () => row('PAN-4296', 'blocked', { failureReason: 'PR is already merged' }),
    }));
    expect(out).toEqual([{
      issueIds: ['PAN-4296'], sha: 'abc1234', mergedAt: '2026-11-14T09:56:00.000Z', via: 'outside-train',
      warning: 'merged on the forge 4 min before its cooldown ended',
    }]);
  });

  it('marks a plain outside merge with no warning', async () => {
    const out = await recentMergesForProject(deps({ merged: [pr('PAN-9', '2026-11-14T09:00:00.000Z')] }));
    expect(out[0]).toEqual({ issueIds: ['PAN-9'], sha: 'abc1234', mergedAt: '2026-11-14T09:00:00.000Z', via: 'outside-train' });
  });

  it('returns at most five, newest first', async () => {
    const merged = Array.from({ length: 8 }, (_, i) => pr(`PAN-${i + 1}`, `2026-11-14T0${i}:00:00.000Z`));
    const out = await recentMergesForProject(deps({ merged }));
    expect(out.map((entry) => entry.issueIds[0])).toEqual(['PAN-8', 'PAN-7', 'PAN-6', 'PAN-5', 'PAN-4']);
  });
});
