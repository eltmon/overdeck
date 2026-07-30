import { describe, expect, it } from 'vitest';

import { parseRequestedReviewMode } from '../review-pipeline.js';

describe('parseRequestedReviewMode', () => {
  it.each(['quick', 'full', 'none'] as const)('accepts %s', (reviewMode) => {
    expect(parseRequestedReviewMode({ reviewMode })).toEqual({ ok: true, mode: reviewMode });
  });

  it('accepts an absent or null reviewMode without returning a mode', () => {
    expect(parseRequestedReviewMode({})).toEqual({ ok: true });
    expect(parseRequestedReviewMode({ reviewMode: null })).toEqual({ ok: true });
  });

  it.each(['FULL', '', 123, {}])('rejects invalid reviewMode %j', (reviewMode) => {
    const result = parseRequestedReviewMode({ reviewMode });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('quick, full, or none');
    }
  });
});
