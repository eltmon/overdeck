import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFlywheelStats, type FlywheelStats, type FlywheelStatus } from '@panctl/contracts';
import {
  flywheelRouteLayer,
  getAutoMergeProblemPayload,
  getFlywheelConversationPayload,
  getFlywheelRunPayload,
  getFlywheelRunsPayload,
  deleteAutoMergePayload,
  getFlywheelStatsPayload,
  getPendingAutoMergePayload,
  postAutoMergeSchedulePayload,
  postFlywheelMergeNextPayload,
  postFlywheelPausePayload,
  postFlywheelReportOpenPayload,
  postFlywheelResumePayload,
  postFlywheelStartPayload,
  postFlywheelStatusPayload,
  resolveFlywheelBriefPath,
} from '../flywheel.js';
import { initEventStore } from '../../event-store.js';
import { readCurrentLatestFlywheelStatus, subscribeLatestFlywheelStatus, writeLatestFlywheelStatus } from '../../services/flywheel-run-state.js';
import { requireFlywheelBrief as requireDashboardFlywheelBrief } from '../../services/flywheel-actions.js';
import { resetDatabase } from '../../../../lib/database/index.js';
import { setFlywheelAutoPickupBacklog } from '../../../../lib/database/app-settings.js';
import { AUTO_MERGE_COOLDOWN_MS } from '../../../../lib/cloister/auto-merge-config.js';
import { markBlocked, markFailed, scheduleAutoMerge, transitionToMerging } from '../../../../lib/database/pending-auto-merges-db.js';

interface RouteResult {
  status: number;
  body: unknown;
}

