import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/overdeck/cost.js', () => ({
  collectCodexCostEvents: vi.fn(async () => ({ events: [], verdicts: [], stats: { scanned: 0, cacheSkipped: 0 } })),
}));
vi.mock('../../../src/lib/costs/reconciler.js', () => ({ collectPiCostEvents: vi.fn() }));

import {
  formatSlowJobLine,
  runDashboardDbJob,
} from '../../../src/dashboard/server/services/dashboard-db-task.js';

const piFixture = new URL(
  '../../../src/dashboard/server/services/__tests__/pi-conversation-parser.fixture.jsonl',
  import.meta.url,
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dashboard database job instrumentation', () => {
  it('formats queue wait from enqueue and start stamps', () => {
    const enqueuedAt = 1_000;
    const startedAt = 2_250;
    const finishedAt = 2_500;

    expect(formatSlowJobLine({
      op: 'listSessionsFeed', lane: 'read',
      waitMs: startedAt - enqueuedAt, runMs: finishedAt - startedAt, depth: 3,
    })).toBe('[db-jobs] slow: op=listSessionsFeed lane=read waitMs=1250 runMs=250 depth=3');
  });

  it('formats worker run time above one second', () => {
    expect(formatSlowJobLine({
      op: 'costReconcileSweep', lane: 'long', waitMs: 20, runMs: 1_001, depth: 0,
    })).toBe('[db-jobs] slow: op=costReconcileSweep lane=long waitMs=20 runMs=1001 depth=0');
  });

  it('includes parsed bytes only for transcript parse slow lines', () => {
    expect(formatSlowJobLine({
      op: 'parseTranscriptSnapshot', lane: 'parse', waitMs: 0, runMs: 1_001, depth: 0, bytes: 25_000_000,
    })).toBe('[db-jobs] slow: op=parseTranscriptSnapshot lane=parse waitMs=0 runMs=1001 depth=0 bytes=25000000');
  });

  it('returns null when wait and run time are at the threshold', () => {
    expect(formatSlowJobLine({
      op: 'getDiscoveredStats', lane: 'read', waitMs: 1_000, runMs: 1_000, depth: 0,
    })).toBeNull();
  });

  it('logs the same line shape for a slow inline job with zero wait', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_001);

    await runDashboardDbJob('costReconcileSweep', { source: 'codex' });

    expect(warnSpy).toHaveBeenCalledWith(
      '[db-jobs] slow: op=costReconcileSweep lane=long waitMs=0 runMs=1001 depth=0',
    );
  });

  it('logs parsed bytes for a slow inline transcript parse', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let nowCalls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => ++nowCalls === 1 ? 1_000 : 2_001);

    const result = await runDashboardDbJob<{ byteOffset: number }>('parseTranscriptSnapshot', {
      sessionFile: piFixture.pathname,
      parser: 'pi',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      `[db-jobs] slow: op=parseTranscriptSnapshot lane=parse waitMs=0 runMs=1001 depth=0 bytes=${result.byteOffset}`,
    );
  });
});
