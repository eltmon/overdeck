/**
 * PAN-3939: the review synthesis dispatch guard and `killAllReviewerSessions`
 * (`pan review abort`) ask the host's terminal backend, on tmux and on Herdr;
 * so do the `pan down` sweep (`killAllReviewSessions`) and the failed-spawn
 * teardown (#4182).
 *
 * Before: the guard read `listSessionNames()` + `isPaneDead`, so on tmux a bare
 * shell left after the harness exited blocked every later dispatch, and on
 * Herdr (no tmux session at all) the guard never matched. The reviewer kill
 * listed tmux sessions only, so on Herdr it closed nothing and wrote no
 * `stopped` row.
 *
 * Only the terminal backend boundary is fake: the Herdr socket client, the tmux
 * primitives, and the pane process probe. Liveness, the backend close and
 * `stopAgent` are the real code.
 */
import { Effect } from 'effect';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const herdr = vi.hoisted(() => ({
  calls: [] as { method: string; params: Record<string, unknown> }[],
  handler: (_method: string, _params: Record<string, unknown>): unknown => ({}),
}));

const tmux = vi.hoisted(() => ({
  live: new Set<string>(),
  killed: [] as string[],
  /** Runtime pid the process probe finds in the pane subtree (null: bare shell). */
  runtimePid: null as number | null,
}));

const backendSelection = vi.hoisted(() => ({ name: 'herdr' as 'herdr' | 'tmux' }));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../terminal-backends/select.js')>(),
  hostTerminalBackendName: vi.fn(async () => backendSelection.name),
  probeHerdrAvailability: vi.fn(async () => ({
    binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
  })),
}));

vi.mock('../../terminal-backends/herdr-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr-api.js')>();
  const fake = {
    call: async (method: string, params: Record<string, unknown>) => {
      herdr.calls.push({ method, params });
      const result = herdr.handler(method, params);
      if (result instanceof Error) throw result;
      return result ?? {};
    },
  };
  return { ...actual, getHerdrApiClient: () => fake };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  const { Effect: E } = await import('effect');
  return {
    ...actual,
    sessionExists: vi.fn((name: string) => E.succeed(tmux.live.has(name))),
    listSessionNames: vi.fn(() => E.succeed([...tmux.live])),
    listPaneValues: vi.fn(async (name: string) => (tmux.live.has(name) ? ['4242\t0'] : [])),
    capturePane: vi.fn(async () => ''),
    killSession: vi.fn((name: string) => E.sync(() => {
      tmux.killed.push(name);
      tmux.live.delete(name);
    })),
  };
});

vi.mock('../../agents/tmux-session-query.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../agents/tmux-session-query.js')>(),
  queryTmuxSession: vi.fn(async (name: string) => (tmux.live.has(name) ? 'exists' : 'missing')),
}));

vi.mock('../../agents/runtime-pid-probe.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../agents/runtime-pid-probe.js')>(),
  findAgentRuntimePidInSubtree: vi.fn(async () => tmux.runtimePid),
}));

// No launcher process to sweep and no git repo to read: every exec fails.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: vi.fn((_cmd: string, ...rest: unknown[]) => {
      const cb = rest.find((arg) => typeof arg === 'function') as ((err: Error | null, out?: unknown) => void) | undefined;
      cb?.(Object.assign(new Error('no match'), { code: 1 }));
    }),
  };
});

vi.mock('../../overdeck/agent-state-sync.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../overdeck/agent-state-sync.js')>(),
  getOverdeckAgentStateSync: vi.fn(() => null),
}));

vi.mock('../../overdeck/agent-rollback-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../overdeck/agent-rollback-state.js')>(),
  readRollbackAgentStateSync: vi.fn(() => null),
}));

vi.mock('../../agent-runtime.js', async (importOriginal) => {
  const { Effect: E } = await import('effect');
  return { ...await importOriginal<typeof import('../../agent-runtime.js')>(), emitAgentEvent: vi.fn(() => E.void) };
});

// Dispatch past the liveness guard stops at the conflict gate: a `gated`
// answer proves the guard let the dispatch through.
vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false })),
}));
vi.mock('../conflict-gate.js', () => ({
  buildRealConflictGateDeps: vi.fn(() => ({})),
  resolveConflictGate: vi.fn(async () => ({ gated: true })),
  getCachedConflictGateMergeability: vi.fn(() => 'conflicts'),
}));

import { saveAgentStateSync } from '../../agents.js';
import { getAgentState } from '../../agents/agent-state-read.js';
import { HerdrApiError } from '../../terminal-backends/herdr-api.js';
import { getOverdeckHome } from '../../paths.js';
import {
  killAllReviewerSessions,
  killAllReviewSessions,
  spawnReviewRoleForIssue,
  teardownFailedReviewSpawn,
} from '../review-agent.js';

