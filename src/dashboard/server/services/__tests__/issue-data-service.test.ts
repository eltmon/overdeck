import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeTaskCounts, IssueDataService, shouldRefreshPlanningStateForIssue } from '../issue-data-service.js';
import type { XBriefDocument } from '../../../../lib/xbrief/types.js';
import { mergeConfigs } from '../../../../lib/config-yaml.js';

const mockResolveMissingIssue = vi.hoisted(() => vi.fn());
vi.mock('../issue-title-fallback.js', () => ({
  resolveMissingIssue: (id: string) => mockResolveMissingIssue(id),
  resolveMissingIssueTitles: vi.fn(async () => new Map()),
}));

describe('computeTaskCounts', () => {
  function makeDoc(items: Array<{ status: string }>): XBriefDocument {
    return {
      xBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: items.map((it, idx) => ({
          id: `item-${idx}`,
          title: `Task ${idx}`,
          status: it.status as any,
        })),
        edges: [],
      },
    };
  }

  it('returns completed and total for a plan with 7 completed of 12', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      status: i < 7 ? 'completed' : 'pending',
    }));
    const doc = makeDoc(items);
    expect(computeTaskCounts(doc)).toEqual({ completed: 7, total: 12 });
  });

  it('returns 0 completed for a plan with 0 of 5', () => {
    const items = Array.from({ length: 5 }, () => ({ status: 'pending' }));
    const doc = makeDoc(items);
    expect(computeTaskCounts(doc)).toEqual({ completed: 0, total: 5 });
  });

  it('returns null when the plan has no items', () => {
    const doc = makeDoc([]);
    expect(computeTaskCounts(doc)).toBeNull();
  });

  it('returns null when the document is null', () => {
    expect(computeTaskCounts(null)).toBeNull();
  });

  it('returns null when the document has no plan', () => {
    const doc = {
      xBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: { id: 'plan-1', title: 'Test', status: 'active', items: [], edges: [] },
    } as XBriefDocument;
    expect(computeTaskCounts(doc)).toBeNull();
  });
});

// PAN-1817: peer dashboards (workspace containers, OVERDECK_DISABLE_DEACON=1) must
// load the cache but start ZERO tracker polling. ~17 container pollers against the one
// shared Linear API key exhausted Linear's 2500/hr quota. This locks the gate so it
// can't be silently removed — deleting `skipPolling` turns this suite red.
describe('IssueDataService tracker-polling gate (PAN-1817)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function makeService() {
    // Constructor only stores the cache; scheduleNext calls getBackoffMs.
    const cache = { getBackoffMs: () => 0 } as any;
    const svc = new IssueDataService(cache);
    // Stub the cache-loading / snapshot plumbing so the test exercises only the
    // poll-vs-no-poll branch, with no SQLite or network dependency.
    vi.spyOn(svc as any, 'ensureShadowStateLoaded').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'loadCachedData').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushSnapshot').mockImplementation(() => {});
    const polls = {
      github: vi.spyOn(svc as any, 'pollGitHub').mockResolvedValue(undefined),
      linear: vi.spyOn(svc as any, 'pollLinear').mockResolvedValue(undefined),
      rally: vi.spyOn(svc as any, 'pollRally').mockResolvedValue(undefined),
    };
    return { svc, polls };
  }

  it('skipPolling:true loads the cache but starts NO tracker fetches and schedules no timers', async () => {
    const { svc, polls } = makeService();
    await svc.start({ skipPolling: true });

    expect(polls.github).not.toHaveBeenCalled();
    expect(polls.linear).not.toHaveBeenCalled();
    expect(polls.rally).not.toHaveBeenCalled();
    expect((svc as any).trackers.github.timer).toBeNull();
    expect((svc as any).trackers.linear.timer).toBeNull();
    expect((svc as any).trackers.rally.timer).toBeNull();

    // Cache was still loaded so the peer dashboard can serve issues read-only.
    expect((svc as any).loadCachedData).toHaveBeenCalledTimes(1);
    svc.stop();
  });

  it('default start() (no options) DOES poll every tracker — the gate is strictly opt-in', async () => {
    const { svc, polls } = makeService();
    await svc.start();

    // Polls are invoked synchronously inside Promise.allSettled([...]).
    expect(polls.github).toHaveBeenCalledTimes(1);
    expect(polls.linear).toHaveBeenCalledTimes(1);
    expect(polls.rally).toHaveBeenCalledTimes(1);
    svc.stop();
  });
});

