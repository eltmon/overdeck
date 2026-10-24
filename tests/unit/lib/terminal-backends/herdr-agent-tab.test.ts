import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

import { openAgentTab } from '../../../../src/lib/terminal-backends/herdr-agent-tab.js';
import { HerdrBackend } from '../../../../src/lib/terminal-backends/herdr.js';
import type { HerdrApiClient } from '../../../../src/lib/terminal-backends/herdr-api.js';
import type { StartAgentSpec, WorkspaceRef } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-4582 W3. `openAgentTab` is the only thing `HerdrBackend.startAgent` uses
 * to place an agent now — never `pane.split`, which halves the shared tab's
 * remaining rows on every launch.
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
    },
  };
}

const noopSizeTerminal = async () => 'sized' as const;

describe('openAgentTab', () => {
  it('sends tab.create with the workspace, cwd, env and label, and returns the root pane', async () => {
    const { api, log } = fakeApi(({ method }) => (method === 'tab.create'
      ? { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1' } }
      : {}));

    const pane = await openAgentTab(api as unknown as HerdrApiClient, {
      workspaceId: 'w1',
      cwd: '/w/feature-pan-1',
      env: { OVERDECK_AGENT_ID: 'agent-pan-1' },
      label: 'agent-pan-1',
    }, noopSizeTerminal);

    expect(pane).toEqual({ pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1' });
    expect(log[0]).toEqual({
      method: 'tab.create',
      params: {
        workspace_id: 'w1',
        cwd: '/w/feature-pan-1',
        env: { OVERDECK_AGENT_ID: 'agent-pan-1' },
        label: 'agent-pan-1',
        focus: false,
      },
    });
  });

  it('rejects when the response carries no root pane', async () => {
    const { api } = fakeApi(() => ({ type: 'tab_created' }));

    await expect(openAgentTab(api as unknown as HerdrApiClient, {
      workspaceId: 'w1',
      cwd: '/w',
      env: {},
      label: 'agent-pan-1',
    }, noopSizeTerminal)).rejects.toThrow('tab.create returned no root pane');
  });
});

describe('openAgentTab PTY sizing', () => {
  const request = { workspaceId: 'w1', cwd: '/w', env: {}, label: 'agent-pan-1' };
  const rootPane = { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1' };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sizes the PTY to the layout rect before returning, after tab.create', async () => {
    const sizes: Array<[string, number, number]> = [];
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'tab.create') return { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: rootPane };
      if (method === 'pane.layout') return { layout: { panes: [{ pane_id: 'w1:p2', rect: { width: 120, height: 40 } }] } };
      return {};
    });
    const sizeTerminal = async (terminalId: string, cols: number, rows: number) => {
      sizes.push([terminalId, cols, rows]);
      return 'sized' as const;
    };

    const pane = await openAgentTab(api as unknown as HerdrApiClient, request, sizeTerminal);

    expect(pane).toEqual(rootPane);
    expect(sizes).toEqual([['t2', 120, 40]]);
    expect(log.map((call) => call.method)).toEqual(['tab.create', 'pane.layout']);
  });

  it('skips sizing when pane.layout throws', async () => {
    let called = false;
    const { api } = fakeApi(({ method }) => {
      if (method === 'tab.create') return { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: rootPane };
      if (method === 'pane.layout') return new Error('layout unavailable');
      return {};
    });
    const sizeTerminal = async () => { called = true; return 'sized' as const; };

    const pane = await openAgentTab(api as unknown as HerdrApiClient, request, sizeTerminal);

    expect(pane).toEqual(rootPane);
    expect(called).toBe(false);
  });

  it('skips sizing when the layout response has no matching pane entry', async () => {
    let called = false;
    const { api } = fakeApi(({ method }) => {
      if (method === 'tab.create') return { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: rootPane };
      if (method === 'pane.layout') return { layout: { panes: [] } };
      return {};
    });
    const sizeTerminal = async () => { called = true; return 'sized' as const; };

    const pane = await openAgentTab(api as unknown as HerdrApiClient, request, sizeTerminal);

    expect(pane).toEqual(rootPane);
    expect(called).toBe(false);
  });

  it('skips sizing when the rect is too small to use', async () => {
    let called = false;
    const { api } = fakeApi(({ method }) => {
      if (method === 'tab.create') return { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: rootPane };
      if (method === 'pane.layout') return { layout: { panes: [{ pane_id: 'w1:p2', rect: { width: 120, height: 1 } }] } };
      return {};
    });
    const sizeTerminal = async () => { called = true; return 'sized' as const; };

    const pane = await openAgentTab(api as unknown as HerdrApiClient, request, sizeTerminal);

    expect(pane).toEqual(rootPane);
    expect(called).toBe(false);
  });

  it('still returns the pane when sizeTerminal resolves refused', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'tab.create') return { type: 'tab_created', tab: { tab_id: 'w1:t2' }, root_pane: rootPane };
      if (method === 'pane.layout') return { layout: { panes: [{ pane_id: 'w1:p2', rect: { width: 120, height: 40 } }] } };
      return {};
    });
    const sizeTerminal = async () => 'refused' as const;

    const pane = await openAgentTab(api as unknown as HerdrApiClient, request, sizeTerminal);

    expect(pane).toEqual(rootPane);
  });
});

describe('HerdrBackend.startAgent opens a tab', () => {
  const workspace: WorkspaceRef = { backend: 'herdr', workspaceId: 'w1', issueId: 'PAN-1', cwd: '/w/feature-pan-1' };

  const specs: Record<'claude-code' | 'codex', StartAgentSpec> = {
    'claude-code': {
      kind: 'claude-code',
      argv: ['bash', 'launcher.sh'],
      env: {},
      tokens: { issue: 'PAN-1', role: 'work', harness: 'claude-code', model: 'claude-opus-5' },
      name: 'agent-pan-1',
      detection: 'required',
    },
    codex: {
      kind: 'codex',
      argv: ['bash', 'launcher.sh'],
      env: {},
      tokens: { issue: 'PAN-1', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' },
      name: 'agent-pan-1-review',
      detection: 'not-required',
    },
  };

  for (const [harness, spec] of Object.entries(specs) as Array<[string, StartAgentSpec]>) {
    it(`never calls pane.split for a ${harness} launch`, async () => {
      const { api, log } = fakeApi(({ method }) => {
        if (method === 'tab.create') {
          return {
            type: 'tab_created',
            tab: { tab_id: 'w1:t2' },
            root_pane: { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1' },
          };
        }
        if (method === 'pane.get') return { pane: { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', agent: harness } };
        return {};
      });

      await Effect.runPromise(new HerdrBackend(api as never).startAgent(workspace, spec));

      const methods = log.map((call) => call.method);
      expect(methods).toContain('tab.create');
      expect(methods).not.toContain('pane.split');
      expect(log.find((call) => call.method === 'tab.create')?.params).toMatchObject({ label: spec.name });
    });
  }
});
