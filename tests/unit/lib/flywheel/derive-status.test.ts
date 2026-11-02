import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendPane, DerivedIssueState } from '@overdeck/contracts';

import { deriveFlywheelStatus, freshnessFor, selectOpenStrikePr, type DeriveFlywheelStatusDeps } from '../../../../src/lib/flywheel/derive-status.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';
import { listPanesWithBackend, loadIssueStatesForProject, readIssueFromTracker } from '../../../../src/lib/overdeck/derived-issue-state.js';

// The deriver's defaults import this module lazily; the names below are
// everything it takes from it, so replacing the module wholesale is safe and
// keeps the default `loadStates` / `readTrackerIssues` / `readStrikePr`
// paths offline (PAN-4752: the strike PR overlay's default reaches
// `forgeForProject`/`listRepoPullRequests`/`listRepoMergeRequests`/
// `prFromGhRow`/`mrFromGlabRow`, so any test that falls through to it needs
// these mocked too).
vi.mock('../../../../src/lib/overdeck/derived-issue-state.js', () => ({
  listPanesWithBackend: vi.fn(async () => []),
  loadIssueStatesForProject: vi.fn(async () => new Map()),
  readIssueFromTracker: vi.fn(async () => null),
  forgeForProject: vi.fn(() => 'github'),
  listRepoPullRequests: vi.fn(async () => []),
  listRepoMergeRequests: vi.fn(async () => []),
  prFromGhRow: vi.fn(() => null),
  mrFromGlabRow: vi.fn(() => null),
}));

const NOW = Date.parse('2026-09-23T10:00:00.000Z');

