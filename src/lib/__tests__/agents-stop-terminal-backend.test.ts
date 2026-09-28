/**
 * PAN-3947: stopping an agent terminates it through the host's terminal
 * backend. On a Herdr host `pan kill` / dashboard Stop / the post-merge
 * lifecycle used to rewrite state.json only — the pane and the idle harness in
 * it stayed alive, liveness readers kept reporting the agent, and the next
 * start was refused as "already running".
 *
 * Every terminal here is fake: the Herdr socket client and the tmux primitives
 * are mocked, so no real pane or session on this host is touched.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface HerdrCall { method: string; params: Record<string, unknown> }

const herdr = vi.hoisted(() => ({
  calls: [] as { method: string; params: Record<string, unknown> }[],
  handler: (_method: string, _params: Record<string, unknown>): unknown => ({}),
}));

const tmux = vi.hoisted(() => ({
  live: new Set<string>(),
  killed: [] as string[],
}));

const backendSelection = vi.hoisted(() => ({ name: 'herdr' as 'herdr' | 'tmux' }));

const reapPrimeAgentDaemon = vi.hoisted(() => vi.fn(async (_agentId: string) => 'terminated' as const));

vi.mock('../prime-agent/daemon.js', () => ({ reapPrimeAgentDaemon }));

vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return {
    ...actual,
    get AGENTS_DIR() {
      return join(process.env.TEST_STOP_BACKEND_HOME!, 'agents');
    },
  };
});

vi.mock('../terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: vi.fn(async () => backendSelection.name),
    // PAN-3956: a herdr host in these tests has a live session server.
    probeHerdrAvailability: vi.fn(async () => ({
      binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
    })),
  };
});

// The Herdr adapter singleton captures its client at import time, so the fake
// has to be in place before herdr.js loads.
vi.mock('../terminal-backends/herdr-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../terminal-backends/herdr-api.js')>();
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

vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  const { Effect: E } = await import('effect');
  return {
    ...actual,
    sessionExists: vi.fn((name: string) => E.succeed(tmux.live.has(name))),
    capturePane: vi.fn(async () => ''),
    killSession: vi.fn((name: string) => E.sync(() => {
      tmux.killed.push(name);
      tmux.live.delete(name);
    })),
    sessionExistsSync: vi.fn((name: string) => tmux.live.has(name)),
    capturePaneSync: vi.fn(() => ''),
    killSessionSync: vi.fn(),
  };
});

// No launcher process to sweep: pgrep "finds nothing".
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

vi.mock('../overdeck/agent-state-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overdeck/agent-state-sync.js')>();
  return { ...actual, getOverdeckAgentStateSync: vi.fn(() => null) };
});

vi.mock('../overdeck/agent-rollback-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overdeck/agent-rollback-state.js')>();
  return { ...actual, readRollbackAgentStateSync: vi.fn(() => null) };
});

vi.mock('../agent-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent-runtime.js')>();
  const { Effect: E } = await import('effect');
  return { ...actual, emitAgentEvent: vi.fn(() => E.void) };
});

import { saveAgentStateSync, stopAgent } from '../agents.js';
import { getAgentStateFilePath } from '../agents/agent-state-read.js';
import { closeAgentPane, closeIssuePanes } from '../terminal-backends/launch.js';
import { findHerdrAgentPane, HerdrBackend } from '../terminal-backends/herdr.js';
import { tmuxBackend } from '../terminal-backends/tmux.js';

const AGENT = 'agent-pan-3947';

function herdrPaneCloses(): string[] {
  return herdr.calls
    .filter((call) => call.method === 'pane.close')
    .map((call) => String(call.params['pane_id']));
}

/** A Herdr session holding one detected agent named `AGENT` in pane `wG:p2`. */
function herdrWithDetectedAgent(): void {
  herdr.handler = (method, params) => {
    if (method === 'agent.get' && params['target'] === AGENT) {
      return { agent: { pane_id: 'wG:p2', terminal_id: 't2', workspace_id: 'wG', agent_status: 'idle' } };
    }
    if (method === 'agent.get') return new Error('no such agent');
    if (method === 'session.snapshot') return { snapshot: { panes: [] } };
    return {};
  };
}

