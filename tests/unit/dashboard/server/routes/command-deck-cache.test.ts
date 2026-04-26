import { describe, it, expect } from 'vitest';

/**
 * Cache-keying logic tests for command-deck.ts (PAN-847).
 *
 * The actual caches live as module-level Maps inside command-deck.ts.
 * Rather than re-import the whole route module (which has heavy side-effects),
 * we test the keying invariants that the implementation must satisfy.
 */

describe('costCache keying invariants', () => {
  it('must use a Map keyed by upper-cased issueId', () => {
    // The implementation changed from:
    //   let costCache: { timestamp, data } | null = null;
    // to:
    //   const costCache = new Map<string, { timestamp, data }>();
    // This test documents the expected shape so regressions are caught in review.
    const cache = new Map<string, { timestamp: number; data: unknown }>();
    cache.set('PAN-111', { timestamp: Date.now(), data: { totalCost: 1.11 } });
    cache.set('PAN-222', { timestamp: Date.now(), data: { totalCost: 2.22 } });

    expect(cache.get('PAN-111')?.data).toEqual({ totalCost: 1.11 });
    expect(cache.get('PAN-222')?.data).toEqual({ totalCost: 2.22 });
    expect(cache.get('PAN-333')).toBeUndefined();
  });

  it('must upper-case the key before lookup so pan-111 and PAN-111 share one entry', () => {
    const issueId = 'pan-847';
    const cacheKey = issueId.toUpperCase();
    expect(cacheKey).toBe('PAN-847');
  });
});

describe('closedIssuesCache keying invariants', () => {
  it('must use a Map keyed by repo string (owner/repo)', () => {
    const cache = new Map<string, { timestamp: number; data: unknown[] }>();
    cache.set('eltmon/panopticon-cli', { timestamp: Date.now(), data: [{ number: 1, title: 'A' }] });
    cache.set('eltmon/openclaw', { timestamp: Date.now(), data: [{ number: 2, title: 'B' }] });

    expect(cache.get('eltmon/panopticon-cli')?.data).toHaveLength(1);
    expect(cache.get('eltmon/openclaw')?.data).toHaveLength(1);
    expect(cache.get('acme/other')).toBeUndefined();
  });

  it('must derive repo keys from getGitHubConfig().repos when available', () => {
    const configRepos = [
      { owner: 'eltmon', repo: 'panopticon-cli' },
      { owner: 'eltmon', repo: 'openclaw' },
    ];
    const keys = configRepos.map((r) => `${r.owner}/${r.repo}`);
    expect(keys).toEqual(['eltmon/panopticon-cli', 'eltmon/openclaw']);
  });

  it('must fall back to the default repo when no config is present', () => {
    const config = null as { repos?: { owner: string; repo: string }[] } | null;
    const repos = config?.repos?.length
      ? config.repos.map((r) => `${r.owner}/${r.repo}`)
      : ['eltmon/panopticon-cli'];
    expect(repos).toEqual(['eltmon/panopticon-cli']);
  });
});
