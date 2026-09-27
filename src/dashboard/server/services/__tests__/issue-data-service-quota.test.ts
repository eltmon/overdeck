/**
 * PAN-4264 Work Item 7: the GitHub issue poller honors the PAT REST pause —
 * no Octokit call during the pause, and the next poll waits for its end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { octokitConstructed, getGitHubConfigMock } = vi.hoisted(() => ({
  octokitConstructed: vi.fn(),
  getGitHubConfigMock: vi.fn(() => ({ token: 'ghp_test', repos: [{ owner: 'o', repo: 'r', prefix: 'R' }] })),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    issues = { listForRepo: vi.fn() };
    paginate = vi.fn(async () => []);
    constructor() {
      octokitConstructed();
    }
  },
}));

vi.mock('../tracker-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tracker-config.js')>()),
  getGitHubConfig: getGitHubConfigMock,
}));

vi.mock('../issue-title-fallback.js', () => ({
  resolveMissingIssue: vi.fn(),
  resolveMissingIssueTitles: vi.fn(async () => new Map()),
}));

import { IssueDataService } from '../issue-data-service.js';
import { recordGitHubRefusal } from '../../../../lib/github-quota/pause-gate.js';

describe('IssueDataService GitHub poll during a quota pause (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-issue-poller-quota-'));
    process.env.OVERDECK_HOME = home;
    octokitConstructed.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  function makeService() {
    const cache = {
      getBackoffMs: () => 0,
      getSuspensionMs: () => 0,
      getEtag: () => null,
      set: vi.fn(),
      updateRateLimit: vi.fn(),
    } as any;
    const svc = new IssueDataService(cache);
    vi.spyOn(svc as any, 'pushUpdated').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushMeta').mockImplementation(() => {});
    return svc;
  }

  it('makes no Octokit call during a pat REST pause and schedules the next poll at the pause end', async () => {
    await recordGitHubRefusal({
      pool: 'pat', bucket: 'rest', caller: 'issue-poller', refusal: { kind: 'secondary', retryAfterSec: 300 },
    });
    const svc = makeService();

    await (svc as any).pollGitHub();
    expect(octokitConstructed).not.toHaveBeenCalled();

    (svc as any).started = true;
    (svc as any).scheduleNext('github');
    expect((svc as any).trackers.github.currentInterval).toBe(300_000);
    svc.stop();
  });

  it('polls through Octokit when no pause is active', async () => {
    const svc = makeService();
    await (svc as any).pollGitHub();
    expect(octokitConstructed).toHaveBeenCalledTimes(1);

    (svc as any).started = true;
    (svc as any).scheduleNext('github');
    expect((svc as any).trackers.github.currentInterval).toBe(30_000);
    svc.stop();
  });

  it('ignores a pause on another pool', async () => {
    await recordGitHubRefusal({
      pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'secondary', retryAfterSec: 300 },
    });
    const svc = makeService();
    await (svc as any).pollGitHub();
    expect(octokitConstructed).toHaveBeenCalledTimes(1);
    svc.stop();
  });
});