let testHome: string;

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-3947-stop-backend-'));
  process.env.TEST_STOP_BACKEND_HOME = testHome;
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.TEST_STOP_BACKEND_HOME;
});

beforeEach(() => {
  rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  mkdirSync(join(testHome, 'agents'), { recursive: true });
  herdr.calls.length = 0;
  herdr.handler = () => ({});
  tmux.live.clear();
  tmux.killed.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('stopAgent terminates through the terminal backend (PAN-3947)', () => {
  it('closes the Herdr pane on a Herdr host', async () => {
    backendSelection.name = 'herdr';
    herdrWithDetectedAgent();

    await Effect.runPromise(stopAgent(AGENT, 'operator'));

    expect(herdrPaneCloses()).toEqual(['wG:p2']);
    expect(tmux.killed).toEqual([]);
  });

  it('kills the tmux session on a tmux host', async () => {
    backendSelection.name = 'tmux';
    tmux.live.add(AGENT);

    await Effect.runPromise(stopAgent(AGENT, 'operator'));

    expect(tmux.killed).toEqual([AGENT]);
    expect(herdr.calls).toEqual([]);
  });

  it('still completes the stop when the Herdr socket is down', async () => {
    backendSelection.name = 'herdr';
    herdr.handler = () => new Error('socket_error');

    // stopAgent resolves the backend close result (PAN-3911). A down socket
    // answers no lookup, so the close reads as `absent` (documented on
    // closeAgentPaneDetailed); the stop itself still completes.
    await expect(Effect.runPromise(stopAgent(AGENT, 'operator'))).resolves.toEqual({ outcome: 'absent' });
    expect(herdrPaneCloses()).toEqual([]);
  });
});

describe('closeAgentPane', () => {
  it('closes a Herdr residue pane whose shell is back at its prompt', async () => {
    // Pane-bound agent: no Herdr agent record, only the agentId-stamped pane.
    // Its harness exited, so findHerdrAgent (a liveness read) drops it — a stop
    // must still close it.
    const log: HerdrCall[] = [];
    const api = {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        if (method === 'agent.get') throw new Error('no such agent');
        if (method === 'session.snapshot') {
          return {
            snapshot: {
              panes: [{ pane_id: 'wG:pA', terminal_id: 'tA', workspace_id: 'wG', tokens: { agentId: `${AGENT}-review` } }],
            },
          };
        }
        return {};
      },
    };
    const backend = new HerdrBackend(api as never);
    herdr.handler = (method, params) => api.call(method, params);

    const closed = await closeAgentPane(`${AGENT}-review`, backend);

    expect(closed).toBe(true);
    expect(log.filter((call) => call.method === 'pane.close').map((call) => call.params['pane_id'])).toEqual(['wG:pA']);
    expect(log.some((call) => call.method === 'pane.process_info')).toBe(false);
  });

  it('returns false and closes nothing when Herdr has no pane for the agent', async () => {
    herdr.handler = (method) => {
      if (method === 'agent.get') return new Error('no such agent');
      if (method === 'session.snapshot') return { snapshot: { panes: [] } };
      return {};
    };
    const closed = await closeAgentPane(AGENT, new HerdrBackend({ call: vi.fn() } as never));
    expect(closed).toBe(false);
  });

  it('kills a pre-Herdr tmux session of the same name on a Herdr host', async () => {
    herdrWithDetectedAgent();
    tmux.live.add(AGENT);
    const backendApi = { call: vi.fn(async () => ({})) };

    const closed = await closeAgentPane(AGENT, new HerdrBackend(backendApi as never));

    expect(closed).toBe(true);
    expect(backendApi.call).toHaveBeenCalledWith('pane.close', { pane_id: 'wG:p2' });
    expect(tmux.killed).toEqual([AGENT]);
  });

  it('kills the tmux session through the tmux adapter', async () => {
    tmux.live.add(AGENT);
    expect(await closeAgentPane(AGENT, tmuxBackend)).toBe(true);
    expect(tmux.killed).toEqual([AGENT]);
  });

  it('is a no-op on tmux when the session is already gone', async () => {
    expect(await closeAgentPane(AGENT, tmuxBackend)).toBe(false);
    expect(tmux.killed).toEqual([]);
  });
});

describe('PAN-3966: stop closes the agent\'s Herdr terminals when tokens are gone', () => {
  const recorded = 'w12:p2';

  /**
   * The live shape seen on 2026-09-24 after a Herdr restore: three idle shells
   * in the issue workspace, none carrying a token, no agent record for the
   * exited harness. Only state.json's `paneId` still names the agent's pane.
   */
  function restoredIssueWorkspace(extra: Record<string, unknown>[] = []): void {
    herdr.handler = (method) => {
      if (method === 'agent.get') return new Error('agent_not_found');
      if (method === 'session.snapshot') {
        return {
          snapshot: {
            panes: [
              { pane_id: 'w12:p1', terminal_id: 't1', workspace_id: 'w12' },
              { pane_id: 'w12:p2', terminal_id: 't2', workspace_id: 'w12' },
              { pane_id: 'w12:p3', terminal_id: 't3', workspace_id: 'w12' },
              ...extra,
            ],
          },
        };
      }
      if (method === 'workspace.list') return { workspaces: [{ workspace_id: 'w12', label: 'PAN-3947' }] };
      return {};
    };
  }

  it('stopAgent closes the pane state.json recorded', async () => {
    backendSelection.name = 'herdr';
    restoredIssueWorkspace();
    saveAgentStateSync({
      id: AGENT, issueId: 'PAN-3947', workspace: '/tmp/ws', harness: 'claude-code', role: 'work',
      status: 'running', startedAt: '2026-09-24T00:00:00.000Z', backend: 'herdr', paneId: recorded,
    } as never);

    try {
      await Effect.runPromise(stopAgent(AGENT, 'operator'));
    } finally {
      rmSync(dirname(getAgentStateFilePath(AGENT)), { recursive: true, force: true });
    }

    expect(herdrPaneCloses()).toEqual([recorded]);
    // The issue workspace is shared by the issue's agents: never closed by a stop.
    expect(herdr.calls.some((call) => call.method === 'workspace.close')).toBe(false);
  });

  it('closeAgentPane takes an explicit recorded pane id', async () => {
    restoredIssueWorkspace();
    const api = { call: vi.fn(async () => ({})) };

    expect(await closeAgentPane(AGENT, new HerdrBackend(api as never), { recordedPaneId: recorded })).toBe(true);
    expect(api.call).toHaveBeenCalledWith('pane.close', { pane_id: recorded });
    expect(api.call).toHaveBeenCalledTimes(1);
  });

  it('never closes a recorded pane another agent now owns', async () => {
    herdr.handler = (method) => {
      if (method === 'agent.get') return new Error('agent_not_found');
      if (method === 'session.snapshot') {
        return {
          snapshot: {
            panes: [
              { pane_id: 'w12:p2', terminal_id: 't2', workspace_id: 'w12', tokens: { agentId: 'agent-pan-3947-review' } },
              { pane_id: 'w12:p3', terminal_id: 't3', workspace_id: 'w12', agent: 'claude', name: 'someone-else' },
            ],
          },
        };
      }
      return {};
    };
    const api = { call: vi.fn(async () => ({})) };
    const backend = new HerdrBackend(api as never);

    expect(await closeAgentPane(AGENT, backend, { recordedPaneId: 'w12:p2' })).toBe(false);
    expect(await closeAgentPane(AGENT, backend, { recordedPaneId: 'w12:p3' })).toBe(false);
    expect(api.call).not.toHaveBeenCalled();
  });

  it('closes every pane stamped with the agent id, not only the first', async () => {
    herdr.handler = (method) => {
      if (method === 'agent.get') return new Error('agent_not_found');
      if (method === 'session.snapshot') {
        return {
          snapshot: {
            panes: [
              { pane_id: 'wG:p2', terminal_id: 't2', workspace_id: 'wG', tokens: { agentId: AGENT } },
              { pane_id: 'wG:p5', terminal_id: 't5', workspace_id: 'wG', tokens: { agentId: AGENT } },
              { pane_id: 'wG:p6', terminal_id: 't6', workspace_id: 'wG', tokens: { agentId: `${AGENT}-review` } },
            ],
          },
        };
      }
      return {};
    };
    const api = { call: vi.fn(async () => ({})) };

    expect(await closeAgentPane(AGENT, new HerdrBackend(api as never))).toBe(true);
    expect(api.call.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { pane_id: 'wG:p2' },
      { pane_id: 'wG:p5' },
    ]);
  });

  it('closes a workspace the agent owns alone, root shell and residue included', async () => {
    const runner = 'sequencer-runner';
    herdr.handler = (method, params) => {
      if (method === 'agent.get' && params['target'] === runner) {
        return { agent: { pane_id: 'w13:p18', terminal_id: 't18', workspace_id: 'w13', agent_status: 'idle' } };
      }
      if (method === 'session.snapshot') {
        return {
          snapshot: {
            panes: [
              { pane_id: 'w13:p1', terminal_id: 'r1', workspace_id: 'w13' },
              { pane_id: 'w13:p18', terminal_id: 't18', workspace_id: 'w13', tokens: { agentId: runner } },
            ],
          },
        };
      }
      if (method === 'workspace.list') {
        return {
          workspaces: [
            { workspace_id: 'wD', label: runner },
            { workspace_id: 'w13', label: runner, tokens: { issue: runner } },
            { workspace_id: 'w12', label: 'PAN-3947' },
          ],
        };
      }
      return {};
    };
    const api = { call: vi.fn(async () => ({})) };

    expect(await closeAgentPane(runner, new HerdrBackend(api as never))).toBe(true);
    expect(api.call.mock.calls.map((call) => (call as unknown[]).slice(0, 2))).toEqual([
      ['workspace.close', { workspace_id: 'wD' }],
      ['workspace.close', { workspace_id: 'w13' }],
    ]);
  });
});