const ISSUE = 'PAN-3939';
const PARENT = 'agent-pan-3939-review';
const LANE = 'agent-pan-3939-review-security';
/** Another issue's reviewer: the shutdown sweep covers every issue. */
const OTHER = 'agent-pan-4182-review';
const WORK = 'agent-pan-3939';
const CONV = 'conv-20260924-0001';
const ROW_IDS = [PARENT, LANE, OTHER, WORK];

function saveRow(id: string, extra: Record<string, unknown> = {}): void {
  saveAgentStateSync({
    id, issueId: ISSUE, workspace: '/tmp/pan-3939-ws', harness: 'claude-code', role: 'review',
    status: 'running', startedAt: '2026-09-24T00:00:00.000Z', ...extra,
  } as never);
}

function paneCloses(): string[] {
  return herdr.calls.filter((call) => call.method === 'pane.close').map((call) => String(call.params['pane_id']));
}

/**
 * A Herdr session holding the given agentId-stamped panes. Herdr keeps no
 * agent record for them (the harness exited), so each pane's shell is its
 * only foreground process: the pane is residue.
 */
function herdrResidue(panes: Record<string, string>, opts: { closeFails?: string } = {}): void {
  herdr.handler = (method, params) => {
    if (method === 'agent.get') return new HerdrApiError({ method, code: 'agent_not_found', message: 'no such agent' });
    if (method === 'session.snapshot') {
      return {
        snapshot: {
          panes: Object.entries(panes).map(([agentId, paneId]) => ({
            pane_id: paneId, terminal_id: `t-${paneId}`, workspace_id: 'w1', tokens: { agentId },
          })),
        },
      };
    }
    if (method === 'pane.process_info') return { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } };
    if (method === 'pane.close' && params['pane_id'] === opts.closeFails) {
      return new HerdrApiError({ method, code: 'internal', message: 'close refused' });
    }
    return {};
  };
}

const dispatch = () => Effect.runPromise(spawnReviewRoleForIssue({
  issueId: ISSUE, workspace: '/tmp/pan-3939-ws', branch: 'feature/pan-3939',
}));

beforeEach(() => {
  for (const id of ROW_IDS) rmSync(join(getOverdeckHome(), 'agents', id), { recursive: true, force: true });
  herdr.calls.length = 0;
  herdr.handler = () => ({});
  tmux.live.clear();
  tmux.killed.length = 0;
  tmux.runtimePid = null;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('synthesis dispatch guard asks the terminal backend (PAN-3939)', () => {
  it('tmux: a bare shell left after the harness exited is replaced, not deferred to', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(PARENT);
    saveRow(PARENT);

    const result = await dispatch();

    expect(result.gated).toBe(true);
    expect(tmux.killed).toContain(PARENT);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
  });

  it('tmux: a live harness keeps the dispatch a no-op', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(PARENT);
    tmux.runtimePid = 777;
    saveRow(PARENT);

    const result = await dispatch();

    expect(result).toMatchObject({ success: false, message: expect.stringContaining('already running') });
    expect(tmux.killed).toEqual([]);
  });

  it('herdr: a residue pane whose harness exited is closed and the review re-dispatched', async () => {
    backendSelection.name = 'herdr';
    herdrResidue({ [PARENT]: 'w1:p2' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });

    const result = await dispatch();

    expect(result.gated).toBe(true);
    expect(paneCloses()).toContain('w1:p2');
    expect(getAgentState(PARENT)?.status).toBe('stopped');
  });

  it('herdr: a live reviewer keeps the dispatch a no-op', async () => {
    backendSelection.name = 'herdr';
    herdr.handler = (method) => (method === 'agent.get'
      ? { agent: { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', agent_status: 'working' } }
      : {});
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });

    const result = await dispatch();

    expect(result).toMatchObject({ success: false, message: expect.stringContaining('already running') });
    expect(paneCloses()).toEqual([]);
  });

  it('herdr: an unanswered probe holds the dispatch instead of launching a duplicate', async () => {
    backendSelection.name = 'herdr';
    herdr.handler = (method) => new HerdrApiError({ method, code: 'socket_error', message: 'socket down' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });

    const result = await dispatch();

    expect(result).toMatchObject({ success: false, message: expect.stringContaining('held') });
    expect(result.gated).toBeUndefined();
    expect(paneCloses()).toEqual([]);
    expect(getAgentState(PARENT)?.status).toBe('running');
  });
});

