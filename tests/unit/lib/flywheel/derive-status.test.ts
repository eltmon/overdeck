import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

import { deriveFlywheelStatus, freshnessFor, type DeriveFlywheelStatusDeps } from '../../../../src/lib/flywheel/derive-status.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';
import { loadIssueStatesForProject, readIssueFromTracker } from '../../../../src/lib/overdeck/derived-issue-state.js';

// The deriver's defaults import this module lazily; the two names below are
// everything it takes from it, so replacing the module wholesale is safe and
// keeps the default `loadStates` / `readTrackerIssues` paths offline.
vi.mock('../../../../src/lib/overdeck/derived-issue-state.js', () => ({
  loadIssueStatesForProject: vi.fn(async () => new Map()),
  readIssueFromTracker: vi.fn(async () => null),
}));

const NOW = Date.parse('2026-09-23T10:00:00.000Z');

function conversation(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    id: 42,
    name: 'conv-flywheel',
    tmuxSession: 'conv-flywheel',
    status: 'active',
    cwd: '/repos/overdeck',
    title: 'Flywheel',
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    forkStatus: null,
    ...overrides,
  } as LegacyConversation;
}

function marker(tick: number, at: string, extra = 'pick=PAN-1 phase=watch in-flight=PAN-1 needs-you=none') {
  return { role: 'assistant', text: `done.\nflywheel-tick: tick=${tick} ${extra}`, createdAt: at };
}

function baseDeps(overrides: DeriveFlywheelStatusDeps = {}): DeriveFlywheelStatusDeps {
  return {
    getConversation: () => conversation(),
    sessionAlive: async () => true,
    readTranscript: async () => [],
    resolveProjectPath: (dir) => dir,
    resolvePlanHome: (root) => root,
    listWorkspaces: () => [],
    readTrackerIssues: async () => ({}),
    loadStates: async () => new Map(),
    lastJournal: () => null,
    policies: () => ({ auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false }),
    runningBook: () => null,
    now: () => NOW,
    ...overrides,
  };
}

