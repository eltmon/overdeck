import { describe, expect, it } from 'vitest';

import { listUnresolvedThreadCounts } from '../unresolved-threads.js';

const answer = JSON.stringify({
  data: { repository: { pullRequests: { nodes: [
    { number: 10, reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } },
    { number: 11, reviewThreads: { nodes: [{ isResolved: true }] } },
    { number: 12, reviewThreads: { nodes: [] } },
  ] } } },
});

describe('listUnresolvedThreadCounts (PAN-4753 WI-7)', () => {
  it('counts unresolved threads per PR and omits PRs with none', async () => {
    const calls: string[][] = [];
    const counts = await listUnresolvedThreadCounts('eltmon/overdeck', '/repo', {
      gh: async (args) => { calls.push(args); return answer; },
    });
    expect([...counts]).toEqual([[10, 2]]);
    expect(calls[0]).toEqual(expect.arrayContaining(['api', 'graphql', '-F', 'owner=eltmon', '-F', 'name=overdeck']));
  });

  it('returns an empty map when the read fails', async () => {
    const counts = await listUnresolvedThreadCounts('eltmon/overdeck', '/repo', {
      gh: async () => { throw new Error('API rate limit exceeded'); },
    });
    expect(counts.size).toBe(0);
  });

  it('returns an empty map for a malformed slug or answer', async () => {
    expect((await listUnresolvedThreadCounts('nope', '/repo', { gh: async () => answer })).size).toBe(0);
    expect((await listUnresolvedThreadCounts('o/r', '/repo', { gh: async () => 'not json' })).size).toBe(0);
  });
});
