/** PAN-4651 WI-21 (D-4651-16): palette search across linked machines. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { buildFleetSearch, FLEET_SEARCH_TIMEOUT_MS, type PeerSearch } from '../routes/fleet-awareness.js';

const link = (label: string) => ({ id: `link-${label}`, environmentId: `env-${label}`, label, revokedAt: null }) as MachineLink;
const HIT = { conversationId: 'conv-a', sessionId: 's', title: 'Fix the cache', matchTier: 'title', byteOffset: null };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deps = (search: PeerSearch, states: Record<string, string> = {}) => ({
  links: async () => [link('desk'), link('lab'), link('old')],
  status: ((linkId: string) => ({ state: states[linkId] ?? 'online' })) as never,
  search,
});

describe('GET /api/fleet/search (D-4651-16)', () => {
  it('ac21: renames hits to @<env>/<name> per machine; a link that times out yields error for that machine only', async () => {
    const search = vi.fn<PeerSearch>(async (environmentId, path) => {
      expect(path).toBe('/api/palette/search?q=cache&limit=15');
      if (environmentId === 'env-lab') return new Promise(() => undefined);
      return { status: 200, json: { conversations: [HIT] } };
    });
    const pending = buildFleetSearch('cache', 15, deps(search, { 'link-old': 'offline' }));
    await vi.advanceTimersByTimeAsync(FLEET_SEARCH_TIMEOUT_MS);
    const answer = await pending;
    expect(answer.machines).toEqual([
      { environmentId: 'env-desk', label: 'desk', conversations: [{ ...HIT, conversationId: '@env-desk/conv-a' }] },
      { environmentId: 'env-lab', label: 'lab', conversations: [], error: 'did not answer within 2.5 s' },
    ]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('asks nobody for a query under two characters, and reports a non-200 as that machine\'s error', async () => {
    const search = vi.fn<PeerSearch>(async () => ({ status: 403, json: { error: 'insufficient_scope' } }));
    expect(await buildFleetSearch('c', 15, deps(search))).toEqual({ machines: [] });
    expect(search).not.toHaveBeenCalled();
    const answer = await buildFleetSearch('cache', 15, deps(search));
    expect(answer.machines[0]).toEqual({ environmentId: 'env-desk', label: 'desk', conversations: [], error: 'desk answered 403' });
  });
});
