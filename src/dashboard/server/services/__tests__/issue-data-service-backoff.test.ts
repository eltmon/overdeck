/**
 * PAN-4507: the GitHub issue poller backs off while nothing changes and
 * returns to the default cadence on a change or an operator refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { paginateMock } = vi.hoisted(() => ({
  paginateMock: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    issues = { listForRepo: vi.fn() };
    paginate = paginateMock;
  },
}));

vi.mock('../tracker-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tracker-config.js')>()),
  getGitHubConfig: () => ({ token: 'ghp_test', repos: [{ owner: 'o', repo: 'r', prefix: 'R' }] }),
  getLinearApiKey: () => null,
  getRallyConfig: () => null,
}));

vi.mock('../issue-title-fallback.js', () => ({
  resolveMissingIssue: vi.fn(),
  resolveMissingIssueTitles: vi.fn(async () => new Map()),
}));

import { IssueDataService } from '../issue-data-service.js';
import { flushLedgerWrites } from '../../../../lib/github-quota/ledger.js';

const HEADERS = { 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1790000000' };

/** paginate stub: maps one page of `data` through the caller's mapFn. */
function pageOf(data: unknown[]) {
  return async (_fn: unknown, _params: unknown, mapFn?: (response: unknown) => unknown[]) =>
    mapFn ? mapFn({ headers: HEADERS, data }) : data;
}

function ghIssue(number: number, updatedAt: string) {
  return {
    number,
    title: `Issue ${number}`,
    state: 'open',
    labels: [],
    assignee: null,
    html_url: `https://github.com/o/r/issues/${number}`,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: updatedAt,
    body: '',
  };
}

describe('IssueDataService GitHub unchanged backoff (PAN-4507)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;
  let svc: IssueDataService;
  let backoffMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 4, 12, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-issue-poller-backoff-'));
    process.env.OVERDECK_HOME = home;
    paginateMock.mockReset();
    paginateMock.mockImplementation(pageOf([]));
    backoffMs = 0;
    svc = makeService();
  });

  afterEach(async () => {
    svc.stop();
    vi.useRealTimers();
    await flushLedgerWrites();
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  function makeService() {
    const cache = {
      getBackoffMs: () => backoffMs,
      getSuspensionMs: () => 0,
      getRateLimit: () => null,
      getEtag: () => null,
      getStale: () => null,
      set: vi.fn(),
      updateRateLimit: vi.fn(),
      invalidate: vi.fn(),
    } as any;
    const service = new IssueDataService(cache);
    vi.spyOn(service as any, 'pushUpdated').mockImplementation(() => {});
    vi.spyOn(service as any, 'pushSnapshot').mockImplementation(() => {});
    vi.spyOn(service as any, 'pushMeta').mockImplementation(() => {});
    return service;
  }

  const github = () => (svc as any).trackers.github;

  /** Start the GitHub timer chain and run `polls` scheduled polls. */
  async function grow(polls: number): Promise<void> {
    (svc as any).started = true;
    (svc as any).scheduleNext('github');
    for (let i = 0; i < polls; i++) await vi.advanceTimersByTimeAsync(github().currentInterval);
  }

  it('grows the interval on unchanged polls and caps it at the max', async () => {
    await grow(0);
    const seen = [github().currentInterval];
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(github().currentInterval);
      seen.push(github().currentInterval);
    }
    expect(seen).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it('resets to the default interval after a changed poll', async () => {
    await grow(3);
    expect(github().currentInterval).toBe(240_000);

    paginateMock.mockImplementation(pageOf([ghIssue(1, '2026-10-04T11:00:00Z')]));
    await vi.advanceTimersByTimeAsync(240_000);

    expect(github().unchangedStreak).toBe(0);
    expect(github().currentInterval).toBe(30_000);
  });

  it('resets to the default interval after an operator refresh, with one armed timer', async () => {
    await grow(3);
    expect(github().currentInterval).toBe(240_000);

    await svc.invalidateTracker('github');

    expect(github().currentInterval).toBe(30_000);
    expect(github().unchangedStreak).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('lets a longer rate-limit backoff win over the unchanged backoff', async () => {
    backoffMs = 120_000;
    await grow(1);
    expect(github().currentInterval).toBe(150_000);
    expect(github().intervalReason).toBe('rate-limit-backoff');
  });

  describe('resetPollCadence', () => {
    it('re-arms a backed-off poll at the default interval without polling', async () => {
      await grow(4);
      expect(github().currentInterval).toBe(300_000);
      await vi.advanceTimersByTimeAsync(10_000);
      const callsBefore = paginateMock.mock.calls.length;

      svc.resetPollCadence('github');

      expect(github().unchangedStreak).toBe(0);
      expect(github().currentInterval).toBe(30_000);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(paginateMock.mock.calls.length).toBe(callsBefore);
      await vi.advanceTimersByTimeAsync(1);
      expect(paginateMock.mock.calls.length).toBe(callsBefore + 2);
    });

    it('leaves a poll that is already due within the default interval alone', async () => {
      await grow(4);
      svc.resetPollCadence('github');
      await vi.advanceTimersByTimeAsync(10_000);
      const due = github().nextPollAt;

      svc.resetPollCadence('github');

      expect(github().nextPollAt).toBe(due);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('keeps an in-flight unchanged poll from advancing the streak after a reset', async () => {
      await grow(0);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      paginateMock.mockImplementationOnce(async (fn: unknown, params: unknown, mapFn?: (response: unknown) => unknown[]) => {
        await gate;
        return pageOf([])(fn, params, mapFn);
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(github().timer).toBeNull();

      svc.resetPollCadence('github');
      release();
      await vi.advanceTimersByTimeAsync(0);

      expect(github().unchangedStreak).toBe(0);
      expect(github().currentInterval).toBe(30_000);
    });

    it('ends clearCacheAndRefresh at the default interval', async () => {
      await grow(3);
      expect(github().currentInterval).toBe(240_000);

      await svc.clearCacheAndRefresh();

      expect(github().currentInterval).toBe(30_000);
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe('getDiagnostics', () => {
    it('reports the default cadence before any poll is scheduled', () => {
      expect(svc.getDiagnostics().github).toMatchObject({
        pollIntervalReason: 'default',
        unchangedStreak: 0,
        nextPollAt: null,
      });
    });

    it('reports the unchanged backoff, streak and next poll time', async () => {
      await grow(2);
      expect(svc.getDiagnostics().github).toMatchObject({
        pollInterval: 120_000,
        pollIntervalReason: 'unchanged-backoff',
        unchangedStreak: 2,
        nextPollAt: new Date(Date.now() + 120_000).toISOString(),
      });
    });

    it('reports a rate-limit backoff', async () => {
      backoffMs = 120_000;
      await grow(0);
      expect(svc.getDiagnostics().github.pollIntervalReason).toBe('rate-limit-backoff');
    });
  });
});
