import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredEvent } from '../../../../src/dashboard/server/event-store.js';
import {
  buildResourceHistoryResponse,
  recordResourceHistorySample,
  resetResourceHistorySamples,
} from '../../../../src/dashboard/server/routes/resources/history.js';

function activityEvent(
  sequence: number,
  timestamp: string,
  payload: Record<string, unknown>,
): StoredEvent {
  return {
    sequence,
    type: 'activity.entry',
    timestamp,
    payload,
  };
}

describe('PAN-2464 resources history', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
    resetResourceHistorySamples();
  });

  afterEach(() => {
    resetResourceHistorySamples();
    vi.useRealTimers();
  });

  it('returns cpu and mem series capped at 288 points with startedAt marking coverage', () => {
    for (let i = 0; i < 300; i += 1) {
      recordResourceHistorySample({
        timestamp: new Date(Date.now() + i * 60_000).toISOString(),
        cpuPercent: i % 100,
        memoryPercent: 40 + (i % 20),
      });
    }

    vi.setSystemTime(new Date('2026-07-07T17:00:00Z'));
    const response = buildResourceHistoryResponse([]);

    expect(response.startedAt).toBe('2026-07-07T12:00:00.000Z');
    expect(response.cpu.length).toBeLessThanOrEqual(288);
    expect(response.mem.length).toBeLessThanOrEqual(288);
    expect(response.cpu.length).toBe(60);
    expect(response.mem.length).toBe(60);
    expect(response.cpu[0]).toEqual({ ts: '2026-07-07T12:00:00.000Z', value: 2 });
  });

  it('returns resource annotations inside 24h and excludes non-resource or old events', () => {
    const events = [
      activityEvent(1, '2026-07-07T11:50:00.000Z', {
        message: 'Load 45 spike - vitest workers',
        details: {
          category: 'resources',
          targetKind: 'host-process',
          targetId: 'agent-pan-2341-test',
        },
      }),
      activityEvent(2, '2026-07-07T11:45:00.000Z', {
        message: 'Review started',
        details: {
          category: 'pipeline',
          targetKind: 'issue',
          targetId: 'PAN-1',
        },
      }),
      activityEvent(3, '2026-07-06T11:59:59.000Z', {
        message: 'Old reclaim',
        details: {
          category: 'resources',
          targetKind: 'stack',
          targetId: 'MIN-854',
        },
      }),
      activityEvent(4, '2026-07-07T11:40:00.000Z', {
        message: 'Stack stopped',
        details: JSON.stringify({
          category: 'resources',
          targetKind: 'stack',
          targetId: 'MIN-860',
        }),
      }),
    ];

    const response = buildResourceHistoryResponse(events);

    expect(response.annotations).toEqual([
      {
        ts: '2026-07-07T11:50:00.000Z',
        label: 'Load 45 spike - vitest workers',
        targetKind: 'host-process',
        targetId: 'agent-pan-2341-test',
      },
      {
        ts: '2026-07-07T11:40:00.000Z',
        label: 'Stack stopped',
        targetKind: 'stack',
        targetId: 'MIN-860',
      },
    ]);
  });

  it('preserves only the trailing 24h after 30 fake-timer hours of accumulation', () => {
    for (let i = 0; i <= 30 * 12; i += 1) {
      recordResourceHistorySample({
        cpuPercent: i % 100,
        memoryPercent: 50,
      });
      vi.advanceTimersByTime(5 * 60_000);
    }

    const response = buildResourceHistoryResponse([]);

    expect(response.cpu).toHaveLength(288);
    expect(response.mem).toHaveLength(288);
    expect(response.startedAt).toBe('2026-07-07T18:05:00.000Z');
    expect(response.cpu[0]?.ts).toBe('2026-07-07T18:05:00.000Z');
    expect(response.cpu.at(-1)?.ts).toBe('2026-07-08T18:00:00.000Z');
  });
});
