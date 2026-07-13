import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBeadsRollupService, type BeadRollup } from '../beads-rollup-service.js';
import type { BeadRecord, BeadsReadResult } from '../../../../lib/beads/resolver.js';

function makeBead(overrides: Partial<BeadRecord> & { id: string }): BeadRecord {
  return {
    title: '',
    status: 'open',
    labels: [],
    ...overrides,
  };
}

function rollupToObject(rollup: BeadRollup) {
  return {
    total: rollup.total,
    closed: rollup.closed,
    inProgress: rollup.inProgress,
    lastUpdated: rollup.lastUpdated,
  };
}

describe('beads rollup service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes rollups from one getAllBeads call and groups by issue label', async () => {
    const getAllBeads = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        makeBead({ id: 'b1', labels: ['pan-9001'], status: 'closed', updated_at: '2026-07-10T00:00:00Z' }),
        makeBead({ id: 'b2', labels: ['pan-9001'], status: 'in_progress', updated_at: '2026-07-11T00:00:00Z' }),
        makeBead({ id: 'b3', labels: ['pan-9001'], status: 'open', updated_at: '2026-07-09T00:00:00Z' }),
      ],
    } as BeadsReadResult<BeadRecord[]>);

    const service = createBeadsRollupService({
      projects: () => [{ key: 'proj', beadsCwd: '/state' }],
      createResolver: () => ({ getAllBeads } as any),
      now: () => Date.parse('2026-07-12T12:00:00Z'),
    });

    service.start();
    await vi.runAllTimersAsync();

    expect(getAllBeads).toHaveBeenCalledTimes(1);
    const state = service.getProjectRollups('proj');
    expect(state).not.toBeNull();
    expect(state!.stale).toBe(false);
    expect(rollupToObject(state!.rollups.get('pan-9001')!)).toEqual({
      total: 3,
      closed: 1,
      inProgress: 1,
      lastUpdated: '2026-07-11T00:00:00Z',
    });
  });

  it('maps workspace:pan-N labels to the bare issue label', async () => {
    const getAllBeads = vi.fn().mockResolvedValue({
      ok: true,
      value: [makeBead({ id: 'b1', labels: ['workspace:pan-9002'], status: 'open' })],
    } as BeadsReadResult<BeadRecord[]>);

    const service = createBeadsRollupService({
      projects: () => [{ key: 'proj', beadsCwd: '/state' }],
      createResolver: () => ({ getAllBeads } as any),
    });

    service.start();
    await vi.runAllTimersAsync();

    const state = service.getProjectRollups('proj');
    expect(state!.rollups.has('pan-9002')).toBe(true);
    expect(state!.rollups.has('workspace:pan-9002')).toBe(false);
  });

  it('refreshes on beads.freshness_changed with a trailing-edge debounce', async () => {
    const getAllBeads = vi.fn().mockResolvedValue({
      ok: true,
      value: [makeBead({ id: 'b1', labels: ['pan-9003'], status: 'open' })],
    } as BeadsReadResult<BeadRecord[]>);

    const listeners: Array<(event: { type: string; payload?: Record<string, unknown> }) => void> = [];
    const service = createBeadsRollupService({
      projects: () => [{ key: 'proj', beadsCwd: '/state' }],
      createResolver: () => ({ getAllBeads } as any),
      subscribe: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    });

    service.start();
    await vi.runAllTimersAsync();
    expect(getAllBeads).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      for (const listener of listeners) {
        listener({ type: 'beads.freshness_changed', payload: { projectKey: 'proj', localHead: 'head-' + i } });
      }
    }

    await vi.advanceTimersByTimeAsync(1_999);
    expect(getAllBeads).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    expect(getAllBeads).toHaveBeenCalledTimes(2);
  });

  it('keeps previous rollups and marks stale when getAllBeads fails', async () => {
    const getAllBeads = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [makeBead({ id: 'b1', labels: ['pan-9004'], status: 'open' })],
      } as BeadsReadResult<BeadRecord[]>)
      .mockResolvedValueOnce({
        ok: false,
        reason: 'timeout',
        transient: true,
        error: new Error('timeout'),
      } as BeadsReadResult<BeadRecord[]>);

    const listeners: Array<(event: { type: string; payload?: Record<string, unknown> }) => void> = [];
    const service = createBeadsRollupService({
      projects: () => [{ key: 'proj', beadsCwd: '/state' }],
      createResolver: () => ({ getAllBeads } as any),
      subscribe: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    });

    service.start();
    await vi.runAllTimersAsync();
    expect(service.getProjectRollups('proj')!.stale).toBe(false);

    for (const listener of listeners) {
      listener({ type: 'beads.freshness_changed', payload: { projectKey: 'proj' } });
    }
    await vi.advanceTimersByTimeAsync(2_000);

    const state = service.getProjectRollups('proj');
    expect(state!.stale).toBe(true);
    expect(state!.rollups.get('pan-9004')!.total).toBe(1);
  });

  it('returns null for an unknown project', () => {
    const service = createBeadsRollupService({
      projects: () => [],
    });
    expect(service.getProjectRollups('unknown')).toBeNull();
  });
});
