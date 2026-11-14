import { describe, expect, it } from 'vitest';

import { githubCompareUrl } from '../issueLinks';

describe('githubCompareUrl (PAN-5246)', () => {
  it('githubCompareUrl builds the compare link for a GitHub issue URL', () => {
    expect(githubCompareUrl('https://github.com/eltmon/overdeck/issues/1661', 'feature/pan-1661'))
      .toBe('https://github.com/eltmon/overdeck/compare/main...feature%2Fpan-1661?expand=1');
  });

  it('returns null for a non-GitHub tracker URL and for null', () => {
    expect(githubCompareUrl('https://linear.app/acme/issue/MIN-1', 'feature/min-1')).toBeNull();
    expect(githubCompareUrl(null, 'feature/pan-1')).toBeNull();
  });
});