describe('IssueDataService planning refresh gate', () => {
  function makeService() {
    const cache = { getBackoffMs: () => 0 } as any;
    const svc = new IssueDataService(cache);
    vi.spyOn(svc as any, 'drainPlanningRefreshQueue').mockImplementation(() => {});
    return svc;
  }

  it('queues planning refreshes for active issues only, not terminal done/canceled issues', () => {
    const svc = makeService();
    const terminal = Array.from({ length: 1000 }, (_, idx) => ({
      identifier: `PAN-DONE-${idx}`,
      status: idx % 2 === 0 ? 'Done' : 'Canceled',
    }));
    const active = Array.from({ length: 10 }, (_, idx) => ({
      identifier: `PAN-ACTIVE-${idx}`,
      status: idx % 2 === 0 ? 'In Progress' : 'Todo',
    }));

    (svc as any).schedulePlanningRefreshForIssues([...terminal, ...active]);

    expect((svc as any).planningRefreshQueue).toEqual(active.map((issue) => issue.identifier));
    expect((svc as any).planningRefreshQueued.size).toBe(10);
  });

  it('preserves planning refreshes for active non-terminal issues', () => {
    const svc = makeService();
    const active = [
      { identifier: 'PAN-READY', status: 'Ready' },
      { identifier: 'PAN-REVIEW', status: 'In Review' },
      { identifier: 'PAN-VERIFYING', status: 'Verifying on main' },
    ];

    (svc as any).schedulePlanningRefreshForIssues(active);

    expect((svc as any).planningRefreshQueue).toEqual(['PAN-READY', 'PAN-REVIEW', 'PAN-VERIFYING']);
  });

  it('uses getCanonicalStatus stateType handling rather than a separate status mapping', () => {
    expect(shouldRefreshPlanningStateForIssue({
      identifier: 'PAN-CUSTOM-DONE',
      status: 'Custom Done Name',
      stateType: 'completed',
    })).toBe(false);
    expect(shouldRefreshPlanningStateForIssue({
      identifier: 'PAN-CUSTOM-ACTIVE',
      status: 'Custom Active Name',
      stateType: 'started',
    })).toBe(true);
  });
});

describe('IssueDataService GitHub closed issue window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeCache() {
    return {
      getEtag: vi.fn(() => null),
      updateRateLimit: vi.fn(),
      set: vi.fn(),
      getStale: vi.fn(() => null),
    };
  }

  function makeOctokit() {
    const paginate = vi.fn(async (_method: unknown, params: unknown, mapFn: (response: any) => unknown) => {
      mapFn({
        headers: {
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': `${Math.floor(Date.now() / 1000) + 3600}`,
          etag: 'etag-1',
        },
        data: [],
      });
      return [];
    });
    return {
      issues: { listForRepo: vi.fn() },
      paginate,
    };
  }

  it('adds since to the closed GitHub issue fetch from the default config window', async () => {
    const merged = mergeConfigs({}).config;
    const cache = makeCache();
    const service = new IssueDataService(cache as any, {
      loadConfig: () => ({ config: merged }),
    });
    const octokit = makeOctokit();

    await (service as any).fetchGitHubRepoIssues(octokit, 'eltmon', 'overdeck', 'closed', 'PAN', 'github:closed:eltmon/overdeck');

    expect(merged.issues.closedWindowDays).toBe(14);
    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.issues.listForRepo,
      expect.objectContaining({
        state: 'closed',
        since: '2026-06-19T12:00:00.000Z',
      }),
      expect.any(Function),
    );
  });

  it('uses a closed_window_days override to compute the closed issue since lower bound', async () => {
    const merged = mergeConfigs({ issues: { closed_window_days: 3 } }).config;
    const cache = makeCache();
    const service = new IssueDataService(cache as any, {
      loadConfig: () => ({ config: merged }),
    });
    const octokit = makeOctokit();

    await (service as any).fetchGitHubRepoIssues(octokit, 'eltmon', 'overdeck', 'closed', 'PAN', 'github:closed:eltmon/overdeck');

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.issues.listForRepo,
      expect.objectContaining({
        state: 'closed',
        since: '2026-06-30T12:00:00.000Z',
      }),
      expect.any(Function),
    );
  });

  it('does not add since to the open GitHub issue fetch', async () => {
    const merged = mergeConfigs({ issues: { closed_window_days: 3 } }).config;
    const cache = makeCache();
    const service = new IssueDataService(cache as any, {
      loadConfig: () => ({ config: merged }),
    });
    const octokit = makeOctokit();

    await (service as any).fetchGitHubRepoIssues(octokit, 'eltmon', 'overdeck', 'open', 'PAN', 'github:open:eltmon/overdeck');

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.issues.listForRepo,
      expect.not.objectContaining({ since: expect.anything() }),
      expect.any(Function),
    );
  });
});

