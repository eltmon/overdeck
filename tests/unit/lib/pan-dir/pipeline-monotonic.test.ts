/**
 * PAN-2587: the whole-record rebuild must never regress the pipeline block. A
 * reviewer verdict written concurrently (newer `updatedAt` on disk) survives a
 * rebuild that projected from a stale status snapshot.
 */

import { describe, it, expect } from 'vitest';
import { pickNewerPipeline } from '../../../../src/lib/pan-dir/records.js';
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
