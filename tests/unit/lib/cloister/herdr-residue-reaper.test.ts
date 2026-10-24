import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/persistent-logger.js', () => ({ logDeaconEvent: vi.fn() }));

import {
  _resetHerdrResidueSightingsForTests,
  reapHerdrResiduePanes,
  selectHerdrResiduePanes,
  type ResiduePaneView,
} from '../../../../src/lib/cloister/herdr-residue-reaper.js';
import { emitActivityEntry } from '../../../../src/lib/activity-logger.js';
import { logDeaconEvent } from '../../../../src/lib/persistent-logger.js';
import type { HerdrApiClient } from '../../../../src/lib/terminal-backends/herdr-api.js';

/**
 * PAN-4582 W6. A residue pane (no `agentId` token, never detected, process
 * exited) is closed only on its SECOND sighting across sweeps, and the last
 * pane of a workspace whose every pane is residue is never closed (it is the
 * workspace's root shell).
 */

interface Call { method: string; params: Record<string, unknown> }

function fakeApi(handler: (call: Call) => unknown, log: Call[] = []) {
  return {
    log,
    api: {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        const result = handler({ method, params });
        if (result instanceof Error) throw result;
        return result ?? {};
      },
    } as unknown as HerdrApiClient,
  };
}

function view(partial: Partial<ResiduePaneView> & Pick<ResiduePaneView, 'paneId' | 'workspaceId'>): ResiduePaneView {
  return {
    terminalId: `${partial.paneId}-term`,
    hasAgentId: false,
    detected: false,
    process: 'exited',
    ...partial,
  };
}

describe('selectHerdrResiduePanes', () => {
  it('ignores panes outside an owned workspace', () => {
    const result = selectHerdrResiduePanes({
      ownedWorkspaceIds: new Set(['w1']),
      panes: [view({ paneId: 'p1', workspaceId: 'w2' })],
      previous: new Set(),
    });
    expect(result.close).toEqual([]);
    expect(result.sighted.size).toBe(0);
  });

  it('sights a candidate on the first sweep and closes it on the second', () => {
    const panes = [
      view({ paneId: 'agent', workspaceId: 'w1', hasAgentId: true, process: 'running' }),
      view({ paneId: 'shell', workspaceId: 'w1' }),
    ];
    const first = selectHerdrResiduePanes({ ownedWorkspaceIds: new Set(['w1']), panes, previous: new Set() });
    expect(first.close).toEqual([]);
    expect([...first.sighted]).toEqual(['shell|shell-term']);

    const second = selectHerdrResiduePanes({ ownedWorkspaceIds: new Set(['w1']), panes, previous: first.sighted });
    expect(second.close.map((p) => p.paneId)).toEqual(['shell']);
  });

  it('never selects a pane with an agentId token, a detected agent, or non-exited liveness', () => {
    const panes = [
      view({ paneId: 'p1', workspaceId: 'w1', hasAgentId: true }),
      view({ paneId: 'p2', workspaceId: 'w1', detected: true }),
      view({ paneId: 'p3', workspaceId: 'w1', process: 'running' }),
      view({ paneId: 'p4', workspaceId: 'w1', process: 'indeterminate' }),
    ];
    const previous = new Set(panes.map((p) => `${p.paneId}|${p.terminalId}`));
    const result = selectHerdrResiduePanes({ ownedWorkspaceIds: new Set(['w1']), panes, previous });
    expect(result.close).toEqual([]);
  });

  it('keeps exactly one pane when every pane in the workspace is residue', () => {
    const panes = [
      view({ paneId: 'first', workspaceId: 'w1' }),
      view({ paneId: 'second', workspaceId: 'w1' }),
    ];
    const first = selectHerdrResiduePanes({ ownedWorkspaceIds: new Set(['w1']), panes, previous: new Set() });
    expect([...first.sighted]).toEqual(['second|second-term']);

    const second = selectHerdrResiduePanes({ ownedWorkspaceIds: new Set(['w1']), panes, previous: first.sighted });
    expect(second.close.map((p) => p.paneId)).toEqual(['second']);
  });

  it('treats a pane_id reused with a different terminal_id as a first sighting', () => {
    const previous = new Set(['p1|term-old']);
    const result = selectHerdrResiduePanes({
      ownedWorkspaceIds: new Set(['w1']),
      panes: [
        view({ paneId: 'other', workspaceId: 'w1', hasAgentId: true, process: 'running' }),
        view({ paneId: 'p1', workspaceId: 'w1', terminalId: 'term-new' }),
      ],
      previous,
    });
    expect(result.close).toEqual([]);
    expect([...result.sighted]).toEqual(['p1|term-new']);
  });
});

