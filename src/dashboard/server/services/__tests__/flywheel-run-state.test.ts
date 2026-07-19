import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus, OrderBook } from '@overdeck/contracts';
import type { OrderBookProgress } from '../../../../lib/orders/types.js';

// PAN-1245: resolver reads SQLite via app-settings. Mock the gate so we can
// exercise self-healing without touching the real ~/.overdeck/state.db.
const appSettingsMocks = vi.hoisted(() => ({
  activeRunId: null as string | null,
  paused: false,
}));

const agentsDbMocks = vi.hoisted(() => ({
  runningWorkCount: 0,
}));

vi.mock('../../../../lib/overdeck/control-settings.js', () => ({
  getFlywheelActiveRunId: () => appSettingsMocks.activeRunId,
  isFlywheelGloballyPaused: () => appSettingsMocks.paused,
  setFlywheelActiveRunId: (runId: string | null) => {
    appSettingsMocks.activeRunId = runId;
  },
  setFlywheelGloballyPaused: (paused: boolean) => {
    appSettingsMocks.paused = paused;
  },
}));

vi.mock('../../../../lib/overdeck/agents.js', () => ({
  countAgentsByStatusRole: (status: string, role: string) =>
    status === 'running' && role === 'work' ? agentsDbMocks.runningWorkCount : 0,
}));

import {
  abortFlywheelRun,
  enrichFlywheelStatusWithOrders,
  getFlywheelRunDetail,
  listFlywheelRuns,
  nextFlywheelRunId,
  resolveLiveFlywheelRunId,
  writeFlywheelLaunchMetadata,
  writeLatestFlywheelStatus,
} from '../flywheel-run-state.js';

function makeStatus(runId: string, startedAt: string): FlywheelStatus {
  return {
    runId,
    startedAt,
    elapsedMs: 1000,
    orchestrator: {
      harness: 'claude-code',
      model: 'opus-4.7',
      effort: 'high',
      ctxPercent: 25,
    },
    headline: {
      bugsFixed: 1,
      swarmItemsMerged: 2,
      swarmItemsTotal: 3,
      prsMerged: 4,
      awaitingUat: 5,
    },
    activePipeline: [],
    substrateBugs: [],
    agents: [],
    parked: [],
    suggestions: [],
    system: {
      mainHead: 'abc1234',
      ramUsedMb: 1024,
      ramTotalMb: 4096,
      swapUsedMb: 0,
      swapTotalMb: 1024,
      agentsActive: 1,
      agentsCap: 8,
    },
    openQuestions: [],
    ticks: 1,
    lastTickAt: startedAt,
  };
}

