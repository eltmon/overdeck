import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';
import {
  getFlywheelRunDetail,
  listFlywheelRuns,
  nextFlywheelRunId,
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
});
