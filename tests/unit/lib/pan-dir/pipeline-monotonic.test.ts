/**
 * PAN-2587: the whole-record rebuild must never regress the pipeline block. A
 * reviewer verdict written concurrently (newer `updatedAt` on disk) survives a
 * rebuild that projected from a stale status snapshot.
 */

import { describe, it, expect } from 'vitest';
import { pickNewerPipeline } from '../../../../src/lib/pan-dir/records.js';
import { pipelineCoversFallbackVerdicts } from '../../../../src/lib/pan-dir/pipeline-verdict-merge.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/records.js';

function pipeline(overrides: Partial<PanIssuePipelineRecord>): PanIssuePipelineRecord {
  return {
    issueId: 'PAN-9999',
    reviewStatus: 'pending',
    testStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  } as PanIssuePipelineRecord;
}

describe('pickNewerPipeline (PAN-2587)', () => {
  it('keeps a strictly newer pipeline already on disk (the clobber case)', () => {
    const rebuilt = pipeline({ reviewStatus: 'reviewing', updatedAt: '2026-07-12T00:17:24.537Z' });
    const fresh = pipeline({ reviewStatus: 'passed', reviewedAtCommit: 'a2edef47', updatedAt: '2026-07-12T00:19:55.000Z' });
    expect(pickNewerPipeline(rebuilt, fresh)).toBe(fresh);
  });

  it('keeps the rebuilt pipeline when it is newer than disk', () => {
    const rebuilt = pipeline({ reviewStatus: 'pending', updatedAt: '2026-07-12T01:32:11.675Z' });
    const fresh = pipeline({ reviewStatus: 'passed', updatedAt: '2026-07-12T00:19:55.000Z' });
    expect(pickNewerPipeline(rebuilt, fresh)).toBe(rebuilt);
  });

  it('keeps the rebuilt pipeline when there is nothing fresh on disk', () => {
    const rebuilt = pipeline({ reviewStatus: 'reviewing' });
    expect(pickNewerPipeline(rebuilt, undefined)).toBe(rebuilt);
  });

  it('keeps the rebuilt pipeline when timestamps are equal (no thrash on ties)', () => {
    const rebuilt = pipeline({ reviewStatus: 'reviewing', updatedAt: '2026-07-12T00:19:55.000Z' });
    const fresh = pipeline({ reviewStatus: 'passed', updatedAt: '2026-07-12T00:19:55.000Z' });
    expect(pickNewerPipeline(rebuilt, fresh)).toBe(rebuilt);
  });
});

describe('pickNewerPipeline verdict-awareness (PAN-3092)', () => {
  const CYCLE = '2026-07-26T23:40:00.000Z';

  it('preserves a terminal review verdict a newer verdict-free write would have dropped', () => {
    // MIN-902: the reviewer's `passed` fold is the rebuild, and a bookkeeping
    // write that landed a second later carries a newer `updatedAt` with no
    // verdict. Plain newer-wins discarded the verdict from every plane.
    const rebuilt = pipeline({
      reviewStatus: 'passed',
      reviewNotes: 'APPROVED at fe@5eca65e0 api@8083efe8',
      reviewedAtCommit: '5eca65e0',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:07.000Z',
    });
    const fresh = pipeline({
      reviewStatus: 'reviewing',
      reviewSpawnedAt: CYCLE,
      prUrl: 'https://github.com/eltmon/overdeck/pull/9999',
      updatedAt: '2026-07-27T00:09:41.000Z',
    });

    const merged = pickNewerPipeline(rebuilt, fresh);

    expect(merged.reviewStatus).toBe('passed');
    expect(merged.reviewNotes).toBe('APPROVED at fe@5eca65e0 api@8083efe8');
    expect(merged.reviewedAtCommit).toBe('5eca65e0');
    // Non-verdict fields still come from the newer on-disk write.
    expect(merged.prUrl).toBe('https://github.com/eltmon/overdeck/pull/9999');
    expect(merged.updatedAt).toBe('2026-07-27T00:09:41.000Z');
    // The inputs are untouched — the merge clones before writing.
    expect(fresh.reviewStatus).toBe('reviewing');
  });

  it('lets a strictly newer review cycle reset a terminal verdict wholesale', () => {
    const rebuilt = pipeline({
      reviewStatus: 'passed',
      reviewNotes: 'APPROVED (previous cycle)',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:07.000Z',
    });
    const fresh = pipeline({
      reviewStatus: 'reviewing',
      reviewSpawnedAt: '2026-07-27T04:00:00.000Z',
      updatedAt: '2026-07-27T04:00:01.000Z',
    });

    expect(pickNewerPipeline(rebuilt, fresh)).toBe(fresh);
  });

  it('lets a newer terminal verdict supersede an older one', () => {
    const rebuilt = pipeline({
      reviewStatus: 'passed',
      reviewNotes: 'APPROVED',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:07.000Z',
    });
    const fresh = pipeline({
      reviewStatus: 'blocked',
      reviewNotes: 'BLOCKED: 2 findings',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:30:00.000Z',
    });

    const merged = pickNewerPipeline(rebuilt, fresh);
    expect(merged).toBe(fresh);
    expect(merged.reviewNotes).toBe('BLOCKED: 2 findings');
  });

  it('preserves a terminal test verdict against an in-flight testing status', () => {
    // MIN-858's shape: the test verdict landed, then a dispatch write reset the
    // gate to `testing` with a newer timestamp.
    const rebuilt = pipeline({
      testStatus: 'passed',
      testNotes: '22/22 backend, typecheck clean, UAT green',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:07.000Z',
    });
    const fresh = pipeline({
      testStatus: 'testing',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:12:00.000Z',
    });

    const merged = pickNewerPipeline(rebuilt, fresh);
    expect(merged.testStatus).toBe('passed');
    expect(merged.testNotes).toBe('22/22 backend, typecheck clean, UAT green');
  });
});

