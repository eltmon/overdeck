import { describe, expect, it, vi } from 'vitest';

import { BeadsResolver } from '../../../../src/lib/beads/resolver.js';

describe('BeadsResolver', () => {
  it('returns typed Dolt-backed reads for a redirect-only workspace', async () => {
    const execute = vi.fn(async () => JSON.stringify([{ id: 'pan-1-a', title: 'A', status: 'open', labels: ['pan-1'] }]));
    const resolver = new BeadsResolver('/tmp/feature-pan-1', { execute });
    await expect(resolver.issueHasBeads('PAN-1')).resolves.toEqual({ ok: true, value: true });
    expect(execute).toHaveBeenCalledWith(
      ['list', '--json', '-l', 'pan-1', '--status', 'all', '--limit', '0'],
      '/tmp/feature-pan-1',
    );
  });

  it('marks a failed canonical read stale instead of fabricating an empty result', async () => {
    const resolver = new BeadsResolver('/tmp/project', {
      execute: async () => { throw new Error('Dolt unavailable'); },
      retry: { maxAttempts: 1 },
    });
    const result = await resolver.getBeadsForIssue('PAN-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale, not empty/);
  });
});