async function requestFlywheelRoute(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(flywheelRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

function makeStats(window: string): FlywheelStats {
  return {
    window,
    generatedAt: '2026-05-25T10:00:00.000Z',
    criteria: {
      c1_bugRate: {
        label: 'Substrate-bug discovery rate',
        value: 0,
        target: 0.02,
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c2_p0Bugs: {
        label: 'Critical/P0 substrate bugs',
        value: 0,
        target: 0,
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c3_passRate: {
        label: 'Pipeline pass success rate',
        value: 0,
        target: 0.99,
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c4_mttr: {
        label: 'MTTR for filed substrate bugs',
        value: { medianMs: 0, p95Ms: 0 },
        target: { medianMs: 86400000, p95Ms: 604800000 },
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c5_intervention: {
        label: 'Operator intervention rate',
        value: 0,
        target: 0.05,
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c6_timeConsistency: {
        label: 'Time-in-pipeline consistency',
        value: { simple: 0, medium: 0, complex: 0 },
        target: { maxRatio: 2 },
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
      c7_flake: {
        label: 'Substrate-attributable flake rate',
        value: 0,
        target: 0.05,
        status: 'insufficient_data',
        sampleSize: 0,
        dataSufficient: false,
      },
    },
  };
}

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

describe('flywheel stats payload helper', () => {
  it('defaults missing window to 30d and validates the response shape', async () => {
    const seenWindows: string[] = [];
    const result = await getFlywheelStatsPayload(undefined, {
      compute: async (window) => {
        seenWindows.push(window);
        return makeStats(window);
      },
    });

    expect(result.status).toBe(200);
    expect(seenWindows).toEqual(['30d']);
    expect(decodeFlywheelStats(result.body)).toEqual(makeStats('30d'));
  });

  it('passes explicit 7d windows through to telemetry', async () => {
    const result = await getFlywheelStatsPayload('7d', {
      compute: async (window) => makeStats(window),
    });

    expect(result.status).toBe(200);
    expect(decodeFlywheelStats(result.body).window).toBe('7d');
  });

  it('returns 400 for invalid windows', async () => {
    const result = await getFlywheelStatsPayload('abc');

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'Invalid Flywheel stats window or payload' });
  });

  it('feeds persisted pipeline events into production stats criteria', async () => {
    const panopticonHome = join(tmpdir(), `pan-flywheel-stats-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(panopticonHome, { recursive: true });
    process.env.PANOPTICON_HOME = panopticonHome;
    resetDatabase();
    try {
      const store = await initEventStore();
      const appendRun = (issueId: string, minute: number, failedReview = false) => {
        const at = (offset: number) => `2026-05-25T09:${String(minute + offset).padStart(2, '0')}:00.000Z`;
        store.append({ type: 'plan.item_status_changed', timestamp: at(0), payload: { issueId, itemId: `${issueId}-1`, status: 'done' } } as never);
        store.append({ type: 'plan.item_status_changed', timestamp: at(0), payload: { issueId, itemId: `${issueId}-2`, status: 'done' } } as never);
        store.append({ type: 'pipeline.review-started', timestamp: at(1), payload: { issueId } } as never);
        store.append({
          type: 'pipeline.review-completed',
          timestamp: at(2),
          payload: { issueId, passed: !failedReview, substrateAttributable: failedReview, headSha: `${issueId}-sha` },
        } as never);
        store.append({ type: 'pipeline.test-started', timestamp: at(3), payload: { issueId } } as never);
        store.append({ type: 'pipeline.test-completed', timestamp: at(4), payload: { issueId, passed: true, headSha: `${issueId}-sha` } } as never);
        store.append({ type: 'issue.statusChanged', timestamp: at(5), payload: { issueId, canonicalStatus: 'verifying_on_main' } } as never);
      };

      appendRun('PAN-201', 0, true);
      appendRun('PAN-202', 10);
      appendRun('PAN-203', 20);
      store.append({
        type: 'operator.intervention',
        timestamp: '2026-05-25T09:06:00.000Z',
        payload: { issueId: 'PAN-201', kind: 'tell', source: 'dashboard' },
      } as never);

      const result = await getFlywheelStatsPayload('30d', { now: () => new Date('2026-05-25T10:00:00.000Z') });

      expect(result.status).toBe(200);
      const stats = decodeFlywheelStats(result.body);
      expect(stats.criteria.c1_bugRate.sampleSize).toBe(3);
      expect(stats.criteria.c3_passRate).toMatchObject({ sampleSize: 6, value: 5 / 6, dataSufficient: true });
      expect(stats.criteria.c5_intervention).toMatchObject({ sampleSize: 3, value: 1 / 3, dataSufficient: true });
      expect(stats.criteria.c6_timeConsistency).toMatchObject({ sampleSize: 3, dataSufficient: true });
      expect(stats.criteria.c7_flake).toMatchObject({ sampleSize: 1, value: 0, dataSufficient: true });
    } finally {
      resetDatabase();
      delete process.env.PANOPTICON_HOME;
      rmSync(panopticonHome, { recursive: true, force: true });
    }
  });
});

describe('flywheel config routes', () => {
  let panopticonHome: string;

  beforeEach(() => {
    panopticonHome = join(tmpdir(), `pan-flywheel-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(panopticonHome, { recursive: true });
    process.env.PANOPTICON_HOME = panopticonHome;
  });

  afterEach(() => {
    resetDatabase();
    delete process.env.PANOPTICON_HOME;
    rmSync(panopticonHome, { recursive: true, force: true });
  });

  it('returns both flywheel config defaults without requiring origin headers', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/config')).resolves.toEqual({
      status: 200,
      body: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false },
    });
  });

  it('origin-validates flywheel config updates', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_pickup_backlog: true }),
    })).resolves.toEqual({ status: 403, body: { error: 'Missing origin' } });
  });

  it('updates auto-pickup backlog and returns both values', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
      body: JSON.stringify({ auto_pickup_backlog: true }),
    })).resolves.toEqual({
      status: 200,
      body: { auto_pickup_backlog: true, require_uat_before_merge: true, merge_train_enabled: false },
    });
  });

  it('updates require-UAT and leaves auto-pickup unchanged on partial update', async () => {
    setFlywheelAutoPickupBacklog(true);

    await expect(requestFlywheelRoute('/api/flywheel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
      body: JSON.stringify({ require_uat_before_merge: false }),
    })).resolves.toEqual({
      status: 200,
      body: { auto_pickup_backlog: true, require_uat_before_merge: false, merge_train_enabled: false },
    });
  });

  it('toggles the merge-train flag (default off) without touching the others', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
      body: JSON.stringify({ merge_train_enabled: true }),
    })).resolves.toEqual({
      status: 200,
      body: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: true },
    });
  });

  it('rejects non-boolean flywheel config values', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
      body: JSON.stringify({ auto_pickup_backlog: 'yes' }),
    })).resolves.toEqual({ status: 400, body: { error: 'auto_pickup_backlog must be a boolean' } });
  });
});

