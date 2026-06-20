import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventStore } from '../../event-store.js';
import type { FlywheelSubstrateBug, FlywheelSubstrateBugFiledBy } from '../../../../lib/overdeck/flywheel-substrate-bugs.js';
import {
  createSubstrateBugPoller,
  extractClosingIssueNumbers,
  parseSubstrateBugTrailer,
  severityFromLabels,
  type GitHubSearchIssue,
} from '../substrate-bug-poller.js';

type UpsertInput = {
  issueId: string;
  filedAt: string;
  runId?: string | null;
  filedBy: FlywheelSubstrateBugFiledBy;
  discoveredInIssueId?: string | null;
  severity: string;
  updatedAt: string;
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function makeBug(input: UpsertInput, existing?: FlywheelSubstrateBug): FlywheelSubstrateBug {
  return {
    issueId: input.issueId,
    filedAt: input.filedAt,
    runId: input.runId ?? null,
    filedBy: input.filedBy,
    discoveredInIssueId: input.discoveredInIssueId ?? null,
    severity: input.severity,
    status: existing?.status ?? 'open',
    fixMergedAt: existing?.fixMergedAt ?? null,
    fixCommitSha: existing?.fixCommitSha ?? null,
    updatedAt: input.updatedAt,
  };
}

function makeRepository(seed: FlywheelSubstrateBug[] = []) {
  const bugs = new Map(seed.map((bug) => [bug.issueId, bug]));
  return {
    bugs,
    getByIssueId: vi.fn((issueId: string) => bugs.get(issueId) ?? null),
    upsert: vi.fn((input: UpsertInput) => {
      const bug = makeBug(input, bugs.get(input.issueId));
      bugs.set(input.issueId, bug);
      return bug;
    }),
    markFixed: vi.fn((issueId: string, commitSha: string, mergedAt: string) => {
      const existing = bugs.get(issueId);
      if (!existing) return null;
      const bug = {
        ...existing,
        status: 'fixed' as const,
        fixCommitSha: commitSha,
        fixMergedAt: mergedAt,
        updatedAt: mergedAt,
      };
      bugs.set(issueId, bug);
      return bug;
    }),
  };
}

function makeEventStore() {
  return {
    appendAsync: vi.fn(async () => 1),
  } as unknown as EventStore;
}

function makeFetch(handler: (url: URL) => Response | Promise<Response>) {
  return vi.fn((input: string | URL | Request) => {
    const raw = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(new URL(raw)));
  }) as unknown as typeof fetch;
}

function makeSearchFetch(issueItems: GitHubSearchIssue[]) {
  return makeFetch((url) => {
    const query = url.searchParams.get('q') ?? '';
    if (url.pathname === '/search/issues' && query.includes('is:issue')) {
      return response({ items: query.includes('author:panopticon-agent[bot]') ? issueItems : [] });
    }
    if (url.pathname === '/search/issues' && query.includes('is:pr')) {
      return response({ items: [] });
    }
    return response({ items: [] });
  });
}

const config = {
  token: 'ghp_test',
  repos: [{ owner: 'acme', repo: 'overdeck', prefix: 'PAN' }],
};

describe('substrate bug poller helpers', () => {
  it('extracts the canonical trailer fields', () => {
    expect(parseSubstrateBugTrailer(`details

Flywheel-Run-Id: run-123
Flywheel-Filed-By: agent
Flywheel-Discovered-In: PAN-1486
`)).toEqual({
      runId: 'run-123',
      filedBy: 'agent',
      discoveredIn: 'PAN-1486',
    });
  });

  it('handles missing trailer lines gracefully', () => {
    expect(parseSubstrateBugTrailer('ordinary issue body')).toEqual({});
    expect(parseSubstrateBugTrailer(null)).toEqual({});
  });

  it.each([
    [[{ name: 'P0' }], 'P0'],
    [[{ name: 'P1' }], 'P1'],
    [[{ name: 'P2' }], 'P2'],
    [[{ name: 'bug' }], 'P2'],
  ] as const)('reads severity from labels %#', (labels, severity) => {
    expect(severityFromLabels(labels)).toBe(severity);
  });

  it('extracts closing issue references without duplicates', () => {
    expect(extractClosingIssueNumbers('Fixes #1, resolves #2, closed #1, unrelated #3')).toEqual([1, 2]);
  });
});