describe('killAllReviewerSessions closes through the terminal backend (PAN-3939)', () => {
  it('herdr: closes the parent and lane panes and writes stopped rows', async () => {
    backendSelection.name = 'herdr';
    herdrResidue({ [PARENT]: 'w1:p2', [LANE]: 'w1:p3' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });
    saveRow(LANE, { backend: 'herdr', paneId: 'w1:p3', reviewSubRole: 'security' });

    const result = await killAllReviewerSessions('overdeck', ISSUE);

    expect(result.killed.sort()).toEqual([PARENT, LANE].sort());
    expect(result.failed).toEqual([]);
    expect(paneCloses()).toEqual(expect.arrayContaining(['w1:p2', 'w1:p3']));
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(getAgentState(LANE)?.status).toBe('stopped');
  });

  it('herdr: reports a failed close and leaves that reviewer\'s row alone', async () => {
    backendSelection.name = 'herdr';
    herdrResidue({ [PARENT]: 'w1:p2', [LANE]: 'w1:p3' }, { closeFails: 'w1:p3' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });
    saveRow(LANE, { backend: 'herdr', paneId: 'w1:p3', reviewSubRole: 'security' });

    const result = await killAllReviewerSessions('overdeck', ISSUE);

    expect(result.killed).toEqual([PARENT]);
    expect(result.failed).toEqual([LANE]);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(getAgentState(LANE)?.status).toBe('running');
  });

  it('tmux: kills the sessions, legacy names included, and writes stopped rows', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(PARENT);
    tmux.live.add('review-coordinator-pan-3939-1234567890');
    tmux.live.add('agent-pan-3939');
    saveRow(PARENT);

    const result = await killAllReviewerSessions('overdeck', ISSUE);

    expect(result.killed.sort()).toEqual([PARENT, 'review-coordinator-pan-3939-1234567890'].sort());
    expect(result.failed).toEqual([]);
    expect(tmux.killed).not.toContain('agent-pan-3939');
    expect(getAgentState(PARENT)?.status).toBe('stopped');
  });

  it('tmux: a row that claims a reviewer is running is stopped even when no session is left', async () => {
    backendSelection.name = 'tmux';
    saveRow(LANE, { reviewSubRole: 'security' });

    const result = await killAllReviewerSessions('overdeck', ISSUE);

    expect(result).toEqual({ killed: [], failed: [] });
    expect(getAgentState(LANE)?.status).toBe('stopped');
  });
});

/**
 * A Herdr session whose panes carry `agentId` and `role` tokens, as launched
 * panes do. No Herdr agent record: each pane is residue. A closed pane leaves
 * the snapshot, so `stopAgent`'s own close after the sweep's finds nothing.
 */
function herdrPanes(initial: { agentId: string; paneId: string; role?: string }[], opts: { closeFails?: string } = {}): void {
  let panes = [...initial];
  herdr.handler = (method, params) => {
    if (method === 'pane.close' && params['pane_id'] !== opts.closeFails) {
      panes = panes.filter((pane) => pane.paneId !== params['pane_id']);
    }
    if (method === 'agent.get') return new HerdrApiError({ method, code: 'agent_not_found', message: 'no such agent' });
    if (method === 'session.snapshot') {
      return {
        snapshot: {
          panes: panes.map(({ agentId, paneId, role }) => ({
            pane_id: paneId, terminal_id: `t-${paneId}`, workspace_id: 'w1', tokens: { agentId, ...(role ? { role } : {}) },
          })),
        },
      };
    }
    if (method === 'pane.process_info') return { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } };
    if (method === 'pane.close' && params['pane_id'] === opts.closeFails) {
      return new HerdrApiError({ method, code: 'internal', message: 'close refused' });
    }
    return {};
  };
}

function lookedUp(agentId: string): boolean {
  return herdr.calls.some((call) => call.method === 'agent.get' && call.params['target'] === agentId);
}