describe('reapHerdrResiduePanes', () => {
  beforeEach(() => {
    _resetHerdrResidueSightingsForTests();
    vi.clearAllMocks();
  });

  function snapshotFor(panes: Array<{ pane_id: string; workspace_id: string; agent?: string | null; tokens?: Record<string, string> }>) {
    return ({ method }: Call) => {
      if (method === 'workspace.list') {
        return { workspaces: [{ workspace_id: 'w1', tokens: { issue: 'PAN-1' } }, { workspace_id: 'w2' }] };
      }
      if (method === 'session.snapshot') {
        return { snapshot: { panes } };
      }
      return {};
    };
  }

  it('closes a residue pane only on its second sighting (ac1)', async () => {
    const panes = [
      { pane_id: 'wE:p1', workspace_id: 'w1', tokens: { agentId: 'agent-pan-1' } },
      { pane_id: 'wE:p2', workspace_id: 'w1', terminal_id: 'term_2' },
    ];
    const processLiveness = vi.fn(async (paneId: string) => (paneId === 'wE:p2' ? 'exited' as const : 'running' as const));

    const { api: api1, log: log1 } = fakeApi(snapshotFor(panes));
    const firstActions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api1, processLiveness });
    expect(firstActions).toEqual([]);
    expect(log1.some((call) => call.method === 'pane.close')).toBe(false);
    // Only the non-agentId pane is probed.
    expect(processLiveness).toHaveBeenCalledTimes(1);
    expect(processLiveness).toHaveBeenCalledWith('wE:p2', api1);

    const { api: api2, log: log2 } = fakeApi(snapshotFor(panes));
    const secondActions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api2, processLiveness });
    expect(secondActions).toEqual(['closed idle shell pane wE:p2 in workspace w1']);
    expect(log2.find((call) => call.method === 'pane.close')?.params).toEqual({ pane_id: 'wE:p2' });
    expect(emitActivityEntry).toHaveBeenCalledWith({
      source: 'cloister',
      level: 'warn',
      message: 'Deacon closed 1 idle Herdr shell pane(s)',
    });
    expect(logDeaconEvent).toHaveBeenCalledTimes(1);
  });

  it('never closes a pane in a workspace without an issue token (ac2)', async () => {
    const panes = [{ pane_id: 'w2:p1', workspace_id: 'w2' }];
    const processLiveness = vi.fn(async () => 'exited' as const);

    for (let sweep = 0; sweep < 2; sweep++) {
      const { api, log } = fakeApi(snapshotFor(panes));
      const actions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api, processLiveness });
      expect(actions).toEqual([]);
      expect(log.some((call) => call.method === 'pane.close')).toBe(false);
    }
    expect(processLiveness).not.toHaveBeenCalled();
  });

  it('keeps exactly one pane unclosed when a whole owned workspace is residue (ac3)', async () => {
    const panes = [
      { pane_id: 'wE:root', workspace_id: 'w1' },
      { pane_id: 'wE:shell', workspace_id: 'w1', terminal_id: 'term_shell' },
    ];
    const processLiveness = vi.fn(async () => 'exited' as const);

    const closedPaneIds = new Set<string>();
    for (let sweep = 0; sweep < 2; sweep++) {
      const { api } = fakeApi((call) => {
        if (call.method === 'pane.close') closedPaneIds.add(call.params.pane_id as string);
        return snapshotFor(panes)(call);
      });
      await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api, processLiveness });
    }

    expect(closedPaneIds).toEqual(new Set(['wE:shell']));
  });

  it('returns [] and makes zero Herdr calls when paused (ac4)', async () => {
    const herdrApi = vi.fn(async () => { throw new Error('must not be called'); });
    const actions = await reapHerdrResiduePanes({ isPaused: () => true, herdrApi });
    expect(actions).toEqual([]);
    expect(herdrApi).not.toHaveBeenCalled();
  });

  it('returns [] and makes zero Herdr calls when herdrApi resolves null (ac4)', async () => {
    const actions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => null });
    expect(actions).toEqual([]);
  });

  it('returns [] and keeps the previous sighting set when a Herdr call throws', async () => {
    const panes = [
      { pane_id: 'wE:p1', workspace_id: 'w1', tokens: { agentId: 'agent-pan-1' } },
      { pane_id: 'wE:p2', workspace_id: 'w1' },
    ];
    const processLiveness = vi.fn(async () => 'exited' as const);

    const { api: api1 } = fakeApi(snapshotFor(panes));
    await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api1, processLiveness });

    const { api: api2 } = fakeApi(() => new Error('herdr socket down'));
    const failedActions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api2, processLiveness });
    expect(failedActions).toEqual([]);

    const { api: api3, log: log3 } = fakeApi(snapshotFor(panes));
    const thirdActions = await reapHerdrResiduePanes({ isPaused: () => false, herdrApi: async () => api3, processLiveness });
    expect(thirdActions).toEqual(['closed idle shell pane wE:p2 in workspace w1']);
    expect(log3.find((call) => call.method === 'pane.close')?.params).toEqual({ pane_id: 'wE:p2' });
  });
});
