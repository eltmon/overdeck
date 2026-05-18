import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';
import {
  getFlywheelRunPayload,
  getFlywheelRunsPayload,
  resolveFlywheelBriefPath,
} from '../flywheel.js';
import { writeLatestFlywheelStatus } from '../../services/flywheel-run-state.js';

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

describe('resolveFlywheelBriefPath', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pan-flywheel-brief-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('defaults to docs/flywheel-brief.md', () => {
    expect(resolveFlywheelBriefPath(projectRoot)).toEqual({
      ok: true,
      path: 'docs/flywheel-brief.md',
    });
  });

  it('accepts an absolute path inside the project root', () => {
    const path = resolve(projectRoot, 'docs/custom-brief.md');

    expect(resolveFlywheelBriefPath(projectRoot, path)).toEqual({
      ok: true,
      path: 'docs/custom-brief.md',
    });
  });

  it('rejects paths outside the project root', () => {
    const outside = resolve(projectRoot, '..', 'outside.md');

    expect(resolveFlywheelBriefPath(projectRoot, outside)).toEqual({
      ok: false,
      error: 'Brief path must stay inside the project root',
    });
  });
});

describe('flywheel run payload helpers', () => {
  let panopticonHome: string;

  beforeEach(async () => {
    panopticonHome = await mkdtemp(join(tmpdir(), 'pan-flywheel-routes-'));
  });

  afterEach(async () => {
    await rm(panopticonHome, { recursive: true, force: true });
  });

  it('returns run summaries sorted by startedAt desc', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-2', '2026-05-18T12:00:00.000Z'), { panopticonHome });

    await expect(getFlywheelRunsPayload({ panopticonHome })).resolves.toEqual([
      { id: 'RUN-2', startedAt: '2026-05-18T12:00:00.000Z', status: 'running' },
      { id: 'RUN-1', startedAt: '2026-05-18T10:00:00.000Z', status: 'running' },
    ]);
  });

  it('returns a run detail with report path when the run exists', async () => {
    const status = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');
    await writeLatestFlywheelStatus(status, { panopticonHome });
    const reportPath = join(panopticonHome, 'flywheel', 'runs', 'RUN-1', 'report.md');
    await writeFile(reportPath, '# Report\n');

    await expect(getFlywheelRunPayload('RUN-1', { panopticonHome })).resolves.toMatchObject({
      id: 'RUN-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      status: 'complete',
      latest: status,
      paths: { report: reportPath },
    });
  });

  it('returns null for a missing run', async () => {
    await expect(getFlywheelRunPayload('RUN-404', { panopticonHome })).resolves.toBeNull();
  });
});