function conversation(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    id: 42,
    name: 'conv-flywheel',
    tmuxSession: 'conv-flywheel',
    status: 'active',
    cwd: '/repos/overdeck',
    createdAt: '2026-09-23T08:00:00.000Z',
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
    listPanes: () => [],
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
    expect(loadStates).toHaveBeenCalledWith('/repos/overdeck', ['PAN-1', 'PAN-2'], { issues: {}, panes: [] });
    expect(status.inFlight).toEqual([
      {
        issueId: 'PAN-1',
        title: null,
        state: 'in-review',
        attention: 'needs-you',
        pr: derived.pr,
        trackerUnknown: true,
        liveAgents: 0,
        inTick: false,
        lastJournal: { at: '2026-09-23T09:58:00.000Z', type: 'review.dispatched', source: 'pan-done' },
      },
      { issueId: 'PAN-2', title: null, state: 'backlog', trackerUnknown: true, liveAgents: 0, inTick: false, lastJournal: null },
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
        panes: [],
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
        { issueId: 'PAN-2', title: null, state: 'backlog', trackerUnknown: true, liveAgents: 0, inTick: false, lastJournal: null },
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

  describe('live agents (PAN-4199 FR-5)', () => {
    const listPanesMock = vi.mocked(listPanesWithBackend);

    function pane(issue: string, state: BackendPane['state'], role: BackendPane['role'] = 'work'): BackendPane {
      return { id: `${issue}-${role}`, issue, role, harness: 'claude-code', model: 'claude-opus-5-5', state };
    }

    beforeEach(() => {
      listPanesMock.mockReset();
      listPanesMock.mockResolvedValue([]);
      vi.mocked(loadIssueStatesForProject).mockReset();
      vi.mocked(loadIssueStatesForProject).mockResolvedValue(new Map());
    });

    it('reports liveAgents 0 when no pane belongs to the issue (ac1)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }],
          loadStates: async () => new Map<string, DerivedIssueState>([['PAN-1', { issueId: 'PAN-1', state: 'working' }]]),
          listPanes: () => [],
        }),
      });
      expect(status.inFlight[0]?.liveAgents).toBe(0);
      expect(status.agents).toEqual([]);
    });

    it('counts only live panes of in-flight issues (ac2)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }],
          loadStates: async () => new Map<string, DerivedIssueState>([['PAN-1', { issueId: 'PAN-1', state: 'working' }]]),
          listPanes: () => [pane('PAN-1', 'working'), pane('PAN-1', 'exited', 'review'), pane('PAN-9', 'working')],
        }),
      });
      expect(status.inFlight[0]?.liveAgents).toBe(1);
      expect(status.agents).toEqual([
        { issueId: 'PAN-1', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'working' },
      ]);
    });

    it('reads the inventory once and hands the same panes to loadStates (ac3)', async () => {
      const panes = [pane('PAN-1', 'working')];
      listPanesMock.mockResolvedValue(panes);
      const loadStates = vi.fn(async () => new Map<string, DerivedIssueState>([['PAN-1', { issueId: 'PAN-1', state: 'working' }]]));
      await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }],
          loadStates,
          // Left at the default so the real lazy `listPanesWithBackend` runs.
          listPanes: undefined,
        }),
      });
      expect(listPanesMock).toHaveBeenCalledTimes(1);
      expect(loadStates).toHaveBeenCalledWith('/repos/overdeck', ['PAN-1'], { issues: {}, panes });
    });

    it('sorts agents by issue then role and drops a merged issue entirely', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [
            { issueId: 'PAN-2', workspacePath: '/ws/feature-pan-2' },
            { issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' },
            { issueId: 'PAN-3', workspacePath: '/ws/feature-pan-3' },
          ],
          loadStates: async () => new Map<string, DerivedIssueState>([
            ['PAN-1', { issueId: 'PAN-1', state: 'working' }],
            ['PAN-2', { issueId: 'PAN-2', state: 'working' }],
            ['PAN-3', { issueId: 'PAN-3', state: 'merged' }],
          ]),
          listPanes: () => [
            pane('PAN-2', 'working', 'review'),
            pane('PAN-1', 'working', 'work'),
            pane('PAN-2', 'working', 'work'),
            pane('PAN-3', 'working', 'work'),
          ],
        }),
      });
      expect(status.agents.map((agent) => `${agent.issueId}/${agent.role}`))
        .toEqual(['PAN-1/work', 'PAN-2/review', 'PAN-2/work']);
    });
  });

  describe('the tick in-flight list (PAN-4199 FR-6)', () => {
    /** A transcript whose newest marker names `ids` as in flight. */
    function tickOver(...ids: readonly string[]) {
      const list = ids.length ? ids.join(',') : 'none';
      return async () => [marker(4, '2026-09-23T09:59:30.000Z', `pick=${ids[0] ?? 'none'} phase=watch in-flight=${list} needs-you=none`)];
    }

    it('adds a tick id that has no workspace of its own (ac1)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          readTranscript: tickOver('PAN-5'),
          listWorkspaces: () => [],
          loadStates: async () => new Map<string, DerivedIssueState>([['PAN-5', { issueId: 'PAN-5', state: 'working' }]]),
        }),
      });
      expect(status.inFlight).toEqual([
        expect.objectContaining({ issueId: 'PAN-5', inTick: true, lastJournal: null }),
      ]);
    });

    it('marks a census workspace the tick did not name as inTick false (ac2)', async () => {
      const lastJournal = vi.fn(() => null);
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          readTranscript: tickOver('PAN-5'),
          listWorkspaces: () => [{ issueId: 'PAN-6', workspacePath: '/ws/feature-pan-6' }],
          loadStates: async () => new Map<string, DerivedIssueState>([
            ['PAN-5', { issueId: 'PAN-5', state: 'working' }],
            ['PAN-6', { issueId: 'PAN-6', state: 'working' }],
          ]),
          lastJournal,
        }),
      });
      expect(status.inFlight.map((row) => [row.issueId, row.inTick])).toEqual([['PAN-6', false], ['PAN-5', true]]);
      // The tick-only id has no workspace, so no journal is read for it.
      expect(lastJournal).toHaveBeenCalledExactlyOnceWith('/ws/feature-pan-6');
    });

    it('reports inFlightSource census without a tick and tick with one (ac3)', async () => {
      const census = await deriveFlywheelStatus({ deps: baseDeps({ getConversation: () => null }) });
      expect(census.inFlightSource).toBe('census');

      const noTick = await deriveFlywheelStatus({ deps: baseDeps() });
      expect(noTick.inFlightSource).toBe('census');

      const ticked = await deriveFlywheelStatus({ deps: baseDeps({ readTranscript: tickOver('PAN-5') }) });
      expect(ticked.inFlightSource).toBe('tick');
    });

    it('drops a tick id whose derived state is closed (ac4)', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          readTranscript: tickOver('PAN-5'),
          listWorkspaces: () => [],
          loadStates: async () => new Map<string, DerivedIssueState>([['PAN-5', { issueId: 'PAN-5', state: 'closed' }]]),
        }),
      });
      expect(status.inFlight).toEqual([]);
    });

    it('does not duplicate an id that is both a workspace and a tick entry', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          readTranscript: tickOver('PAN-6'),
          listWorkspaces: () => [{ issueId: 'PAN-6', workspacePath: '/ws/feature-pan-6' }],
          loadStates: async () => new Map<string, DerivedIssueState>([['PAN-6', { issueId: 'PAN-6', state: 'working' }]]),
        }),
      });
      expect(status.inFlight.map((row) => row.issueId)).toEqual(['PAN-6']);
      expect(status.inFlight[0]?.inTick).toBe(true);
    });
  });

  it('carries the conversation creation time so the page can show elapsed run time (ac1)', async () => {
    const status = await deriveFlywheelStatus({
      deps: baseDeps({ getConversation: () => conversation({ createdAt: '2026-09-23T08:00:00.000Z' }) }),
    });
    expect(status.conversation?.createdAt).toBe('2026-09-23T08:00:00.000Z');
  });

  describe('strike workspaces (PAN-4752)', () => {
    it('folds a strike-only workspace onto its base id', async () => {
      const readTrackerIssues = vi.fn(async () => ({}));
      const loadStates = vi.fn(async () => new Map());
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
          readTrackerIssues,
          loadStates,
        }),
      });
      expect(status.inFlight.map((row) => row.issueId)).toEqual(['PAN-4669']);
      expect(status.inFlight[0]?.strike).toBe(true);
      expect(status.inFlight.some((row) => /-STRIKE$/i.test(row.issueId))).toBe(false);
      expect(readTrackerIssues).toHaveBeenCalledWith(['PAN-4669']);
      expect(loadStates).toHaveBeenCalledWith('/repos/overdeck', ['PAN-4669'], { issues: {}, panes: [] });
    });

    it('folds a strike workspace listed before its base workspace into one row, journal from the base', async () => {
      const lastJournal = vi.fn(() => null);
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [
            { issueId: 'PAN-7-STRIKE', workspacePath: '/ws/feature-pan-7-strike' },
            { issueId: 'PAN-7', workspacePath: '/ws/feature-pan-7' },
          ],
          lastJournal,
        }),
      });
      expect(status.inFlight.map((row) => row.issueId)).toEqual(['PAN-7']);
      expect(status.inFlight[0]?.strike).toBe(true);
      expect(lastJournal).toHaveBeenCalledWith('/ws/feature-pan-7');
      expect(lastJournal).not.toHaveBeenCalledWith('/ws/feature-pan-7-strike');
    });

    it('folds a tick-only strike id onto its base, with inTick true', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          readTranscript: async () => [marker(4, '2026-09-23T09:59:30.000Z', 'pick=PAN-8-STRIKE phase=watch in-flight=PAN-8-STRIKE needs-you=none')],
          listWorkspaces: () => [],
        }),
      });
      expect(status.inFlight).toEqual([
        expect.objectContaining({ issueId: 'PAN-8', strike: true, inTick: true, lastJournal: null }),
      ]);
    });

    it('counts a live strike pane toward the folded row', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({
          listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
          listPanes: () => [
            { id: 'PAN-4669-work', issue: 'PAN-4669', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'working' },
          ],
        }),
      });
      expect(status.inFlight[0]?.liveAgents).toBe(1);
      expect(status.agents[0]?.issueId).toBe('PAN-4669');
    });

    it('does not set strike on a plain workspace row', async () => {
      const status = await deriveFlywheelStatus({
        deps: baseDeps({ listWorkspaces: () => [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }] }),
      });
      expect('strike' in status.inFlight[0]!).toBe(false);
    });

    describe('strike PR overlay (PAN-4752 W3)', () => {
      function strikePr(number: number, reviewState: 'review-requested' | 'changes-requested' = 'review-requested') {
        return { url: `https://github.com/eltmon/overdeck/pull/${number}`, number, reviewState, checks: 'pending' as const, mergeable: null };
      }

      it('carries the open strike PR and derives in-review, dropping work-not-started attention (test 6)', async () => {
        const readStrikePr = vi.fn(async () => strikePr(4698));
        const status = await deriveFlywheelStatus({
          deps: baseDeps({
            listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
            loadStates: async () => new Map([['PAN-4669', { issueId: 'PAN-4669', state: 'backlog', attention: 'work-not-started' } as DerivedIssueState]]),
            readStrikePr,
          }),
        });
        expect(status.inFlight[0]?.pr?.number).toBe(4698);
        expect(status.inFlight[0]?.state).toBe('in-review');
        expect(status.inFlight[0]).not.toHaveProperty('attention');
        expect(readStrikePr).toHaveBeenCalledWith('/repos/overdeck', 'PAN-4669');
      });

      it('derives changes-requested from a strike PR in that review state (test 7)', async () => {
        const status = await deriveFlywheelStatus({
          deps: baseDeps({
            listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
            readStrikePr: async () => strikePr(4698, 'changes-requested'),
          }),
        });
        expect(status.inFlight[0]?.state).toBe('changes-requested');
      });

      it('keeps the tracker-derived state and drops no PR when no strike PR is open (test 8)', async () => {
        const status = await deriveFlywheelStatus({
          deps: baseDeps({
            listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
            loadStates: async () => new Map([['PAN-4669', { issueId: 'PAN-4669', state: 'working' } as DerivedIssueState]]),
            readStrikePr: async () => null,
          }),
        });
        expect(status.inFlight.map((row) => row.issueId)).toEqual(['PAN-4669']);
        expect(status.inFlight[0]?.state).toBe('working');
        expect(status.inFlight[0]).not.toHaveProperty('pr');
      });

      it('drops a closed strike row from in-flight even with an open strike PR (test 9)', async () => {
        const status = await deriveFlywheelStatus({
          deps: baseDeps({
            listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
            loadStates: async () => new Map([['PAN-4669', { issueId: 'PAN-4669', state: 'closed' } as DerivedIssueState]]),
            readStrikePr: async () => strikePr(4698),
          }),
        });
        expect(status.inFlight).toEqual([]);
      });

      it('prefers a feature-branch PR and never reads the strike PR for it (test 10)', async () => {
        const readStrikePr = vi.fn(async () => strikePr(4698));
        const featurePr = { url: 'https://github.com/eltmon/overdeck/pull/7', number: 7, reviewState: 'review-requested' as const, checks: 'pending' as const, mergeable: null };
        const status = await deriveFlywheelStatus({
          deps: baseDeps({
            listWorkspaces: () => [{ issueId: 'PAN-4669-STRIKE', workspacePath: '/ws/feature-pan-4669-strike' }],
            loadStates: async () => new Map([['PAN-4669', { issueId: 'PAN-4669', state: 'in-review', pr: featurePr } as DerivedIssueState]]),
            readStrikePr,
          }),
        });
        expect(status.inFlight[0]?.pr?.number).toBe(7);
        expect(readStrikePr).not.toHaveBeenCalled();
      });

      it('never calls readStrikePr for a non-strike row', async () => {
        const readStrikePr = vi.fn(async () => strikePr(4698));
        await deriveFlywheelStatus({
          deps: baseDeps({ listWorkspaces: () => [{ issueId: 'PAN-1', workspacePath: '/ws/feature-pan-1' }], readStrikePr }),
        });
        expect(readStrikePr).not.toHaveBeenCalled();
      });

      it('selectOpenStrikePr drops merged PRs and keeps the highest open number (test 11)', () => {
        const merged10 = { url: '', number: 10, reviewState: 'none' as const, checks: 'pending' as const, mergeable: null, merged: true };
        const open11 = { url: '', number: 11, reviewState: 'none' as const, checks: 'pending' as const, mergeable: null, merged: false };
        const open12 = { url: '', number: 12, reviewState: 'none' as const, checks: 'pending' as const, mergeable: null, merged: false };
        expect(selectOpenStrikePr([merged10])).toBeNull();
        expect(selectOpenStrikePr([merged10, open12])?.number).toBe(12);
        expect(selectOpenStrikePr([null, open12])?.number).toBe(12);
        expect(selectOpenStrikePr([open11, open12])?.number).toBe(12);
        expect(selectOpenStrikePr([open12])).not.toHaveProperty('merged');
      });
    });
  });

  it('never writes: every dependency it calls is a read', async () => {
    const deps = baseDeps();
    const spies = Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, vi.fn(v as (...a: unknown[]) => unknown)]));
    await deriveFlywheelStatus({ deps: spies as DeriveFlywheelStatusDeps });
    expect(Object.keys(spies).every((key) => !/^(set|write|create|mark|append|delete)/.test(key))).toBe(true);
  });
});