function orderBook(): OrderBook {
  return {
    id: '2026-07-18-campaign', name: 'Campaign', status: 'running', runId: 'RUN-1',
    settings: { laneAConcurrency: 2, posture: 'open' },
    items: [
      { issue: 'PAN-1', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
      { issue: 'PAN-2', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
      { issue: 'PAN-3', lane: 'A', order: 2, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
    ],
    createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
  };
}

function orderProgress(
  terminals: ReadonlySet<string> = new Set(),
  parked: ReadonlySet<string> = new Set(),
): OrderBookProgress {
  const items = orderBook().items.map((item) => ({
    issue: item.issue, lane: item.lane, order: item.order,
    closed: terminals.has(item.issue) && !parked.has(item.issue), parked: parked.has(item.issue),
    terminal: terminals.has(item.issue),
  }));
  return { bookId: orderBook().id, total: items.length, landed: items.filter((item) => item.closed).length, items, drained: items.every((item) => item.terminal) };
}

describe('flywheel run state', () => {
  let overdeckHome: string;

  beforeEach(async () => {
    overdeckHome = await mkdtemp(join(tmpdir(), 'pan-flywheel-run-state-'));
    appSettingsMocks.activeRunId = null;
    appSettingsMocks.paused = false;
    agentsDbMocks.runningWorkCount = 0;
  });

  afterEach(async () => {
    await rm(overdeckHome, { recursive: true, force: true });
  });

  it('mechanically populates order progress and current lane positions', () => {
    const status = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');
    status.activePipeline = [
      { issueId: 'PAN-1', title: 'A', verb: 'working', status: 'running' },
      { issueId: 'PAN-2', title: 'B', verb: 'reviewing', status: 'passed' },
      { issueId: 'PAN-3', title: 'Done', verb: 'shipping', status: 'merged' },
    ];
    expect(enrichFlywheelStatusWithOrders(status, orderBook(), orderProgress(new Set(['PAN-3']))).orders).toEqual({
      bookId: '2026-07-18-campaign', bookName: 'Campaign', landed: 1, total: 3,
      laneAInFlight: ['PAN-1'], laneBInFlight: 'PAN-2', drained: false,
    });
  });

  it('derives drained from closed or parked progress rather than the emitted payload', () => {
    const status = { ...makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), orders: {
      bookId: 'spoofed', bookName: 'Spoofed', landed: 0, total: 99,
      laneAInFlight: [], drained: false,
    } };
    const enriched = enrichFlywheelStatusWithOrders(
      status,
      orderBook(),
      orderProgress(new Set(['PAN-1', 'PAN-2', 'PAN-3']), new Set(['PAN-3'])),
    );
    expect(enriched.orders).toMatchObject({ bookId: orderBook().id, landed: 2, total: 3, drained: true });
  });

  it('persists the mechanical running-to-drained transition before writing status', async () => {
    const value = orderBook();
    const progress = orderProgress(new Set(['PAN-1', 'PAN-2', 'PAN-3']), new Set(['PAN-3']));
    const setOrderStatus = vi.fn(async () => ({ ...value, status: 'drained' as const }));
    await writeFlywheelLaunchMetadata({
      version: 1,
      runId: 'RUN-1',
      workspace: '/project',
      briefPath: '/project/docs/flywheel-brief.md',
      briefDisplayPath: 'docs/flywheel-brief.md',
      orders: { bookId: value.id },
    }, { overdeckHome });

    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), {
      overdeckHome,
      orderStateRoot: () => '/state',
      getOrderBook: () => value,
      computeOrderProgress: () => progress,
      setOrderStatus,
    });

    expect(setOrderStatus).toHaveBeenCalledWith('/state', value.id, 'drained', { runId: 'RUN-1' });
    expect((await getFlywheelRunDetail('RUN-1', { overdeckHome }))?.latest?.orders?.drained).toBe(true);
  });

  it('removes a self-reported orders block from a bookless run', async () => {
    const status = { ...makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), orders: {
      bookId: 'spoofed', bookName: 'Spoofed', landed: 0, total: 1,
      laneAInFlight: [], drained: false,
    } };
    await writeLatestFlywheelStatus(status, { overdeckHome });
    expect((await getFlywheelRunDetail('RUN-1', { overdeckHome }))?.latest?.orders).toBeUndefined();
  });

  it('writes and reads latest.json atomically', async () => {
    const status = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');

    const latestPath = await writeLatestFlywheelStatus(status, { overdeckHome });
    const detail = await getFlywheelRunDetail('RUN-1', { overdeckHome });

    expect(latestPath).toBe(join(overdeckHome, 'flywheel', 'runs', 'RUN-1', 'latest.json'));
    // PAN-1528/PAN-1908: getFlywheelRunDetail overlays the agents-table
    // running work-agent count over the persisted status.
    expect(detail?.latest).toEqual({
      ...status,
      system: { ...status.system, agentsActive: 0 },
    });
    expect(await readFile(latestPath, 'utf8')).toContain('"runId": "RUN-1"');
  });

  it('overlays active work-agent count from the agents table', async () => {
    const status = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');
    agentsDbMocks.runningWorkCount = 3;

    await writeLatestFlywheelStatus(status, { overdeckHome });
    const detail = await getFlywheelRunDetail('RUN-1', { overdeckHome });

    expect(detail?.latest?.system.agentsActive).toBe(3);
  });

  it('generates monotonic run IDs from existing run directories', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-9', '2026-05-18T11:00:00.000Z'), { overdeckHome });

    await expect(nextFlywheelRunId({ overdeckHome })).resolves.toBe('RUN-10');
  });

  it('lists runs sorted by startedAt desc with status derived from disk', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-2', '2026-05-18T12:00:00.000Z'), { overdeckHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-3', '2026-05-18T11:00:00.000Z'), { overdeckHome });
    await writeFile(join(overdeckHome, 'flywheel', 'runs', 'RUN-2', 'report.md'), '# Report\n');
    await writeFile(join(overdeckHome, 'flywheel', 'runs', 'RUN-3', 'aborted.json'), '{}\n');
    // RUN-1 is the live (active, unpaused) run → 'running'.
    appSettingsMocks.activeRunId = 'RUN-1';

    await expect(listFlywheelRuns({ overdeckHome })).resolves.toEqual([
      { id: 'RUN-2', startedAt: '2026-05-18T12:00:00.000Z', status: 'complete' },
      { id: 'RUN-3', startedAt: '2026-05-18T11:00:00.000Z', status: 'aborted' },
      { id: 'RUN-1', startedAt: '2026-05-18T10:00:00.000Z', status: 'running' },
    ]);
  });

  // PAN-2108: an orphaned run (no terminal marker, not the active run) was an
  // abandoned orchestrator — it must NOT report 'running' (that lit the sidebar
  // "live" badge for every stale run forever).
  it('reports an orphaned non-active run without terminal markers as aborted, not running', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-2', '2026-05-18T12:00:00.000Z'), { overdeckHome });
    // RUN-2 is the only live run; RUN-1 has no markers and is not active.
    appSettingsMocks.activeRunId = 'RUN-2';

    await expect(listFlywheelRuns({ overdeckHome })).resolves.toEqual([
      { id: 'RUN-2', startedAt: '2026-05-18T12:00:00.000Z', status: 'running' },
      { id: 'RUN-1', startedAt: '2026-05-18T10:00:00.000Z', status: 'aborted' },
    ]);
  });

  describe('resolveLiveFlywheelRunId (PAN-1245)', () => {
    it('returns null when the gate is empty', async () => {
      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBeNull();
    });

    it('returns the run id when the run is genuinely running', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBe('RUN-1');
      expect(appSettingsMocks.activeRunId).toBe('RUN-1');
    });

    it('clears a gate pointing at a completed run (report.md present)', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
      await writeFile(join(overdeckHome, 'flywheel', 'runs', 'RUN-1', 'report.md'), '# Report\n');
      appSettingsMocks.activeRunId = 'RUN-1';
      appSettingsMocks.paused = true;

      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
      expect(appSettingsMocks.paused).toBe(false);
    });

    it('clears a gate pointing at an aborted run', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { overdeckHome });
      await writeFile(join(overdeckHome, 'flywheel', 'runs', 'RUN-1', 'aborted.json'), '{}\n');
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });

    it('clears a gate whose run directory has no latest.json (post-wipe / never initialized)', async () => {
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });

    it('clears a gate holding a malformed run id', async () => {
      appSettingsMocks.activeRunId = 'not-a-run-id';

      await expect(resolveLiveFlywheelRunId({ overdeckHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });
  });

  describe('abortFlywheelRun (PAN-1245)', () => {
    it('writes aborted.json and clears the gate when the run is active', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-7', '2026-05-18T10:00:00.000Z'), { overdeckHome });
      appSettingsMocks.activeRunId = 'RUN-7';
      appSettingsMocks.paused = true;

      await abortFlywheelRun('RUN-7', { overdeckHome });

      const aborted = JSON.parse(
        await readFile(join(overdeckHome, 'flywheel', 'runs', 'RUN-7', 'aborted.json'), 'utf8'),
      ) as { runId: string; abortedAt: string };
      expect(aborted.runId).toBe('RUN-7');
      expect(typeof aborted.abortedAt).toBe('string');
      expect(appSettingsMocks.activeRunId).toBeNull();
      expect(appSettingsMocks.paused).toBe(false);
    });

    it('leaves a different active run id alone', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-7', '2026-05-18T10:00:00.000Z'), { overdeckHome });
      await writeLatestFlywheelStatus(makeStatus('RUN-8', '2026-05-18T11:00:00.000Z'), { overdeckHome });
      appSettingsMocks.activeRunId = 'RUN-8';

      await abortFlywheelRun('RUN-7', { overdeckHome });

      expect(appSettingsMocks.activeRunId).toBe('RUN-8');
    });
  });
});