describe('IssueDataService getIssues memoization', () => {
  function makeCache() {
    return {
      getBackoffMs: () => 0,
    };
  }

  function makeServiceWithIssues(issues: any[]) {
    const service = new IssueDataService(makeCache() as any);
    (service as any).trackers.github.lastFetchedIssues = issues;
    (service as any).trackers.linear.lastFetchedIssues = [];
    (service as any).trackers.rally.lastFetchedIssues = [];
    return service;
  }

  it('returns the identical array instance across repeated getIssues calls without a data change', () => {
    const service = makeServiceWithIssues([
      { identifier: 'PAN-1', status: 'Todo', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);

    const first = service.getIssues();
    const second = service.getIssues();

    expect(second).toBe(first);
  });

  it('invalidates the memo when pushUpdated runs', () => {
    const service = makeServiceWithIssues([
      { identifier: 'PAN-1', status: 'Todo', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const first = service.getIssues();
    (service as any).trackers.github.lastFetchedIssues = [
      { identifier: 'PAN-1', status: 'In Progress', updatedAt: '2026-07-02T00:00:00.000Z' },
    ];

    (service as any).pushUpdated();
    const next = service.getIssues();

    expect(next).not.toBe(first);
    expect(next[0]?.status).toBe('In Progress');
  });

  it('reuses the cached serialized JSON string for repeated route responses', () => {
    const service = makeServiceWithIssues([
      { identifier: 'PAN-1', status: 'Todo', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const stringifySpy = vi.spyOn(JSON, 'stringify');

    const first = service.getIssuesJson();
    const second = service.getIssuesJson();

    expect(second).toBe(first);
    expect(stringifySpy).toHaveBeenCalledTimes(1);
    stringifySpy.mockRestore();
  });

  it('sorts with parse-once timestamps in the same order as the old Date comparator', () => {
    const source = [
      { identifier: 'PAN-3', status: 'Todo', updatedAt: '2026-06-30T00:00:00.000Z' },
      { identifier: 'PAN-1', status: 'Todo', updatedAt: '2026-07-01T00:00:00.000Z' },
      { identifier: 'PAN-2', status: 'Todo', updatedAt: '2026-07-02T00:00:00.000Z' },
    ];
    const service = makeServiceWithIssues(source);

    const actual = service.getIssues().map((issue) => issue.identifier);
    const expected = source
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((issue) => issue.identifier);

    expect(actual).toEqual(expected);
  });
});

// PAN-3659: issues closed beyond the tracker sync window (closedWindowDays)
// vanish from the read model, so the issue view renders "Issue details"
// instead of the title. backfillIssue re-resolves them through the tracker
// door on demand and holds them until the windowed poll covers them again.
describe('IssueDataService.backfillIssue (PAN-3659)', () => {
  function makeService() {
    const svc = new IssueDataService({ getBackoffMs: () => 0 } as any);
    vi.spyOn(svc as any, 'schedulePlanningRefreshForIssues').mockImplementation(() => {});
    vi.spyOn(svc as any, 'scheduleReviewStatusRefreshForIssues').mockImplementation(() => {});
    return svc;
  }

  function trackerIssue(overrides: Record<string, unknown> = {}) {
    return {
      id: '2925',
      ref: '#2925',
      title: 'Red main: parseProcessTable missing',
      description: 'body',
      state: 'closed',
      labels: [],
      author: 'eltmon',
      url: 'https://github.com/eltmon/overdeck/issues/2925',
      tracker: 'github',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-19T15:27:13.000Z',
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    mockResolveMissingIssue.mockReset();
  });

  it('adds a resolved issue to getIssues() when absent from the windowed poll', async () => {
    const svc = makeService();
    mockResolveMissingIssue.mockResolvedValue(trackerIssue());

    await svc.backfillIssue('PAN-2925');

    const row = svc.getIssues().find((issue: any) => issue.identifier === 'PAN-2925');
    expect(row).toBeTruthy();
    expect(row.title).toBe('Red main: parseProcessTable missing');
    expect(row.status).toBe('Done');
    expect(row.canonicalStatus).toBe('done');
    expect(row.id).toBe('github-eltmon-overdeck-2925');
    expect(row.url).toBe('https://github.com/eltmon/overdeck/issues/2925');
    expect(row.project.name).toBe('eltmon/overdeck');
    expect(row.source).toBe('github');
    expect(row.sourceRepo).toBe('eltmon/overdeck');
    expect(row.completedAt).toBe('2026-07-19T15:27:13.000Z');
  });

  it('is a no-op when the issue is already in the fetched list', async () => {
    const svc = makeService();
    (svc as any).trackers.github.lastFetchedIssues = [{ identifier: 'PAN-2925', title: 'already here' }];

    await svc.backfillIssue('pan-2925');

    expect(mockResolveMissingIssue).not.toHaveBeenCalled();
    expect((svc as any).backfilledIssues.size).toBe(0);
  });

  it('prunes the backfilled row once the windowed poll covers the issue again', async () => {
    const svc = makeService();
    mockResolveMissingIssue.mockResolvedValue(trackerIssue());
    await svc.backfillIssue('PAN-2925');
    expect((svc as any).backfilledIssues.size).toBe(1);

    (svc as any).trackers.github.lastFetchedIssues = [
      { identifier: 'PAN-2925', title: 'fetched title', status: 'Done', updatedAt: '2026-08-01T00:00:00.000Z' },
    ];
    (svc as any).pushUpdated();

    expect((svc as any).backfilledIssues.size).toBe(0);
    const rows = svc.getIssues().filter((issue: any) => issue.identifier === 'PAN-2925');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('fetched title');
  });

  it('shares one in-flight resolution across concurrent calls', async () => {
    const svc = makeService();
    let resolveFn: (value: unknown) => void = () => {};
    mockResolveMissingIssue.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));

    const first = svc.backfillIssue('PAN-2925');
    const second = svc.backfillIssue('PAN-2925');
    expect(mockResolveMissingIssue).toHaveBeenCalledTimes(1);

    resolveFn(trackerIssue());
    await Promise.all([first, second]);
    expect((svc as any).backfilledIssues.size).toBe(1);
  });

  it('records nothing when the tracker cannot resolve the issue', async () => {
    const svc = makeService();
    mockResolveMissingIssue.mockResolvedValue(null);

    await svc.backfillIssue('PAN-2925');

    expect((svc as any).backfilledIssues.size).toBe(0);
    expect(svc.getIssues().find((issue: any) => issue.identifier === 'PAN-2925')).toBeUndefined();
  });

  it('formats a non-github issue with the canonical display status', async () => {
    const svc = makeService();
    mockResolveMissingIssue.mockResolvedValue(trackerIssue({
      state: 'in_progress',
      tracker: 'linear',
      url: 'https://linear.app/mind-your-now/issue/MIN-663/some-slug',
      priority: 2,
    }));

    await svc.backfillIssue('MIN-663');

    const row = svc.getIssues().find((issue: any) => issue.identifier === 'MIN-663');
    expect(row).toBeTruthy();
    expect(row.status).toBe('In Progress');
    expect(row.canonicalStatus).toBe('in_progress');
    expect(row.id).toBe('backfill-linear-min-663');
    expect(row.priority).toBe(2);
    expect(row.completedAt).toBeUndefined();
  });
});