describe('createSubstrateBugPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a substrate bug event only on first insert', async () => {
    const repository = makeRepository();
    const eventStore = makeEventStore();
    const fetchImpl = makeSearchFetch([
      {
        number: 1487,
        body: 'Flywheel-Run-Id: run-123\nFlywheel-Filed-By: agent\nFlywheel-Discovered-In: PAN-1486',
        created_at: '2026-05-25T12:00:00.000Z',
        updated_at: '2026-05-25T12:01:00.000Z',
        labels: [{ name: 'P1' }],
        user: { login: 'panopticon-agent[bot]' },
      },
    ]);
    const poller = createSubstrateBugPoller({
      fetchImpl,
      repository,
      eventStore,
      getConfig: () => config,
      now: () => new Date('2026-05-25T12:05:00.000Z'),
    });

    await poller.pollOnce();
    await poller.pollOnce();

    expect(eventStore.appendAsync).toHaveBeenCalledTimes(1);
    expect(eventStore.appendAsync).toHaveBeenCalledWith({
      type: 'substrate.bug_filed',
      timestamp: '2026-05-25T12:00:00.000Z',
      payload: {
        issueId: 'PAN-1487',
        runId: 'run-123',
        filedBy: 'agent',
        discoveredIn: 'PAN-1486',
        severity: 'P1',
      },
    });
  });

  it('marks only known substrate bugs fixed from merged PR closing references', async () => {
    const repository = makeRepository([
      {
        issueId: 'PAN-101',
        filedAt: '2026-05-25T12:00:00.000Z',
        runId: null,
        filedBy: 'operator',
        discoveredInIssueId: null,
        severity: 'P2',
        status: 'open',
        fixMergedAt: null,
        fixCommitSha: null,
        updatedAt: '2026-05-25T12:00:00.000Z',
      },
    ]);
    const eventStore = makeEventStore();
    const fetchImpl = makeFetch((url) => {
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/search/issues' && query.includes('is:issue')) return response({ items: [] });
      if (url.pathname === '/search/issues' && query.includes('is:pr')) return response({ items: [{ number: 9 }] });
      if (url.pathname === '/repos/acme/overdeck/pulls/9/commits') {
        return response([{ sha: 'commit-sha', commit: { message: 'resolves #202' } }]);
      }
      if (url.pathname === '/repos/acme/overdeck/pulls/9') {
        return response({
          number: 9,
          title: 'Fix substrate regression',
          body: 'Fixes #101 and closes #202',
          merged_at: '2026-05-25T12:10:00.000Z',
          merge_commit_sha: 'merge-sha',
        });
      }
      return response({ items: [] });
    });
    const poller = createSubstrateBugPoller({
      fetchImpl,
      repository,
      eventStore,
      getConfig: () => config,
      now: () => new Date('2026-05-25T12:15:00.000Z'),
    });

    await poller.pollOnce();

    expect(repository.markFixed).toHaveBeenCalledTimes(1);
    expect(repository.markFixed).toHaveBeenCalledWith('PAN-101', 'merge-sha', '2026-05-25T12:10:00.000Z');
    expect(repository.bugs.get('PAN-101')?.status).toBe('fixed');
  });

  it('keeps fixed lifecycle metadata after the fixed issue is seen again', async () => {
    const repository = makeRepository();
    const eventStore = makeEventStore();
    const fetchImpl = makeFetch((url) => {
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/search/issues' && query.includes('is:issue')) {
        return response({
          items: [{
            number: 101,
            body: 'Flywheel-Run-Id: RUN-1\nFlywheel-Filed-By: agent',
            created_at: '2026-05-25T12:00:00.000Z',
            updated_at: '2026-05-25T12:01:00.000Z',
            labels: [{ name: 'P1' }],
            user: { login: 'panopticon-agent[bot]' },
          }],
        });
      }
      if (url.pathname === '/search/issues' && query.includes('is:pr')) return response({ items: [{ number: 9 }] });
      if (url.pathname === '/repos/acme/overdeck/pulls/9/commits') {
        return response([{ sha: 'commit-sha', commit: { message: 'refactor unrelated code' } }]);
      }
      if (url.pathname === '/repos/acme/overdeck/pulls/9') {
        return response({
          number: 9,
          title: 'Fix substrate regression',
          body: 'Fixes #101',
          merged_at: '2026-05-25T12:10:00.000Z',
          merge_commit_sha: 'merge-sha',
        });
      }
      return response({ items: [] });
    });
    const poller = createSubstrateBugPoller({
      fetchImpl,
      repository,
      eventStore,
      getConfig: () => config,
      now: () => new Date('2026-05-25T12:15:00.000Z'),
    });

    await poller.pollOnce();
    await poller.pollOnce();

    expect(repository.bugs.get('PAN-101')).toMatchObject({
      status: 'fixed',
      fixCommitSha: 'merge-sha',
      fixMergedAt: '2026-05-25T12:10:00.000Z',
    });
    expect(eventStore.appendAsync).toHaveBeenCalledTimes(1);
  });

  it('backs off when GitHub reports primary rate-limit exhaustion', async () => {
    let backedOff = false;
    const rateLimitStore = {
      shouldBackoff: vi.fn(() => backedOff),
      updateFromHeaders: vi.fn((headers: Headers) => {
        backedOff = headers.get('x-ratelimit-remaining') === '0';
      }),
    };
    const repository = makeRepository();
    const eventStore = makeEventStore();
    const fetchImpl = makeFetch(() => response({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0' }));
    const poller = createSubstrateBugPoller({
      fetchImpl,
      repository,
      eventStore,
      rateLimitStore,
      getConfig: () => config,
      now: () => new Date('2026-05-25T12:15:00.000Z'),
    });

    await poller.pollOnce();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rateLimitStore.shouldBackoff).toHaveBeenCalledTimes(2);
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(eventStore.appendAsync).not.toHaveBeenCalled();
  });

  it('polls immediately and then every configured interval', async () => {
    const repository = makeRepository();
    const eventStore = makeEventStore();
    const fetchImpl = makeSearchFetch([]);
    const poller = createSubstrateBugPoller({
      intervalMs: 60_000,
      fetchImpl,
      repository,
      eventStore,
      getConfig: () => config,
      now: () => new Date('2026-05-25T12:15:00.000Z'),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    poller.stop();
  });
});
