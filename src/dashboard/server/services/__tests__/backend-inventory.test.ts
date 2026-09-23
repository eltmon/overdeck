import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendAgentSnapshot } from '@overdeck/contracts';

import {
  BackendPaneCache,
  TMUX_IDLE_THRESHOLD_MS,
  _resetBackendInventoryForTests,
  getBackendPanes,
  getBackendPanesForIssue,
  listBackendPanes,
  parseAgentSessionName,
  type TmuxPaneProbe,
} from '../backend-inventory.js';
import { unsupported, type TerminalBackend } from '../../../../lib/terminal-backends/types.js';

const NOW = 1_800_000_000_000;

// ─── Herdr fixture: `agent.list` + `session.snapshot` as the adapter maps it ──

const HERDR_SNAPSHOT: readonly BackendAgentSnapshot[] = [
  {
    backend: 'herdr',
    paneId: 'w1:p1',
    terminalId: 'term-w1p1',
    workspaceId: 'w1',
    state: 'working',
    tokens: { issue: 'PAN-3917', role: 'work', harness: 'claude-code', model: 'claude-opus-5' },
    cwd: '/home/op/Projects/overdeck/workspaces/feature-pan-3917',
    title: 'PAN-3917 work',
  },
  {
    backend: 'herdr',
    paneId: 'w1:p2',
    terminalId: 'term-w1p2',
    workspaceId: 'w1',
    state: 'blocked',
    tokens: { issue: 'PAN-3917', role: 'review', harness: 'codex', model: 'gpt-5.5' },
  },
  {
    backend: 'herdr',
    paneId: 'w9:p1',
    terminalId: 'term-w9p1',
    workspaceId: 'w9',
    state: 'idle',
    // An operator conversation carries no `issue` token (FR-5).
    tokens: { role: 'work', harness: 'claude-code', model: 'claude-opus-5' },
  },
];

function herdrBackend(snapshot = HERDR_SNAPSHOT): TerminalBackend {
  return {
    name: 'herdr',
    list: () => Effect.succeed(snapshot),
  } as unknown as TerminalBackend;
}

// ─── tmux fixture: the managed server's sessions and their first panes ───────

const TMUX_PROBES: readonly TmuxPaneProbe[] = [
  { session: 'agent-pan-3917', dead: false, activityMs: NOW - 1_000, cwd: '/w/feature-pan-3917' },
  { session: 'agent-pan-3917-review', dead: false, activityMs: NOW - TMUX_IDLE_THRESHOLD_MS - 1 },
  { session: 'agent-pan-3917-slot-2', dead: false, activityMs: NOW },
  { session: 'strike-pan-3844', dead: false, activityMs: NOW },
  { session: 'planning-pan-4000', dead: false, activityMs: NOW },
  { session: 'agent-min-1039-test', dead: true, activityMs: NOW - 10_000 },
  { session: 'conv-flywheel', dead: false, activityMs: NOW },
  { session: 'not-an-agent', dead: false, activityMs: NOW },
];

beforeEach(() => {
  _resetBackendInventoryForTests();
});

describe('parseAgentSessionName', () => {
  it('reads issue and role out of the managed session name', () => {
    expect(parseAgentSessionName('agent-pan-3917')).toEqual({ issue: 'PAN-3917', role: 'work' });
    expect(parseAgentSessionName('agent-pan-3917-review')).toEqual({ issue: 'PAN-3917', role: 'review' });
    expect(parseAgentSessionName('agent-pan-3917-test')).toEqual({ issue: 'PAN-3917', role: 'test' });
    expect(parseAgentSessionName('agent-pan-3917-uat')).toEqual({ issue: 'PAN-3917', role: 'uat' });
    expect(parseAgentSessionName('agent-pan-3917-slot-2')).toEqual({ issue: 'PAN-3917', role: 'worker' });
    expect(parseAgentSessionName('strike-pan-3844')).toEqual({ issue: 'PAN-3844', role: 'strike' });
    expect(parseAgentSessionName('planning-pan-4000')).toEqual({ issue: 'PAN-4000', role: 'plan' });
  });

  it('is null for an operator conversation and for anything that is not an agent session', () => {
    expect(parseAgentSessionName('conv-flywheel')).toBeNull();
    expect(parseAgentSessionName('not-an-agent')).toBeNull();
  });
});