describe('findHerdrAgentPane', () => {
  it('prefers the detected agent record', async () => {
    herdrWithDetectedAgent();
    await expect(findHerdrAgentPane(AGENT)).resolves.toEqual({ paneId: 'wG:p2', terminalId: 't2', workspaceId: 'wG' });
  });

  it('returns null when the socket does not answer', async () => {
    herdr.handler = () => new Error('socket_error');
    await expect(findHerdrAgentPane(AGENT)).resolves.toBeNull();
  });
});

describe('closeIssuePanes', () => {
  const panes = [
    { pane_id: 'wG:p2', terminal_id: 't2', workspace_id: 'wG', tokens: { issue: 'PAN-3947', role: 'work', agentId: AGENT } },
    { pane_id: 'wG:pA', terminal_id: 'tA', workspace_id: 'wG', tokens: { issue: 'PAN-3947', role: 'review', agentId: `${AGENT}-review` } },
    { pane_id: 'wG:p8', terminal_id: 't8', workspace_id: 'wG', tokens: { issue: 'PAN-3947', role: 'test', agentId: `${AGENT}-test` } },
    { pane_id: 'wH:p1', terminal_id: 'u1', workspace_id: 'wH', tokens: { issue: 'PAN-9999', role: 'review', agentId: 'agent-pan-9999-review' } },
    { pane_id: 'wC:p1', terminal_id: 'c1', workspace_id: 'wC', tokens: { role: 'work', agentId: 'conv-1' } },
  ];

  function inventoryApi(log: HerdrCall[]) {
    return {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        if (method === 'agent.list') return { agents: [] };
        if (method === 'session.snapshot') return { snapshot: { panes } };
        return {};
      },
    };
  }

  it('closes only the issue panes with the requested roles', async () => {
    const log: HerdrCall[] = [];
    const closed = await closeIssuePanes('pan-3947', { roles: ['review', 'test', 'uat'] }, new HerdrBackend(inventoryApi(log) as never));

    expect(closed).toEqual([`${AGENT}-review`, `${AGENT}-test`]);
    expect(log.filter((call) => call.method === 'pane.close').map((call) => call.params['pane_id'])).toEqual(['wG:pA', 'wG:p8']);
  });

  it('closes every pane of the issue when no role filter is given', async () => {
    const log: HerdrCall[] = [];
    const closed = await closeIssuePanes('PAN-3947', {}, new HerdrBackend(inventoryApi(log) as never));
    expect(closed).toEqual([AGENT, `${AGENT}-review`, `${AGENT}-test`]);
  });

  it('never closes an operator conversation pane, even one stamped with the issue', async () => {
    const log: HerdrCall[] = [];
    const api = {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        if (method === 'agent.list') return { agents: [] };
        if (method === 'session.snapshot') {
          return {
            snapshot: {
              panes: [{ pane_id: 'wC:p9', terminal_id: 'c9', workspace_id: 'wC', tokens: { issue: 'PAN-3947', role: 'work', agentId: 'conv-42' } }],
            },
          };
        }
        return {};
      },
    };
    expect(await closeIssuePanes('PAN-3947', {}, new HerdrBackend(api as never))).toEqual([]);
    expect(log.some((call) => call.method === 'pane.close')).toBe(false);
  });

  describe('after a Herdr restore dropped the tokens (#4096)', () => {
    // Seen live on 2026-09-24: every restored pane had lost its tokens, 16 of
    // 17 workspaces had lost their `issue` token, and every workspace kept its
    // label. `wD` is the restored `sequencer-runner`; `w13` is the duplicate the
    // next launch created beside it.
    const restoredPanes = [
      { pane_id: 'wX:p1', terminal_id: 'x1', workspace_id: 'wX' },
      { pane_id: 'wX:p2', terminal_id: 'x2', workspace_id: 'wX' },
      { pane_id: 'wD:p1', terminal_id: 'd1', workspace_id: 'wD' },
      { pane_id: 'w13:p1H', terminal_id: 'h1', workspace_id: 'w13', tokens: { issue: 'sequencer-runner', role: 'work', agentId: 'sequencer-runner' } },
      { pane_id: 'wY:p1', terminal_id: 'y1', workspace_id: 'wY' },
    ];
    const restoredWorkspaces = [
      { workspace_id: 'wX', label: 'PAN-3950' },
      { workspace_id: 'wD', label: 'sequencer-runner' },
      { workspace_id: 'w13', label: 'sequencer-runner', tokens: { issue: 'sequencer-runner' } },
      { workspace_id: 'wY', label: 'PAN-3951' },
    ];

    function restoredApi(log: HerdrCall[], panes: unknown[] = restoredPanes) {
      return {
        call: async (method: string, params: Record<string, unknown>) => {
          log.push({ method, params });
          if (method === 'agent.list') return { agents: [] };
          if (method === 'session.snapshot') return { snapshot: { panes } };
          if (method === 'workspace.list') return { workspaces: restoredWorkspaces };
          return {};
        },
      };
    }
    const closes = (log: HerdrCall[], method: string, key: string) =>
      log.filter((call) => call.method === method).map((call) => call.params[key]);

    it('closes the issue workspace found by its label, untagged panes and all', async () => {
      const log: HerdrCall[] = [];
      const closed = await closeIssuePanes('pan-3950', {}, new HerdrBackend(restoredApi(log) as never));

      expect(closes(log, 'workspace.close', 'workspace_id')).toEqual(['wX']);
      expect(closes(log, 'pane.close', 'pane_id')).toEqual([]);
      expect(closed).toEqual(['wX:p1', 'wX:p2']);
    });

    it('closes the restored workspace and its duplicate alike', async () => {
      const log: HerdrCall[] = [];
      const closed = await closeIssuePanes('sequencer-runner', {}, new HerdrBackend(restoredApi(log) as never));

      expect(closes(log, 'workspace.close', 'workspace_id')).toEqual(['w13', 'wD']);
      expect(closed).toEqual(['sequencer-runner', 'wD:p1']);
    });

    it('leaves untagged panes alone under a role filter: nothing says what role they had', async () => {
      const log: HerdrCall[] = [];
      const closed = await closeIssuePanes('PAN-3950', { roles: ['review', 'test', 'uat'] }, new HerdrBackend(restoredApi(log) as never));

      expect(closed).toEqual([]);
      expect(log.some((call) => call.method === 'workspace.close' || call.method === 'pane.close')).toBe(false);
    });

    it('never closes a workspace whole when a pane in it names another owner', async () => {
      const log: HerdrCall[] = [];
      const panes = [
        ...restoredPanes,
        { pane_id: 'wX:p3', terminal_id: 'x3', workspace_id: 'wX', tokens: { role: 'work', agentId: 'conv-7' } },
        { pane_id: 'wX:p4', terminal_id: 'x4', workspace_id: 'wX', tokens: { issue: 'PAN-9999', role: 'work', agentId: 'agent-pan-9999' } },
      ];
      const closed = await closeIssuePanes('PAN-3950', {}, new HerdrBackend(restoredApi(log, panes) as never));

      expect(closes(log, 'workspace.close', 'workspace_id')).toEqual([]);
      expect(closes(log, 'pane.close', 'pane_id')).toEqual(['wX:p1', 'wX:p2']);
      expect(closed).toEqual(['wX:p1', 'wX:p2']);
    });
  });

  it('is a no-op on tmux, whose callers scan session names themselves', async () => {
    expect(await closeIssuePanes('PAN-3947', {}, tmuxBackend)).toEqual([]);
    expect(tmux.killed).toEqual([]);
  });
});

