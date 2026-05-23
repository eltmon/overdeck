import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';

// PAN-1245: resolver reads SQLite via app-settings. Mock the gate so we can
// exercise self-healing without touching the real ~/.panopticon/state.db.
const appSettingsMocks = vi.hoisted(() => ({
  activeRunId: null as string | null,
  paused: false,
}));

vi.mock('../../../../lib/database/app-settings.js', () => ({
  getFlywheelActiveRunId: () => appSettingsMocks.activeRunId,
  isFlywheelGloballyPaused: () => appSettingsMocks.paused,
  setFlywheelActiveRunId: (runId: string | null) => {
    appSettingsMocks.activeRunId = runId;
  },
  setFlywheelGloballyPaused: (paused: boolean) => {
    appSettingsMocks.paused = paused;
  },
}));

import {
  abortFlywheelRun,
  getFlywheelRunDetail,
  listFlywheelRuns,
  nextFlywheelRunId,
  resolveLiveFlywheelRunId,
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

describe('flywheel run state', () => {
  let panopticonHome: string;

  beforeEach(async () => {
    panopticonHome = await mkdtemp(join(tmpdir(), 'pan-flywheel-run-state-'));
    appSettingsMocks.activeRunId = null;
    appSettingsMocks.paused = false;
  });

  afterEach(async () => {
    await rm(panopticonHome, { recursive: true, force: true });
  });

  it('writes and reads latest.json atomically', async () => {
    const status = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');

    const latestPath = await writeLatestFlywheelStatus(status, { panopticonHome });
    const detail = await getFlywheelRunDetail('RUN-1', { panopticonHome });

    expect(latestPath).toBe(join(panopticonHome, 'flywheel', 'runs', 'RUN-1', 'latest.json'));
    expect(detail?.latest).toEqual(status);
    expect(await readFile(latestPath, 'utf8')).toContain('"runId": "RUN-1"');
  });

  it('generates monotonic run IDs from existing run directories', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-9', '2026-05-18T11:00:00.000Z'), { panopticonHome });

    await expect(nextFlywheelRunId({ panopticonHome })).resolves.toBe('RUN-10');
  });

  it('lists runs sorted by startedAt desc with status derived from disk', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-2', '2026-05-18T12:00:00.000Z'), { panopticonHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-3', '2026-05-18T11:00:00.000Z'), { panopticonHome });
    await writeFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-2', 'report.md'), '# Report\n');
    await writeFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-3', 'aborted.json'), '{}\n');

    await expect(listFlywheelRuns({ panopticonHome })).resolves.toEqual([
      { id: 'RUN-2', startedAt: '2026-05-18T12:00:00.000Z', status: 'complete' },
      { id: 'RUN-3', startedAt: '2026-05-18T11:00:00.000Z', status: 'aborted' },
      { id: 'RUN-1', startedAt: '2026-05-18T10:00:00.000Z', status: 'running' },
    ]);
  });

  describe('resolveLiveFlywheelRunId (PAN-1245)', () => {
    it('returns null when the gate is empty', async () => {
      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBeNull();
    });

    it('returns the run id when the run is genuinely running', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBe('RUN-1');
      expect(appSettingsMocks.activeRunId).toBe('RUN-1');
    });

    it('clears a gate pointing at a completed run (report.md present)', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
      await writeFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-1', 'report.md'), '# Report\n');
      appSettingsMocks.activeRunId = 'RUN-1';
      appSettingsMocks.paused = true;

      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
      expect(appSettingsMocks.paused).toBe(false);
    });

    it('clears a gate pointing at an aborted run', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
      await writeFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-1', 'aborted.json'), '{}\n');
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });

    it('clears a gate whose run directory has no latest.json (post-wipe / never initialized)', async () => {
      appSettingsMocks.activeRunId = 'RUN-1';

      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });

    it('clears a gate holding a malformed run id', async () => {
      appSettingsMocks.activeRunId = 'not-a-run-id';

      await expect(resolveLiveFlywheelRunId({ panopticonHome })).resolves.toBeNull();
      expect(appSettingsMocks.activeRunId).toBeNull();
    });
  });

  describe('abortFlywheelRun (PAN-1245)', () => {
    it('writes aborted.json and clears the gate when the run is active', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-7', '2026-05-18T10:00:00.000Z'), { panopticonHome });
      appSettingsMocks.activeRunId = 'RUN-7';
      appSettingsMocks.paused = true;

      await abortFlywheelRun('RUN-7', { panopticonHome });

      const aborted = JSON.parse(
        await readFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-7', 'aborted.json'), 'utf8'),
      ) as { runId: string; abortedAt: string };
      expect(aborted.runId).toBe('RUN-7');
      expect(typeof aborted.abortedAt).toBe('string');
      expect(appSettingsMocks.activeRunId).toBeNull();
      expect(appSettingsMocks.paused).toBe(false);
    });

    it('leaves a different active run id alone', async () => {
      await writeLatestFlywheelStatus(makeStatus('RUN-7', '2026-05-18T10:00:00.000Z'), { panopticonHome });
      await writeLatestFlywheelStatus(makeStatus('RUN-8', '2026-05-18T11:00:00.000Z'), { panopticonHome });
      appSettingsMocks.activeRunId = 'RUN-8';

      await abortFlywheelRun('RUN-7', { panopticonHome });

      expect(appSettingsMocks.activeRunId).toBe('RUN-8');
    });
  });
});
