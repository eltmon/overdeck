/** PAN-4651 WI-23 (D-4651-19): the request digest a linked machine reads for fleet usage. */
import { describe, expect, it } from 'vitest';

import { buildRequestDigest, monthWindowStart, requestHash } from '../../../../src/lib/costs/request-digest.js';

describe('request digest (D-4651-19)', () => {
  it('ac23: hashes are 16 hex, events without a request id are omitted', () => {
    const digest = buildRequestDigest([
      { requestId: 'req_1', ts: '2026-11-01T10:00:00.000Z', cost: 0.25 },
      { ts: '2026-11-01T10:01:00.000Z', cost: 9 },
      { requestId: 'req_2', ts: '2026-11-01T10:02:00.000Z', cost: 0.5 },
    ], '2026-10-02');
    expect(digest.since).toBe('2026-10-02');
    expect(digest.complete).toBe(true);
    expect(digest.entries).toEqual([
      [requestHash('req_1'), Date.parse('2026-11-01T10:00:00.000Z'), 0.25],
      [requestHash('req_2'), Date.parse('2026-11-01T10:02:00.000Z'), 0.5],
    ]);
    expect(digest.entries[0]![0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ac23: more than the cap sets complete: false', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ requestId: `r${i}`, ts: '2026-11-01T00:00:00.000Z', cost: 1 }));
    const digest = buildRequestDigest(events, 'x', 3);
    expect(digest.entries).toHaveLength(3);
    expect(digest.complete).toBe(false);
    expect(buildRequestDigest(events.slice(0, 3), 'x', 3).complete).toBe(true);
  });

  it('uses the summary\'s 30-day window', () => {
    expect(monthWindowStart(Date.parse('2026-11-01T12:00:00.000Z'))).toBe('2026-10-02');
  });
});
