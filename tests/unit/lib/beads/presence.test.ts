import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { issuesWithBeadsBounded } from '../../../../src/lib/beads/presence.js';
import * as resolver from '../../../../src/lib/beads/resolver.js';

describe('issuesWithBeadsBounded', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns upper-cased issue IDs derived from bead labels', async () => {
    vi.spyOn(resolver, 'createBeadsResolver').mockReturnValue({
      getAllBeads: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          { id: 'bead-1', title: 'One', status: 'open', labels: ['pan-2607', 'misc'] },
          { id: 'bead-2', title: 'Two', status: 'open', labels: ['MIN-123'] },
          { id: 'bead-3', title: 'Three', status: 'open', labels: [] },
        ],
      }),
    } as unknown as resolver.BeadsResolver);

    const result = await issuesWithBeadsBounded('/tmp');
    expect(result.known).toBe(true);
    expect(result.set.has('PAN-2607')).toBe(true);
    expect(result.set.has('MIN-123')).toBe(true);
    expect(result.set.has('misc')).toBe(false);
  });

  it('returns known: false when the bulk resolver fails', async () => {
    vi.spyOn(resolver, 'createBeadsResolver').mockReturnValue({
      getAllBeads: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'locked',
        transient: true,
        error: new Error('locked'),
      }),
    } as unknown as resolver.BeadsResolver);

    const result = await issuesWithBeadsBounded('/tmp');
    expect(result.known).toBe(false);
    expect(result.set.size).toBe(0);
  });

  it('returns known: false when the bound expires before the resolver resolves', async () => {
    vi.spyOn(resolver, 'createBeadsResolver').mockReturnValue({
      getAllBeads: vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ })),
    } as unknown as resolver.BeadsResolver);

    const promise = issuesWithBeadsBounded('/tmp', 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;
    expect(result.known).toBe(false);
    expect(result.set.size).toBe(0);
  });
});
