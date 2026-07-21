import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const calls: string[] = [];

vi.mock('../../../src/lib/overdeck/review-status-record-sync.js', () => ({
  flushReviewStatusJournalWrites: vi.fn(async () => {
    calls.push('journal');
  }),
}));

vi.mock('../../../src/lib/pan-dir/auto-commit.js', () => ({
  flushAllPendingAutoCommits: vi.fn(() => Effect.sync(() => {
    calls.push('auto-commit');
    return [];
  })),
}));

import { drainPendingDurableWrites } from '../../../src/cli/durable-write-drain.js';

describe('drainPendingDurableWrites', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('drains journal writes before auto-commits they may enqueue', async () => {
    await drainPendingDurableWrites();

    expect(calls).toEqual(['journal', 'auto-commit']);
  });
});
