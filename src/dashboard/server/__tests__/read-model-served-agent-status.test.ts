/**
 * #4098 — the dashboard snapshot served each agent's stored status, copied at
 * boot, so dead agents read `running`. The served status is now derived from
 * the terminal backend's pane inventory; a boot-time inventory that never
 * answered reads `unknown`, never dead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSnapshot, BackendPane } from '@overdeck/contracts';

import { deriveServedAgentStatuses } from '../read-model.js';

function row(id: string, status: AgentSnapshot['status'], extra: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { id, issueId: 'PAN-4098', status, ...extra } as AgentSnapshot;
}

function pane(id: string, extra: Partial<BackendPane> = {}): BackendPane {
  return {
    id,
    role: 'work',
    harness: 'claude-code',
    model: 'claude',
    state: 'working',
    terminalId: id,
    ...extra,
  } as BackendPane;
}

function panesById(...panes: BackendPane[]): Record<string, BackendPane> {
  return Object.fromEntries(panes.map((p) => [p.id, p]));
}

function statuses(agents: readonly AgentSnapshot[]): Record<string, string> {
  return Object.fromEntries(agents.map((a) => [a.id, a.status]));
}

describe('deriveServedAgentStatuses', () => {
  it('serves a stored-running agent with no live pane as stopped', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running'), row('planning-pan-2', 'starting'), row('strike-pan-3', 'running')],
      {},
      'trusted',
    );
    expect(statuses(served)).toEqual({
      'agent-pan-1': 'stopped',
      'planning-pan-2': 'stopped',
      'strike-pan-3': 'stopped',
    });
  });

  it('clears the pane liveness flags with a trusted downgrade and fills hasLivePane from the old name (#4105)', () => {
    const served = deriveServedAgentStatuses(
      [
        row('agent-pan-dead', 'running', { hasLiveTmuxSession: true }),
        row('agent-pan-live', 'running', { hasLiveTmuxSession: true }),
        row('agent-pan-idle', 'stopped', { hasLiveTmuxSession: true }),
      ],
      panesById(pane('agent-pan-live')),
      'trusted',
    );
    const byId = Object.fromEntries(served.map((a) => [a.id, a]));
    expect(byId['agent-pan-dead']).toMatchObject({ status: 'stopped', hasLivePane: false, hasLiveTmuxSession: false });
    expect(byId['agent-pan-live']).toMatchObject({ status: 'running', hasLivePane: true, hasLiveTmuxSession: true });
    // A stored stop is intent, not a downgrade: an idle-alive Herdr pane keeps its flag.
    expect(byId['agent-pan-idle']).toMatchObject({ status: 'stopped', hasLivePane: true, hasLiveTmuxSession: true });
  });

  it('leaves the pane liveness flags alone while the inventory has never answered (#4105)', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running', { hasLiveTmuxSession: true })],
      {},
      'unavailable',
    );
    expect(served[0]).toMatchObject({ status: 'unknown', hasLivePane: true, hasLiveTmuxSession: true });
  });

  it('serves an exited pane as stopped', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running')],
      panesById(pane('agent-pan-1', { state: 'exited' })),
      'trusted',
    );
    expect(served[0]?.status).toBe('stopped');
  });

  it('keeps a live agent running, matched by terminal id or by its agentId token', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running'), row('agent-pan-2', 'starting'), row('agent-pan-3', 'running')],
      panesById(
        // tmux: the session name is the terminal id.
        pane('agent-pan-1'),
        // Herdr: a native pane handle carrying the `agentId` token.
        pane('w1:p2', { terminalId: 'term-w1p2', agentId: 'agent-pan-2', state: 'idle' }),
        pane('w1:p3', { terminalId: 'term-w1p3', agentId: 'agent-pan-3', state: 'blocked' }),
      ),
      'trusted',
    );
    expect(statuses(served)).toEqual({
      'agent-pan-1': 'running',
      'agent-pan-2': 'starting',
      'agent-pan-3': 'running',
    });
  });

  it('serves unknown, not stopped, while the inventory has never answered', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running'), row('agent-pan-2', 'stopped')],
      {},
      'unavailable',
    );
    expect(statuses(served)).toEqual({ 'agent-pan-1': 'unknown', 'agent-pan-2': 'stopped' });
  });

  it('never promotes: a stored stopped agent whose pane outlived the stop stays stopped', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1', 'stopped', { stoppedByUser: true }), row('agent-pan-2', 'error')],
      panesById(pane('agent-pan-1'), pane('agent-pan-2')),
      'trusted',
    );
    expect(statuses(served)).toEqual({ 'agent-pan-1': 'stopped', 'agent-pan-2': 'error' });
  });

  it('keeps operator intent fields on a derived-stopped row', () => {
    const [served] = deriveServedAgentStatuses(
      [row('agent-pan-1', 'running', { paused: true, pausedReason: 'operator' })],
      {},
      'trusted',
    );
    expect(served).toMatchObject({ status: 'stopped', paused: true, pausedReason: 'operator' });
  });

  it('does not match by issue and role: a live review pane does not revive a dead reviewer', () => {
    const served = deriveServedAgentStatuses(
      [row('agent-pan-1-review', 'running', { role: 'review' })],
      panesById(pane('w1:p9', { terminalId: 'term-w1p9', agentId: 'agent-pan-1-review-2', issue: 'PAN-4098', role: 'review' })),
      'trusted',
    );
    expect(served[0]?.status).toBe('stopped');
  });

  it('leaves rows the inventory cannot answer for (non-managed ids) at their stored status', () => {
    const served = deriveServedAgentStatuses([row('sequencer-runner', 'running')], {}, 'trusted');
    expect(served[0]?.status).toBe('running');
  });
});

// ─── getSnapshot wiring: the boot race ───────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../services/backend-inventory.js');
  vi.doUnmock('../services/issue-service-singleton.js');
});

interface InventoryFake {
  panes: readonly BackendPane[];
  degraded: boolean;
}

async function snapshotStatuses(
  storedAgents: ReadonlyArray<Record<string, unknown>>,
  reads: InventoryFake[],
): Promise<Array<Record<string, string>>> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'pan-4098-read-model-'));
  const originalHome = process.env['OVERDECK_HOME'];
  process.env['OVERDECK_HOME'] = tmpHome;
  let current: InventoryFake = { panes: [], degraded: true };
  try {
    vi.resetModules();
    vi.doMock('../services/backend-inventory.js', () => ({
      getBackendPanes: async () => current.panes,
      isBackendInventoryDegraded: () => current.degraded,
      onBackendPanesChanged: () => {},
      startBackendInventory: async () => {},
    }));
    vi.doMock('../services/issue-service-singleton.js', () => ({
      getSharedIssueService: () => ({
        getIssues: () => [],
        listDerivedStates: () => [],
        onIssuesChanged: () => {},
        onDerivedStatesChanged: () => {},
      }),
    }));
    const { ReadModelService, ReadModelServiceLive } = await import('../read-model.js');
    const { AgentsResolver: AR } = await import('../../../lib/overdeck/agents.js');
    const { Layer: L } = await import('effect');
    const mockLayer = L.succeed(AR, AR.of({
      list: (_f: never) => Effect.succeed(storedAgents as never),
      get: (_id: never) => Effect.fail(new Error('not found') as never),
      isAlive: (_id: never) => Effect.succeed(false),
      getRuntime: (_id: never) => Effect.succeed(null),
      getHealthHistory: (_id: never) => Effect.succeed([]),
    }));
    const program = Effect.gen(function* () {
      const svc = yield* ReadModelService;
      const out: Array<Record<string, string>> = [];
      for (const read of reads) {
        current = read;
        const snapshot = yield* svc.getSnapshot;
        out.push(statuses(snapshot.agents));
      }
      return out;
    });
    return await Effect.runPromise(Effect.provide(program, ReadModelServiceLive.pipe(L.provide(mockLayer))));
  } finally {
    process.env['OVERDECK_HOME'] = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function storedAgent(id: string, status: string): Record<string, unknown> {
  return {
    id,
    issueId: 'PAN-4098',
    role: 'work',
    status,
    workspace: null,
    sessionId: null,
    harness: 'claude-code',
    model: 'claude',
    startedAt: null,
    stoppedByUser: null,
    paused: null,
    pausedReason: null,
    troubled: null,
    consecutiveFailures: 0,
    firstFailureInRunAt: null,
    lastFailureNextRetryAt: null,
  };
}

describe('ReadModel getSnapshot — served agent status (#4098)', () => {
  it('derives status from the inventory, and serves unknown until the first good read', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const livePane = pane('agent-pan-live');
    const results = await snapshotStatuses(
      [storedAgent('agent-pan-dead', 'running'), storedAgent('agent-pan-live', 'running')],
      [
        // Boot: Herdr is not up yet, the inventory serves [] and is degraded.
        { panes: [], degraded: true },
        // Herdr answers.
        { panes: [livePane], degraded: false },
        // Herdr drops again: the last-good panes are served, still trusted.
        { panes: [livePane], degraded: true },
      ],
    );
    expect(results).toEqual([
      { 'agent-pan-dead': 'unknown', 'agent-pan-live': 'unknown' },
      { 'agent-pan-dead': 'stopped', 'agent-pan-live': 'running' },
      { 'agent-pan-dead': 'stopped', 'agent-pan-live': 'running' },
    ]);
  });
});
