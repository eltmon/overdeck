import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeTaskCounts, IssueDataService, shouldRefreshPlanningStateForIssue } from '../issue-data-service.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';
import { mergeConfigs } from '../../../../lib/config-yaml.js';

describe('computeTaskCounts', () => {
  function makeDoc(items: Array<{ status: string }>): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
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
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: { id: 'plan-1', title: 'Test', status: 'active', items: [], edges: [] },
    } as VBriefDocument;
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