describe('pipelineCoversFallbackVerdicts (PAN-3092)', () => {
  const CYCLE = '2026-07-26T23:40:00.000Z';
  const fallback = (
    pipelineFields: Record<string, unknown>,
    updatedAt = '2026-07-27T00:09:07.000Z',
  ): { updatedAt: string; pipeline: Record<string, unknown> } => ({
    updatedAt,
    pipeline: pipelineFields,
  });

  it('reports the verdict uncovered when a newer journal never carried it', () => {
    const journal = pipeline({
      reviewStatus: 'reviewing',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:41.000Z',
    });
    expect(
      pipelineCoversFallbackVerdicts(journal, fallback({ reviewStatus: 'passed' })),
    ).toBe(false);
  });

  it('reports the verdict covered when the journal carries the same terminal value', () => {
    const journal = pipeline({
      reviewStatus: 'passed',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:09:41.000Z',
    });
    expect(
      pipelineCoversFallbackVerdicts(journal, fallback({ reviewStatus: 'passed' })),
    ).toBe(true);
  });

  it('reports covered when the newer journal settled the gate on a different verdict', () => {
    // The caller has already established the journal is at least as new, so a
    // journal that reached its own terminal verdict is the newer truth —
    // folding the fallback over it would regress it.
    const journal = pipeline({
      reviewStatus: 'blocked',
      reviewSpawnedAt: CYCLE,
      updatedAt: '2026-07-27T00:30:00.000Z',
    });
    expect(
      pipelineCoversFallbackVerdicts(journal, fallback({ reviewStatus: 'passed' })),
    ).toBe(true);
  });

  it('reports covered when the journal belongs to a strictly newer review cycle', () => {
    const journal = pipeline({
      reviewStatus: 'reviewing',
      reviewSpawnedAt: '2026-07-27T04:00:00.000Z',
      updatedAt: '2026-07-27T04:00:01.000Z',
    });
    expect(
      pipelineCoversFallbackVerdicts(journal, fallback({ reviewStatus: 'passed' })),
    ).toBe(true);
  });

  it('reports covered when the fallback holds no terminal verdict at all', () => {
    const journal = pipeline({ reviewStatus: 'reviewing', updatedAt: '2026-07-27T00:09:41.000Z' });
    expect(
      pipelineCoversFallbackVerdicts(journal, fallback({ reviewStatus: 'reviewing', prNumber: 42 })),
    ).toBe(true);
  });

  it('checks every gate, not only review', () => {
    const journal = pipeline({
      reviewStatus: 'passed',
      testStatus: 'testing',
      updatedAt: '2026-07-27T00:09:41.000Z',
    });
    expect(
      pipelineCoversFallbackVerdicts(
        journal,
        fallback({ reviewStatus: 'passed', testStatus: 'passed' }),
      ),
    ).toBe(false);
  });
});