describe('listBackendPanes — Herdr fixture', () => {
  it('folds agent snapshots into BackendPane rows, tokens and all', async () => {
    const panes = await listBackendPanes({ backend: herdrBackend(), now: () => NOW });
    expect(panes).toHaveLength(3);
    expect(panes[0]).toEqual({
      id: 'w1:p1',
      issue: 'PAN-3917',
      role: 'work',
      harness: 'claude-code',
      model: 'claude-opus-5',
      state: 'working',
      stateSince: NOW,
      terminalId: 'term-w1p1',
      workspace: '/home/op/Projects/overdeck/workspaces/feature-pan-3917',
    });
  });

  it('leaves the operator conversation without an issue token', () => {
    expect(HERDR_SNAPSHOT[2]?.tokens.issue).toBeUndefined();
  });

  it('carries the snapshot agentId onto the pane', async () => {
    // PAN-3920 W1: on Herdr the pane id is `w1:p1`, so joins to agents use agentId.
    const [first, second] = HERDR_SNAPSHOT;
    const panes = await listBackendPanes({
      backend: herdrBackend([{ ...first!, agentId: 'agent-pan-3917' }, second!]),
      now: () => NOW,
    });
    expect(panes[0]?.agentId).toBe('agent-pan-3917');
    expect(panes[1]).not.toHaveProperty('agentId');
  });

  // PAN-3956 D8: a Herdr host never reads tmux as a fallback inventory.
  it('serves the last-known panes and never reads tmux when the herdr adapter reports unsupported', async () => {
    const previous = new BackendPaneCache(await listBackendPanes({ backend: herdrBackend(), now: () => NOW }));
    const backend = { name: 'herdr', list: () => Effect.succeed(unsupported('no session')) } as unknown as TerminalBackend;
    const listTmuxPanes = vi.fn(async () => TMUX_PROBES);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const panes = await listBackendPanes({ backend, now: () => NOW, listTmuxPanes }, previous);
      expect(panes).toEqual(previous.list());
      expect(listTmuxPanes).not.toHaveBeenCalled();
      // One warning per failure streak, not per poll.
      await listBackendPanes({ backend, now: () => NOW, listTmuxPanes }, previous);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('no session');
    } finally {
      warn.mockRestore();
    }
  });

  it('serves the last-known panes when the herdr list() fails outright', async () => {
    const previous = new BackendPaneCache(await listBackendPanes({ backend: herdrBackend(), now: () => NOW }));
    const backend = {
      name: 'herdr',
      list: () => Effect.fail(new Error('socket refused')),
    } as unknown as TerminalBackend;
    const listTmuxPanes = vi.fn(async () => TMUX_PROBES);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const panes = await listBackendPanes({ backend, now: () => NOW, listTmuxPanes }, previous);
      expect(panes.map((pane) => pane.id)).toEqual(['w1:p1', 'w1:p2', 'w9:p1']);
      expect(listTmuxPanes).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns [] with no cache when the herdr adapter cannot answer', async () => {
    const backend = { name: 'herdr', list: () => Effect.succeed(unsupported('no session')) } as unknown as TerminalBackend;
    const listTmuxPanes = vi.fn(async () => TMUX_PROBES);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(listBackendPanes({ backend, now: () => NOW, listTmuxPanes })).resolves.toEqual([]);
      expect(listTmuxPanes).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('reads tmux when the adapter is tmux', async () => {
    const backend = { name: 'tmux', list: () => Effect.succeed(unsupported('tmux')) } as unknown as TerminalBackend;
    const panes = await listBackendPanes({
      backend,
      now: () => NOW,
      listTmuxPanes: async () => TMUX_PROBES,
    });
    expect(panes.map((pane) => pane.id)).toContain('agent-pan-3917');
  });
});

describe('listBackendPanes — tmux fixture', () => {
  it('maps agent sessions and skips conversations and non-agent sessions', async () => {
    const panes = await listBackendPanes({
      backend: null,
      now: () => NOW,
      listTmuxPanes: async () => TMUX_PROBES,
    });
    expect(panes.map((pane) => pane.id)).toEqual([
      'agent-pan-3917',
      'agent-pan-3917-review',
      'agent-pan-3917-slot-2',
      'strike-pan-3844',
      'planning-pan-4000',
      'agent-min-1039-test',
    ]);
  });

  it('derives working, idle, and exited from pane liveness and activity', async () => {
    const panes = await listBackendPanes({
      backend: null,
      now: () => NOW,
      listTmuxPanes: async () => TMUX_PROBES,
    });
    const byId = new Map(panes.map((pane) => [pane.id, pane]));
    expect(byId.get('agent-pan-3917')?.state).toBe('working');
    expect(byId.get('agent-pan-3917-review')?.state).toBe('idle');
    expect(byId.get('agent-min-1039-test')?.state).toBe('exited');
  });

  it('reports harness and model as unknown — the tmux adapter has no metadata tokens', async () => {
    const [first] = await listBackendPanes({
      backend: null,
      now: () => NOW,
      listTmuxPanes: async () => TMUX_PROBES,
    });
    expect(first?.harness).toBe('unknown');
    expect(first?.model).toBe('unknown');
  });

  it('uses the session name as the agent id', async () => {
    const [first] = await listBackendPanes({
      backend: null,
      now: () => NOW,
      listTmuxPanes: async () => TMUX_PROBES,
    });
    expect(first?.agentId).toBe('agent-pan-3917');
  });
});

describe('BackendPaneCache — events folded onto the snapshot', () => {
  it('moves a pane to a new state and stamps stateSince', () => {
    const cache = new BackendPaneCache([
      { id: 'w1:p1', issue: 'PAN-3917', role: 'work', harness: 'claude-code', model: 'm', state: 'working', stateSince: NOW },
    ]);
    cache.apply({ kind: 'agent-state', paneId: 'w1:p1', state: 'blocked' }, NOW + 5_000);
    expect(cache.get('w1:p1')).toMatchObject({ state: 'blocked', stateSince: NOW + 5_000 });
  });

  it('marks a pane exited and keeps it in the inventory', () => {
    const cache = new BackendPaneCache([
      { id: 'w1:p1', role: 'work', harness: 'h', model: 'm', state: 'working', stateSince: NOW },
    ]);
    cache.apply({ kind: 'pane-exited', paneId: 'w1:p1', code: 0 }, NOW + 1);
    expect(cache.get('w1:p1')?.state).toBe('exited');
  });

  it('applies metadata tokens to a pane created before its tokens were stamped', () => {
    const cache = new BackendPaneCache();
    cache.apply({ kind: 'pane-created', paneId: 'w2:p1', workspaceId: 'w2' }, NOW);
    cache.apply({
      kind: 'metadata',
      paneId: 'w2:p1',
      tokens: { issue: 'PAN-4000', role: 'review', harness: 'codex', model: 'gpt-5.5' },
    }, NOW);
    expect(cache.get('w2:p1')).toMatchObject({ issue: 'PAN-4000', role: 'review', harness: 'codex', model: 'gpt-5.5' });
  });

  it('answers by issue', () => {
    const cache = new BackendPaneCache([
      { id: 'a', issue: 'PAN-1', role: 'work', harness: 'h', model: 'm', state: 'working' },
      { id: 'b', issue: 'PAN-2', role: 'work', harness: 'h', model: 'm', state: 'working' },
    ]);
    expect(cache.forIssue('pan-1').map((pane) => pane.id)).toEqual(['a']);
  });
});

describe('getBackendPanes — the read door', () => {
  it('serves one snapshot to concurrent callers and filters by issue', async () => {
    let reads = 0;
    const deps = {
      backend: null,
      now: () => NOW,
      listTmuxPanes: async () => { reads += 1; return TMUX_PROBES; },
    };
    const [all, forIssue] = await Promise.all([
      getBackendPanes(deps),
      getBackendPanesForIssue('PAN-3917', deps),
    ]);
    expect(reads).toBe(1);
    expect(all.length).toBeGreaterThan(0);
    expect(forIssue.map((pane) => pane.id)).toEqual([
      'agent-pan-3917',
      'agent-pan-3917-review',
      'agent-pan-3917-slot-2',
    ]);
  });
});

describe('getBackendPanes — stateSince survives a refresh', () => {
  it('keeps the timestamp a pane entered its state, so `stuck` can be reached', async () => {
    let clock = NOW;
    const deps = { backend: herdrBackend(), now: () => clock };
    const [first] = await getBackendPanes(deps);
    expect(first?.stateSince).toBe(NOW);

    clock = NOW + 6_000; // past INVENTORY_TTL_MS, so the snapshot is re-read
    const [second] = await getBackendPanes(deps);
    expect(second?.stateSince).toBe(NOW);
  });

  it('stamps a new timestamp when the pane changed state', async () => {
    let clock = NOW;
    let snapshot = HERDR_SNAPSHOT;
    const deps = { backend: { name: 'herdr', list: () => Effect.succeed(snapshot) } as unknown as TerminalBackend, now: () => clock };
    await getBackendPanes(deps);

    clock = NOW + 6_000;
    snapshot = [{ ...HERDR_SNAPSHOT[0]!, state: 'idle' }, ...HERDR_SNAPSHOT.slice(1)];
    const [second] = await getBackendPanes(deps);
    expect(second?.state).toBe('idle');
    expect(second?.stateSince).toBe(NOW + 6_000);
  });
});