describe('killAllReviewSessions (pan down) closes through the terminal backend (#4182)', () => {
  it('herdr: closes every issue\'s reviewer panes and writes stopped rows, never a work or conversation pane', async () => {
    backendSelection.name = 'herdr';
    herdrPanes([
      { agentId: PARENT, paneId: 'w1:p2', role: 'review' },
      { agentId: LANE, paneId: 'w1:p3', role: 'review' },
      // Its row already says stopped: only the live inventory finds it.
      { agentId: OTHER, paneId: 'w1:p4', role: 'review' },
      { agentId: WORK, paneId: 'w1:p1', role: 'work' },
      { agentId: CONV, paneId: 'w1:p9' },
    ]);
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });
    saveRow(LANE, { backend: 'herdr', paneId: 'w1:p3', reviewSubRole: 'security' });
    saveRow(OTHER, { backend: 'herdr', paneId: 'w1:p4', issueId: 'PAN-4182', status: 'stopped' });
    saveRow(WORK, { backend: 'herdr', paneId: 'w1:p1', role: 'work' });

    const result = await killAllReviewSessions();

    expect(result.killed.sort()).toEqual([PARENT, LANE, OTHER].sort());
    expect(result.failed).toEqual([]);
    expect(paneCloses().sort()).toEqual(['w1:p2', 'w1:p3', 'w1:p4']);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(getAgentState(LANE)?.status).toBe('stopped');
    expect(getAgentState(WORK)?.status).toBe('running');
  });

  it('herdr: reports a failed close and leaves that reviewer\'s row alone', async () => {
    backendSelection.name = 'herdr';
    herdrPanes([
      { agentId: PARENT, paneId: 'w1:p2', role: 'review' },
      { agentId: LANE, paneId: 'w1:p3', role: 'review' },
    ], { closeFails: 'w1:p3' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2' });
    saveRow(LANE, { backend: 'herdr', paneId: 'w1:p3', reviewSubRole: 'security' });

    const result = await killAllReviewSessions();

    expect(result.killed).toEqual([PARENT]);
    expect(result.failed).toEqual([LANE]);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(getAgentState(LANE)?.status).toBe('running');
  });

  it('herdr: a stopped reviewer row with no pane is not probed', async () => {
    backendSelection.name = 'herdr';
    herdrPanes([]);
    saveRow(OTHER, { issueId: 'PAN-4182', status: 'stopped' });

    const result = await killAllReviewSessions();

    expect(result).toEqual({ killed: [], failed: [] });
    expect(lookedUp(OTHER)).toBe(false);
  });

  it('tmux: kills reviewer sessions, legacy names included, and leaves work and conversation sessions', async () => {
    backendSelection.name = 'tmux';
    for (const name of [PARENT, LANE, 'review-coordinator-pan-4182-1234567890', WORK, CONV]) tmux.live.add(name);
    saveRow(PARENT);
    saveRow(LANE, { reviewSubRole: 'security' });
    saveRow(WORK, { role: 'work' });

    const result = await killAllReviewSessions();

    expect(result.killed.sort()).toEqual([PARENT, LANE, 'review-coordinator-pan-4182-1234567890'].sort());
    expect(result.failed).toEqual([]);
    expect(tmux.killed).not.toContain(WORK);
    expect(tmux.killed).not.toContain(CONV);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(getAgentState(LANE)?.status).toBe('stopped');
    expect(getAgentState(WORK)?.status).toBe('running');
  });

  it('tmux: a row that claims a reviewer is running is stopped even when no session is left', async () => {
    backendSelection.name = 'tmux';
    saveRow(OTHER, { issueId: 'PAN-4182' });

    const result = await killAllReviewSessions();

    expect(result).toEqual({ killed: [], failed: [] });
    expect(getAgentState(OTHER)?.status).toBe('stopped');
  });
});

describe('failed review spawn teardown closes through the terminal backend (#4182)', () => {
  const dispatchStartedAtMs = Date.parse('2026-09-24T00:00:00.000Z');

  it('herdr: closes the half-started reviewer\'s pane and writes a stopped row', async () => {
    backendSelection.name = 'herdr';
    herdrPanes([{ agentId: PARENT, paneId: 'w1:p2', role: 'review' }]);
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2', status: 'starting' });

    const failure = await teardownFailedReviewSpawn(PARENT, dispatchStartedAtMs);

    expect(failure).toBeNull();
    expect(paneCloses()).toEqual(['w1:p2']);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
  });

  it('herdr: a failed close is reported and the row left alone', async () => {
    backendSelection.name = 'herdr';
    herdrPanes([{ agentId: PARENT, paneId: 'w1:p2', role: 'review' }], { closeFails: 'w1:p2' });
    saveRow(PARENT, { backend: 'herdr', paneId: 'w1:p2', status: 'starting' });

    const failure = await teardownFailedReviewSpawn(PARENT, dispatchStartedAtMs);

    expect(failure).toContain(PARENT);
    expect(getAgentState(PARENT)?.status).toBe('starting');
  });

  it('tmux: kills the half-started reviewer\'s session and writes a stopped row', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(PARENT);
    saveRow(PARENT, { status: 'starting' });

    const failure = await teardownFailedReviewSpawn(PARENT, dispatchStartedAtMs);

    expect(failure).toBeNull();
    expect(tmux.killed).toEqual([PARENT]);
    expect(getAgentState(PARENT)?.status).toBe('stopped');
  });

  it('tmux: a reviewer an earlier dispatch started is not touched', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(PARENT);
    saveRow(PARENT, { startedAt: '2026-09-23T00:00:00.000Z' });

    const failure = await teardownFailedReviewSpawn(PARENT, dispatchStartedAtMs);

    expect(failure).toBeNull();
    expect(tmux.killed).toEqual([]);
    expect(getAgentState(PARENT)?.status).toBe('running');
  });
});