describe('deriveFlywheelStatus (PAN-3964 FR-1)', () => {
  it('is idle with no conversation row and reads nothing from a transcript', async () => {
    const readTranscript = vi.fn(async () => []);
    const status = await deriveFlywheelStatus({
      projectRoot: '/repos/overdeck',
      deps: baseDeps({ getConversation: () => null, readTranscript }),
    });
    expect(status.run).toBe('idle');
    expect(status.conversation).toBeNull();
    expect(status.lastTick).toBeNull();
    expect(status.freshness).toBeNull();
    expect(status.projectRoot).toBe('/repos/overdeck');
    expect(readTranscript).not.toHaveBeenCalled();
  });

  it('is idle when the only row is archived (a rolled-back start)', async () => {
    const status = await deriveFlywheelStatus({
      deps: baseDeps({ getConversation: () => conversation({ status: 'ended', archivedAt: '2026-09-23T09:00:00.000Z' }) }),
    });
    expect(status.run).toBe('idle');
    expect(status.conversation).toBeNull();
  });

  it('is paused when the row exists but the session is dead', async () => {
    const status = await deriveFlywheelStatus({ deps: baseDeps({ sessionAlive: async () => false }) });
    expect(status.run).toBe('paused');
    expect(status.conversation?.sessionAlive).toBe(false);
  });

  it('is paused when the row is ended even if a session answers', async () => {
    const sessionAlive = vi.fn(async () => true);
    const status = await deriveFlywheelStatus({
      deps: baseDeps({ getConversation: () => conversation({ status: 'ended' }), sessionAlive }),
    });
    expect(status.run).toBe('paused');
    expect(sessionAlive).not.toHaveBeenCalled();
  });

  it('is running with a live session and takes lastTick from the newest marker', async () => {
    const status = await deriveFlywheelStatus({
      deps: baseDeps({
        readTranscript: async () => [
          marker(1, '2026-09-23T09:00:00.000Z'),
          { role: 'user', text: 'Stop the loop: … flywheel-tick: tick=99 pick=none phase=stopping in-flight=none needs-you=none', createdAt: '2026-09-23T09:59:00.000Z' },
          marker(2, '2026-09-23T09:59:30.000Z', 'pick=PAN-2 phase=launch in-flight=PAN-1,PAN-2 needs-you=decide the scope'),
        ],
      }),
    });
    expect(status.run).toBe('running');
    expect(status.conversation).toMatchObject({ name: 'conv-flywheel', id: 42, model: 'claude-opus-5-5', sessionAlive: true });
    expect(status.lastTick).toEqual({
      tick: 2, pick: 'PAN-2', phase: 'launch', inFlight: ['PAN-1', 'PAN-2'], needsYou: 'decide the scope', at: '2026-09-23T09:59:30.000Z',
    });
    expect(status.freshness).toBe('live');
  });

  it('has lastTick null when the transcript has no marker', async () => {
    const status = await deriveFlywheelStatus({
      deps: baseDeps({ readTranscript: async () => [{ role: 'assistant', text: 'orienting', createdAt: '2026-09-23T09:59:00Z' }] }),
    });
    expect(status.lastTick).toBeNull();
    expect(status.freshness).toBeNull();
  });

  it.each([
    ['2026-09-23T09:59:30.000Z', 'live'],
    ['2026-09-23T09:45:00.000Z', 'breathing'],
    ['2026-09-23T09:30:00.000Z', 'stalled'],
  ] as const)('freshness at %s is %s', async (at, expected) => {
    expect(freshnessFor(at, NOW)).toBe(expected);
    const status = await deriveFlywheelStatus({ deps: baseDeps({ readTranscript: async () => [marker(1, at)] }) });
    expect(status.freshness).toBe(expected);
  });

  it('in-flight rows carry derived state, PR, attention, and the last journal entry', async () => {
    const derived: DerivedIssueState = {
      issueId: 'PAN-1',
      state: 'in-review',
      attention: 'needs-you',
      pr: { url: 'https://github.com/eltmon/overdeck/pull/7', number: 7, reviewState: 'review-requested', checks: 'pending', mergeable: null },
    };
    const loadStates = vi.fn(async () => new Map([['PAN-1', derived]]));
    const status = await deriveFlywheelStatus({
      deps: baseDeps({
        listWorkspaces: (projectPath) => (projectPath === '/repos/overdeck'
          ? [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }, { issueId: 'PAN-2', workspacePath: '/ws/feature-pan-2' }]
          : []),
        loadStates,
        lastJournal: (path) => (path === '/ws/feature-pan-1'
          ? { at: '2026-09-23T09:58:00.000Z', type: 'review.dispatched', issueId: 'PAN-1', source: 'pan-done' }
          : null),
      }),
    });
    expect(loadStates).toHaveBeenCalledWith('/repos/overdeck', ['PAN-1', 'PAN-2'], { issues: {} });
    expect(status.inFlight).toEqual([
      {
        issueId: 'PAN-1',
        title: null,
        state: 'in-review',
        attention: 'needs-you',
        pr: derived.pr,
        trackerUnknown: true,
        lastJournal: { at: '2026-09-23T09:58:00.000Z', type: 'review.dispatched', source: 'pan-done' },
      },
      { issueId: 'PAN-2', title: null, state: 'backlog', trackerUnknown: true, lastJournal: null },
    ]);
  });

  it('leaves merged and closed workspaces out of in-flight', async () => {
    const states = new Map<string, DerivedIssueState>([
      ['PAN-1', { issueId: 'PAN-1', state: 'working' }],
      ['PAN-2', { issueId: 'PAN-2', state: 'merged' }],
      ['PAN-3', { issueId: 'PAN-3', state: 'closed' }],
    ]);
    const status = await deriveFlywheelStatus({
      deps: baseDeps({
        listWorkspaces: () => ['PAN-1', 'PAN-2', 'PAN-3'].map((issueId) => ({
          issueId,
          workspacePath: `/ws/feature-${issueId.toLowerCase()}`,
        })),
        loadStates: async () => states,
        lastJournal: () => null,
      }),
    });
    expect(status.inFlight.map((row) => row.issueId)).toEqual(['PAN-1']);
  });

  it('scopes to the conversation cwd project and surfaces the running order book', async () => {
    const runningBook = vi.fn(() => ({ id: 'book-1', name: 'Sept', status: 'running', landed: 1, total: 4 }));
    const status = await deriveFlywheelStatus({
      projectRoot: '/elsewhere',
      deps: baseDeps({
        getConversation: () => conversation({ cwd: '/repos/overdeck/sub' }),
        resolveProjectPath: () => '/repos/overdeck',
        resolvePlanHome: () => '/repos/plan-home',
        runningBook,
      }),
    });
    expect(status.projectRoot).toBe('/repos/overdeck');
    expect(runningBook).toHaveBeenCalledWith('/repos/plan-home/.pan');
    expect(status.orderBook).toEqual({ id: 'book-1', name: 'Sept', status: 'running', landed: 1, total: 4 });
    expect(status.policies).toEqual({ auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false });
    expect(status.generatedAt).toBe('2026-09-23T10:00:00.000Z');
  });

  describe('tracker facts (PAN-4199 FR-2, FR-3)', () => {
    const loadStatesMock = vi.mocked(loadIssueStatesForProject);
    const readIssueMock = vi.mocked(readIssueFromTracker);

    function workspaces(...ids: readonly string[]) {
      return ids.map((issueId) => ({ issueId, workspacePath: `/ws/feature-${issueId.toLowerCase()}` }));
    }

    beforeEach(() => {
      loadStatesMock.mockReset();
      loadStatesMock.mockResolvedValue(new Map());
      readIssueMock.mockReset();
      readIssueMock.mockResolvedValue(null);
    });

    it('passes the tracker rows to the lib loader so a closed issue drops out (ac1)', async () => {
      loadStatesMock.mockResolvedValue(new Map<string, DerivedIssueState>([
        ['PAN-1', { issueId: 'PAN-1', state: 'closed' }],
      ]));
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => workspaces('PAN-1'),
          readTrackerIssues: async () => ({ 'PAN-1': { open: false, labels: [] } }),
          // Left at the default so the real lazy `loadIssueStatesForProject` runs.
          loadStates: undefined,
        }),
      });
      expect(loadStatesMock).toHaveBeenCalledWith('/repos/overdeck', ['PAN-1'], {
        issues: { 'PAN-1': { open: false, labels: [] } },
      });
      expect(status.inFlight).toEqual([]);
    });

    it('marks a row whose tracker did not answer as unknown with a null title (ac2)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => workspaces('PAN-2'),
          readTrackerIssues: async () => ({ 'PAN-2': null }),
        }),
      });
      expect(status.inFlight).toEqual([
        { issueId: 'PAN-2', title: null, state: 'backlog', trackerUnknown: true, lastJournal: null },
      ]);
    });

    it('copies the tracker title onto the row (ac3)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => workspaces('PAN-3'),
          readTrackerIssues: async () => ({ 'PAN-3': { open: true, labels: [], title: 'Fix the thing' } }),
        }),
      });
      expect(status.inFlight[0]).toMatchObject({ issueId: 'PAN-3', title: 'Fix the thing' });
      expect(status.inFlight[0]).not.toHaveProperty('trackerUnknown');
    });

    it('reads every id once through the tracker, at most four at a time (ac4)', async () => {
      const ids = Array.from({ length: 10 }, (_, i) => `PAN-${i + 1}`);
      let inFlightReads = 0;
      let peak = 0;
      readIssueMock.mockImplementation(async (id: string) => {
        inFlightReads++;
        peak = Math.max(peak, inFlightReads);
        // Two microtask turns, so the limiter has to refill the window.
        await Promise.resolve();
        await Promise.resolve();
        inFlightReads--;
        return { open: true, labels: [], title: `title ${id}` };
      });
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => workspaces(...ids),
          // Left at the default so the real lazy `readIssueFromTracker` fan-out runs.
          readTrackerIssues: undefined,
        }),
      });
      expect(readIssueMock).toHaveBeenCalledTimes(10);
      expect(new Set(readIssueMock.mock.calls.map(([id]) => id))).toEqual(new Set(ids));
      expect(peak).toBeLessThanOrEqual(4);
      expect(status.inFlight.map((row) => row.title)).toEqual(ids.map((id) => `title ${id}`));
    });

    it('upper-cases the ids it hands the tracker', async () => {
      await deriveFlywheelStatus({
        deps: baseDeps({ listWorkspaces: () => workspaces('pan-9'), readTrackerIssues: undefined }),
      });
      expect(readIssueMock).toHaveBeenCalledWith('PAN-9');
    });
  });

  it('never writes: every dependency it calls is a read', async () => {
    const deps = baseDeps();
    const spies = Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, vi.fn(v as (...a: unknown[]) => unknown)]));
    await deriveFlywheelStatus({ deps: spies as DeriveFlywheelStatusDeps });
    expect(Object.keys(spies).every((key) => !/^(set|write|create|mark|append|delete)/.test(key))).toBe(true);
  });
});
