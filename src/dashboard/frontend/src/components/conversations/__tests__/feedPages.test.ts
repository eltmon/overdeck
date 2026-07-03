import { describe, expect, it } from 'vitest';

import { accumulateFeedPages, feedRowKey } from '../feedPages';

describe('feedPages', () => {
  it('accumulates pages and deduplicates rows by source/id', () => {
    const rows = accumulateFeedPages([
      {
        rows: [
          { source: 'discovered', id: 1, label: 'first' },
          { source: 'managed-archived', id: 1, label: 'archived' },
        ],
      },
      {
        rows: [
          { source: 'discovered', id: 1, label: 'duplicate' },
          { source: 'discovered', id: 2, label: 'second' },
        ],
      },
    ]);

    expect(rows.map(feedRowKey)).toEqual([
      'discovered:1',
      'managed-archived:1',
      'discovered:2',
    ]);
    expect(rows.map((row) => row.label)).toEqual(['first', 'archived', 'second']);
  });
});
