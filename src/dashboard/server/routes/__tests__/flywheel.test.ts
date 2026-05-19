import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';
import {
  getFlywheelConversationPayload,
  getFlywheelRunPayload,
  getFlywheelRunsPayload,
  postFlywheelPausePayload,
  postFlywheelReportOpenPayload,
  postFlywheelResumePayload,
  postFlywheelStartPayload,
  postFlywheelStatusPayload,
  resolveFlywheelBriefPath,
} from '../flywheel.js';
import { readCurrentLatestFlywheelStatus, subscribeLatestFlywheelStatus, writeLatestFlywheelStatus } from '../../services/flywheel-run-state.js';
import { requireFlywheelBrief as requireDashboardFlywheelBrief } from '../../services/flywheel-actions.js';

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

  it('rejects brief symlinks that resolve outside the project root', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-brief-outside-'));
    try {
      await writeFile(join(outsideDir, 'brief.md'), '# Outside\n');
      await symlink(join(outsideDir, 'brief.md'), join(projectRoot, 'brief-link.md'));

      await expect(requireDashboardFlywheelBrief(projectRoot, './brief-link.md')).rejects.toThrow('Brief path must stay inside the project root');
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('flywheel status POST payload helper', () => {
  let panopticonHome: string;

  beforeEach(async () => {
    panopticonHome = await mkdtemp(join(tmpdir(), 'pan-flywheel-post-'));
  });

  afterEach(async () => {
    await rm(panopticonHome, { recursive: true, force: true });
  });

  it('accepts a valid status, persists latest.json, and notifies subscribers', async () => {
    const status = makeStatus('RUN-7', '2026-05-18T13:00:00.000Z');
    const received: FlywheelStatus[] = [];
    const unsubscribe = subscribeLatestFlywheelStatus((next) => received.push(next));

    const result = await postFlywheelStatusPayload(status, { panopticonHome });
    unsubscribe();

    expect(result).toEqual({ status: 200, body: { ok: true, runId: 'RUN-7' } });
    await expect(readFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-7', 'latest.json'), 'utf8'))
      .resolves.toEqual(`${JSON.stringify(status, null, 2)}\n`);
    expect(received).toEqual([status]);
  });

  it.each([
    ['missing runId', { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z'), runId: undefined }],
    ['path traversal runId', { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z'), runId: '../../RUN-1' }],
    ['unsafe bug URL', { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z'), substrateBugs: [{ issueId: 'PAN-1', title: 'Bad link', status: 'fixed', url: 'javascript:alert(1)' }] }],
    ['invalid orchestrator effort', { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z'), orchestrator: { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z').orchestrator, effort: 'maximum' } }],
    ['invalid activePipeline', { ...makeStatus('RUN-1', '2026-05-18T13:00:00.000Z'), activePipeline: [{ issueId: 'PAN-1' }] }],
  ])('rejects schema-invalid payloads: %s', async (_name, payload) => {
    const result = await postFlywheelStatusPayload(payload, { panopticonHome });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'Invalid FlywheelStatus payload' });
    expect('details' in result.body && result.body.details.length).toBeGreaterThan(0);
  });
});

describe('flywheel action payload helpers', () => {
  it('starts, pauses, resumes, and opens reports through lifecycle actions', async () => {
    const start = async () => ({ runId: 'RUN-3', briefDisplayPath: 'docs/flywheel-brief.md', agentModel: 'claude-opus-4-7' });
    const pause = async () => ({ before: { paused: false, activeRunId: 'RUN-3' }, after: { paused: true, activeRunId: 'RUN-3' }, changed: true });
    const resume = async () => ({ before: { paused: true, activeRunId: 'RUN-3' }, after: { paused: false, activeRunId: 'RUN-3' }, changed: true });
    const openReport = async () => ({ runId: 'RUN-3', path: '/tmp/report.md' });

    await expect(postFlywheelStartPayload({ brief: 'docs/flywheel-brief.md' }, { start })).resolves.toEqual({ status: 200, body: { ok: true, runId: 'RUN-3' } });
    await expect(postFlywheelPausePayload({ pause })).resolves.toEqual({ status: 200, body: { ok: true, changed: true } });
    await expect(postFlywheelResumePayload({ resume })).resolves.toEqual({ status: 200, body: { ok: true, changed: true } });
    await expect(postFlywheelReportOpenPayload({ runId: 'RUN-3' }, { openReport })).resolves.toEqual({ status: 200, body: { ok: true, runId: 'RUN-3', path: '/tmp/report.md' } });
  });

  it('rejects invalid action payload fields', async () => {
    await expect(postFlywheelStartPayload({ brief: 1 })).resolves.toEqual({ status: 400, body: { error: 'brief must be a string when provided' } });
    await expect(postFlywheelReportOpenPayload({ runId: '../RUN-3' })).resolves.toEqual({ status: 400, body: { error: 'Flywheel run id must match RUN-<number>' } });
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

  it('limits run summaries and ignores non-canonical run directories', async () => {
    await writeLatestFlywheelStatus(makeStatus('RUN-1', '2026-05-18T10:00:00.000Z'), { panopticonHome });
    await writeLatestFlywheelStatus(makeStatus('RUN-2', '2026-05-18T12:00:00.000Z'), { panopticonHome });
    await mkdir(join(panopticonHome, 'flywheel', 'runs', 'not-a-run'), { recursive: true });

    await expect(getFlywheelRunsPayload({ panopticonHome, limit: 1 })).resolves.toEqual([
      { id: 'RUN-2', startedAt: '2026-05-18T12:00:00.000Z', status: 'running' },
    ]);
  });

  it('returns null for a non-canonical run id', async () => {
    await expect(getFlywheelRunPayload('../RUN-1', { panopticonHome })).resolves.toBeNull();
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

  it('bootstraps the current status from the active running run only', async () => {
    const completed = makeStatus('RUN-1', '2026-05-18T10:00:00.000Z');
    const running = makeStatus('RUN-2', '2026-05-18T12:00:00.000Z');
    await writeLatestFlywheelStatus(completed, { panopticonHome });
    await writeFile(join(panopticonHome, 'flywheel', 'runs', 'RUN-1', 'report.md'), '# Report\n');
    await writeLatestFlywheelStatus(running, { panopticonHome });

    await expect(readCurrentLatestFlywheelStatus({ panopticonHome, activeRunId: null })).resolves.toBeNull();
    await expect(readCurrentLatestFlywheelStatus({ panopticonHome, activeRunId: 'RUN-1' })).resolves.toBeNull();
    await expect(readCurrentLatestFlywheelStatus({ panopticonHome, activeRunId: 'RUN-2' })).resolves.toEqual(running);
  });

  it('returns null for a missing run', async () => {
    await expect(getFlywheelRunPayload('RUN-404', { panopticonHome })).resolves.toBeNull();
  });
});