describe('stopAgent reaps the Prime Agent daemon (PAN-3668 WI-16, D3)', () => {
  function saveState(harness: 'prime-agent' | 'claude-code'): void {
    saveAgentStateSync({
      id: AGENT,
      issueId: 'PAN-3947',
      workspace: '/tmp/workspaces/feature-pan-3947',
      harness,
      role: 'work',
      model: 'gpt-5.4',
      status: 'running',
      startedAt: '2026-09-25T00:00:00.000Z',
    });
  }

  beforeEach(() => {
    reapPrimeAgentDaemon.mockClear();
  });

  it('reaps exactly once, after the backend close, for a Prime Agent', async () => {
    backendSelection.name = 'herdr';
    herdrWithDetectedAgent();
    saveState('prime-agent');
    let closesAtReap = -1;
    reapPrimeAgentDaemon.mockImplementationOnce(async () => {
      closesAtReap = herdrPaneCloses().length;
      return 'terminated';
    });

    await Effect.runPromise(stopAgent(AGENT, 'operator'));

    expect(reapPrimeAgentDaemon).toHaveBeenCalledTimes(1);
    expect(reapPrimeAgentDaemon).toHaveBeenCalledWith(AGENT);
    expect(closesAtReap).toBe(1);
  });

  it('never reaps for a claude-code agent', async () => {
    backendSelection.name = 'herdr';
    herdrWithDetectedAgent();
    saveState('claude-code');

    await Effect.runPromise(stopAgent(AGENT, 'operator'));

    expect(reapPrimeAgentDaemon).not.toHaveBeenCalled();
  });

  it('still completes the stop when the reap fails', async () => {
    backendSelection.name = 'herdr';
    herdrWithDetectedAgent();
    saveState('prime-agent');
    reapPrimeAgentDaemon.mockRejectedValueOnce(new Error('status --json failed'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(Effect.runPromise(stopAgent(AGENT, 'operator'))).resolves.toEqual({ outcome: 'closed' });
  });
});
