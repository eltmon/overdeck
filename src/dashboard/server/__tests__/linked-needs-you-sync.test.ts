/**
 * PAN-4651 WI-20 (D-4651-15): the owner's Needs-You feed, the viewer's
 * hash-driven cache, and the fleet route that serves it for online links.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { buildFleetNeedsYou, type FleetAwarenessDeps } from '../routes/fleet-awareness.js';
import type { HeartbeatPayload } from '../services/link-heartbeat.js';
import { createLinkedNeedsYouSync } from '../services/linked-needs-you-sync.js';
import { _resetNeedsYouForTests, buildNeedsYou, needsYouHash } from '../services/needs-you-feed.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const AUQ_ROW = { name: 'conv-q', title: 'Pick a db', pendingInputKinds: ['askUserQuestion'] };
const FEED = { conversations: [AUQ_ROW], agents: [{ id: 'agent-pan-7', issueId: 'PAN-7', pendingInputKinds: ['permissionRequest'] }] };
const beat = (needsYouHash?: string): HeartbeatPayload => ({ seq: 1, lastStall: null, endpointsHash: '', serverVersion: '0.73.0', ...(needsYouHash ? { needsYouHash } : {}) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  _resetNeedsYouForTests();
});

describe('owner Needs-You feed (D-4651-15)', () => {
  it('keeps only agents with pending input and hashes the rest', async () => {
    const feed = await buildNeedsYou({
      conversations: async () => [AUQ_ROW],
      agents: async () => [{ id: 'agent-pan-8', issueId: 'PAN-8', pendingInputKinds: [] }, { id: 'agent-pan-7', issueId: 'PAN-7', pendingInputKinds: ['permissionRequest'] }],
      now: () => 0,
    });
    expect(feed).toEqual({ hash: needsYouHash(FEED), ...FEED });
    expect(feed.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('linked Needs-You cache (D-4651-15, NFR-1)', () => {
  it('ac20: a changed needsYouHash fetches once and an unchanged one never', async () => {
    const hash = needsYouHash(FEED);
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: 200, json: { hash, ...FEED } };
    });
    const sync = createLinkedNeedsYouSync({ fetch, log: () => undefined });
    const changed = sync.onHeartbeat(DESK, beat(hash));
    await vi.advanceTimersByTimeAsync(20);
    await changed;
    expect(fetch).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i += 1) {
      await sync.onHeartbeat(DESK, beat(hash));
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sync.feedFor('env-desk')?.conversations).toEqual([AUQ_ROW]);
  });

  it('ac20: an offline link contributes no rows and no error', async () => {
    const deps: FleetAwarenessDeps = {
      links: async () => [DESK, { ...DESK, id: 'link-lab', environmentId: 'env-lab', label: 'lab' } as MachineLink],
      status: ((linkId: string) => ({ state: linkId === 'link-desk' ? 'online' : 'offline' })) as unknown as FleetAwarenessDeps['status'],
      needsYou: () => ({ hash: 'h', ...FEED }),
    };
    expect(await buildFleetNeedsYou(deps)).toEqual({ machines: [{ environmentId: 'env-desk', label: 'desk', ...FEED }], unreachable: [] });
  });
});

describe('linked Needs-You fetch failures (PAN-5111)', () => {
  function syncWith(fetch: () => Promise<{ status: number; json: unknown }>) {
    let now = Date.parse('2026-11-10T12:00:00.000Z');
    const sync = createLinkedNeedsYouSync({ fetch, log: () => undefined, now: () => now });
    return { sync, advance: (ms: number) => { now += ms; } };
  }

  it('remembers a thrown fetch, keeps the first since, and moves lastAttemptAt', async () => {
    const { sync, advance } = syncWith(async () => {
      throw new Error('Secure channel did not open within 10000 ms');
    });
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')).toEqual({
      since: '2026-11-10T12:00:00.000Z',
      lastAttemptAt: '2026-11-10T12:00:00.000Z',
      reason: 'Secure channel did not open within 10000 ms',
    });
    advance(60_000);
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')).toEqual({
      since: '2026-11-10T12:00:00.000Z',
      lastAttemptAt: '2026-11-10T12:01:00.000Z',
      reason: 'Secure channel did not open within 10000 ms',
    });
  });

  it('clears the failure on a later 200', async () => {
    let fail = true;
    const { sync } = syncWith(async () => {
      if (fail) throw new Error('boom');
      return { status: 200, json: { hash: 'h', ...FEED } };
    });
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')).not.toBeNull();
    fail = false;
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')).toBeNull();
  });

  it('records answered <status> for a non-200 and clears on a 404', async () => {
    let status = 500;
    const { sync } = syncWith(async () => ({ status, json: null }));
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')?.reason).toBe('answered 500');
    status = 404;
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')).toBeNull();
  });

  it('records a malformed feed', async () => {
    const { sync } = syncWith(async () => ({ status: 200, json: { nope: true } }));
    await sync.onConnect(DESK);
    expect(sync.failureFor('env-desk')?.reason).toBe('sent a malformed Needs-You feed');
  });

  it('prune drops the failure with the link', async () => {
    const { sync } = syncWith(async () => {
      throw new Error('boom');
    });
    await sync.onConnect(DESK);
    sync.prune([]);
    expect(sync.failureFor('env-desk')).toBeNull();
  });
});