describe('flywheel auto-merge routes', () => {
  let panopticonHome: string;

  const eligibleDeps = (overrides: Parameters<typeof postAutoMergeSchedulePayload>[1] = {}) => ({
    isRequireUatBeforeMerge: () => false,
    getProjectAutoMergeDefault: () => undefined,
    isFlywheelPaused: () => false,
    resolveLiveRunId: async () => 'RUN-7',
    isEligible: async () => ({ eligible: true as const }),
    getReviewStatus: () => ({
      issueId: 'PAN-1486',
      reviewStatus: 'passed' as const,
      testStatus: 'passed' as const,
      mergeStatus: 'pending' as const,
      updatedAt: '2026-05-25T10:00:00.000Z',
      readyForMerge: true,
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
    }),
    resolveProject: () => ({ projectKey: 'panopticon-cli', projectPath: process.cwd(), projectName: 'Panopticon CLI' }) as never,
    ...overrides,
  });

  beforeEach(() => {
    panopticonHome = join(tmpdir(), `pan-flywheel-auto-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(panopticonHome, { recursive: true });
    process.env.PANOPTICON_HOME = panopticonHome;
  });

  afterEach(() => {
    resetDatabase();
    delete process.env.PANOPTICON_HOME;
    rmSync(panopticonHome, { recursive: true, force: true });
  });

  it('exports the shared auto-merge cooldown constant', () => {
    expect(AUTO_MERGE_COOLDOWN_MS).toBe(300_000);
  });

  it('origin-validates auto-merge schedule requests', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: 'PAN-1486' }),
    })).resolves.toEqual({ status: 403, body: { error: 'Missing origin' } });

    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ issueId: 'PAN-1486' }),
    })).resolves.toEqual({ status: 403, body: { error: 'Invalid origin' } });
  });

  it('schedules eligible auto-merges after the cooldown and announces once', async () => {
    const now = new Date('2026-05-25T10:00:00.000Z');
    const announce = vi.fn();

    const first = await postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({ now: () => now, announce }));
    const second = await postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({ now: () => now, announce }));

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      issueId: 'PAN-1486',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
      prNumber: 1486,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
      status: 'pending',
    });
    expect(second).toEqual(first);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('rejects scheduling while UAT is still required', async () => {
    await expect(postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isRequireUatBeforeMerge: () => true,
    }))).resolves.toEqual({ status: 412, body: { error: 'UAT is still required before merge' } });
  });

  it('lets an explicit Auto-merge issue (autoMerge=true) override the require-UAT default', async () => {
    const now = new Date('2026-05-25T10:00:00.000Z');
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isRequireUatBeforeMerge: () => true,
      now: () => now,
      announce: vi.fn(),
      getReviewStatus: () => ({
        issueId: 'PAN-1486',
        reviewStatus: 'passed' as const,
        testStatus: 'passed' as const,
        mergeStatus: 'pending' as const,
        updatedAt: '2026-05-25T10:00:00.000Z',
        readyForMerge: true,
        autoMerge: true,
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
      }),
    }));
    expect(result.status).toBe(200);
  });

  it('per-project default "hold" blocks scheduling even when global require-UAT is off', async () => {
    await expect(postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isRequireUatBeforeMerge: () => false,
      getProjectAutoMergeDefault: () => 'hold',
    }))).resolves.toEqual({ status: 412, body: { error: 'UAT is still required before merge' } });
  });

  it('per-project default "auto" schedules even when global require-UAT is on', async () => {
    const now = new Date('2026-05-25T10:00:00.000Z');
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isRequireUatBeforeMerge: () => true,
      getProjectAutoMergeDefault: () => 'auto',
      now: () => now,
      announce: vi.fn(),
    }));
    expect(result.status).toBe(200);
  });

  it('rejects scheduling while flywheel is paused', async () => {
    await expect(postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isFlywheelPaused: () => true,
    }))).resolves.toEqual({ status: 423, body: { error: 'Flywheel is paused' } });
  });

  it('rejects ineligible PRs with the eligibility reason', async () => {
    await expect(postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, eligibleDeps({
      isEligible: async () => ({ eligible: false, reason: 'CI checks failing on PR HEAD deadbeef' }),
    }))).resolves.toEqual({ status: 422, body: { error: 'CI checks failing on PR HEAD deadbeef' } });
  });

  it('returns active pending auto-merges sorted by scheduled merge time', async () => {
    scheduleAutoMerge({
      issueId: 'PAN-2',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/2',
      prNumber: 2,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:10:00.000Z',
    });
    scheduleAutoMerge({
      issueId: 'PAN-1',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
      prNumber: 1,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
    });

    expect(getPendingAutoMergePayload().map((entry) => entry.issueId)).toEqual(['PAN-1', 'PAN-2']);
    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/pending')).resolves.toMatchObject({
      status: 200,
      body: [
        { issueId: 'PAN-1', scheduledMergeAt: '2026-05-25T10:05:00.000Z', status: 'pending', prNumber: 1 },
        { issueId: 'PAN-2', scheduledMergeAt: '2026-05-25T10:10:00.000Z', status: 'pending', prNumber: 2 },
      ],
    });
  });

  it('bounds the pending auto-merge polling payload', () => {
    for (let index = 0; index < 101; index += 1) {
      scheduleAutoMerge({
        issueId: `PAN-${1000 + index}`,
        prUrl: `https://github.com/eltmon/panopticon-cli/pull/${1000 + index}`,
        prNumber: 1000 + index,
        projectKey: 'panopticon-cli',
        scheduledAt: '2026-05-25T10:00:00.000Z',
        scheduledMergeAt: new Date(Date.parse('2026-05-25T10:00:00.000Z') + index * 1000).toISOString(),
      });
    }

    expect(getPendingAutoMergePayload()).toHaveLength(100);
    expect(getPendingAutoMergePayload().at(-1)?.issueId).toBe('PAN-1099');
  });

  it('keeps failed and blocked rows out of polling while exposing them through problems', async () => {
    const failed = scheduleAutoMerge({
      issueId: 'PAN-3',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/3',
      prNumber: 3,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
    });
    const blocked = scheduleAutoMerge({
      issueId: 'PAN-4',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/4',
      prNumber: 4,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:06:00.000Z',
    });

    transitionToMerging(failed.id);
    markFailed(failed.id, 'merge failed');
    markBlocked(blocked.id, 'CI checks failing');

    expect(getPendingAutoMergePayload()).toEqual([]);
    expect(getAutoMergeProblemPayload()).toMatchObject([
      { issueId: 'PAN-3', status: 'failed', failureReason: 'merge failed' },
      { issueId: 'PAN-4', status: 'blocked', failureReason: 'CI checks failing' },
    ]);
    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/problems')).resolves.toMatchObject({
      status: 200,
      body: [
        { issueId: 'PAN-3', status: 'failed', failureReason: 'merge failed' },
        { issueId: 'PAN-4', status: 'blocked', failureReason: 'CI checks failing' },
      ],
    });
  });

  it('origin-validates auto-merge cancellations', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/PAN-1486', {
      method: 'DELETE',
    })).resolves.toEqual({ status: 403, body: { error: 'Missing origin' } });

    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/PAN-1486', {
      method: 'DELETE',
      headers: { origin: 'https://evil.example' },
    })).resolves.toEqual({ status: 403, body: { error: 'Invalid origin' } });
  });

  it('cancels pending auto-merges, removes them from the active list, and announces once', () => {
    scheduleAutoMerge({
      issueId: 'PAN-1486',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
      prNumber: 1486,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
    });
    const announce = vi.fn();

    expect(deleteAutoMergePayload('pan-1486', {
      now: () => new Date('2026-05-25T10:01:00.000Z'),
      announce,
    })).toMatchObject({
      status: 200,
      body: {
        issueId: 'PAN-1486',
        status: 'cancelled',
        cancelledAt: '2026-05-25T10:01:00.000Z',
        cancelledBy: 'operator',
      },
    });
    expect(getPendingAutoMergePayload()).toEqual([]);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('PAN-1486');
  });

  it('clears failed and blocked auto-merges through the cancellation route', () => {
    const failed = scheduleAutoMerge({
      issueId: 'PAN-3',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/3',
      prNumber: 3,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
    });
    const blocked = scheduleAutoMerge({
      issueId: 'PAN-4',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/4',
      prNumber: 4,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:06:00.000Z',
    });

    transitionToMerging(failed.id);
    markFailed(failed.id, 'merge failed');
    markBlocked(blocked.id, 'CI checks failing');

    expect(deleteAutoMergePayload('PAN-3', { announce: vi.fn() })).toMatchObject({
      status: 200,
      body: { issueId: 'PAN-3', status: 'cancelled', cancelledBy: 'operator' },
    });
    expect(deleteAutoMergePayload('PAN-4', { announce: vi.fn() })).toMatchObject({
      status: 200,
      body: { issueId: 'PAN-4', status: 'cancelled', cancelledBy: 'operator' },
    });
    expect(getPendingAutoMergePayload()).toEqual([]);
  });

  it('returns 409 when cancellation races a merging entry', async () => {
    const entry = scheduleAutoMerge({
      issueId: 'PAN-1486',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
      prNumber: 1486,
      projectKey: 'panopticon-cli',
      scheduledAt: '2026-05-25T10:00:00.000Z',
      scheduledMergeAt: '2026-05-25T10:05:00.000Z',
    });
    transitionToMerging(entry.id);

    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/PAN-1486', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3011' },
    })).resolves.toEqual({
      status: 409,
      body: { error: 'Auto-merge cooldown has expired for PAN-1486; merge is in progress' },
    });
  });

  it('returns 404 for missing pending auto-merges', async () => {
    await expect(requestFlywheelRoute('/api/flywheel/auto-merge/PAN-999', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3011' },
    })).resolves.toEqual({ status: 404, body: { error: 'No pending auto-merge for PAN-999' } });
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
    const received: (FlywheelStatus | null)[] = [];
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

    // PAN-1528: latest.system.agentsActive is now overlaid with the live
    // work-agent count from <panopticonHome>/agents/. Empty test home => 0.
    await expect(getFlywheelRunPayload('RUN-1', { panopticonHome })).resolves.toMatchObject({
      id: 'RUN-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      status: 'complete',
      latest: { ...status, system: { ...status.system, agentsActive: 0 } },
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
    // PAN-1528: agentsActive overlaid with live count from empty test home.
    await expect(readCurrentLatestFlywheelStatus({ panopticonHome, activeRunId: 'RUN-2' })).resolves.toEqual({
      ...running,
      system: { ...running.system, agentsActive: 0 },
    });
  });

  it('returns null for a missing run', async () => {
    await expect(getFlywheelRunPayload('RUN-404', { panopticonHome })).resolves.toBeNull();
  });
});

describe('postFlywheelMergeNextPayload (PAN-1691 merge next N / ship batch)', () => {
  it('rejects a non-positive n', async () => {
    await expect(postFlywheelMergeNextPayload({ n: 0 }))
      .resolves.toEqual({ status: 400, body: { error: 'n must be a positive integer' } });
    await expect(postFlywheelMergeNextPayload({}))
      .resolves.toEqual({ status: 400, body: { error: 'n must be a positive integer' } });
  });

  it('merges the first N in order and stops at the first failure', async () => {
    const merge = vi.fn(async (id: string) =>
      id === 'PAN-2' ? { ok: false as const, reason: 'CI red' } : { ok: true as const });
    const result = await postFlywheelMergeNextPayload({ n: 3 }, {
      getOrderedIssueIds: async () => ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4'],
      merge,
    });
    expect(result).toEqual({
      status: 200,
      body: {
        outcomes: [
          { issueId: 'PAN-1', result: 'merged' },
          { issueId: 'PAN-2', result: 'failed', reason: 'CI red' },
          { issueId: 'PAN-3', result: 'skipped' },
        ],
      },
    });
    expect(merge).toHaveBeenCalledTimes(2); // PAN-4 not in the slice; PAN-3 skipped after the failure
  });
});
