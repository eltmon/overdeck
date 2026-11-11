import { describe, expect, it, vi } from 'vitest';
import { createHerdrCompanionHost } from '../herdr-host.js';
import { createCompanionTerminalLifecycle, type CompanionOwner, type CompanionTerminalAdapter } from '../lifecycle.js';
import { listHerdrAgents } from '../../../terminal-backends/herdr.js';
import type { HerdrApiClient } from '../../../terminal-backends/herdr-api.js';
import type { HerdrLivenessProbe } from '../../../terminal-backends/herdr.js';

interface FakePane {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tokens: Record<string, string>;
  text?: string;
}

function createFakeHerdrApi() {
  const panes: FakePane[] = [];
  let nextId = 1;
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    switch (method) {
      case 'tab.create': {
        const id = nextId++;
        const pane: FakePane = {
          pane_id: `w2:p${id}`,
          terminal_id: `t-${id}`,
          workspace_id: String(params.workspace_id),
          tokens: {},
        };
        panes.push(pane);
        return { root_pane: { pane_id: pane.pane_id, terminal_id: pane.terminal_id, workspace_id: pane.workspace_id } };
      }
      case 'pane.layout':
        return { layout: { panes: [{ pane_id: params.pane_id, rect: { width: 80, height: 24 } }] } };
      case 'pane.report_metadata': {
        const pane = panes.find((p) => p.pane_id === params.pane_id);
        if (pane) pane.tokens = { ...(params.tokens as Record<string, string>) };
        return {};
      }
      case 'pane.send_input': {
        const pane = panes.find((p) => p.pane_id === params.pane_id);
        if (pane) pane.text = String(params.text);
        return {};
      }
      case 'pane.close': {
        const index = panes.findIndex((p) => p.pane_id === params.pane_id);
        if (index >= 0) panes.splice(index, 1);
        return {};
      }
      case 'pane.process_info': {
        const pane = panes.find((p) => p.pane_id === params.pane_id);
        if (!pane) throw new Error('pane not found');
        return { process_info: { shell_pid: 100, foreground_processes: [{ pid: 200 }] } };
      }
      case 'session.snapshot':
        return { snapshot: { panes: panes.map((p) => ({ pane_id: p.pane_id, terminal_id: p.terminal_id, tokens: p.tokens })) } };
      case 'agent.list':
        return { agents: [] };
      default:
        throw new Error(`unexpected herdr method ${method}`);
    }
  });
  return { api: { call } as unknown as HerdrApiClient, panes };
}

const owner: CompanionOwner = {
  conversationName: '20261106-1898',
  ownerSession: 'conv-20261106-1898',
  cwd: '/w',
  harness: 'codex',
};

function codexAdapter(): CompanionTerminalAdapter {
  return {
    kind: 'codex-resume-remote',
    resolveTarget: async () => ({
      ok: true,
      argv: ['/bin/codex', 'resume', '--remote', 'unix:///s/app.sock', 'thread-1'],
      cwd: '/w',
      fingerprint: 'fp-1',
    }),
  };
}

const alive: HerdrLivenessProbe = { kind: 'alive', paneId: 'w1:p3', state: 'idle' };
const exited: HerdrLivenessProbe = { kind: 'exited', paneId: 'w1:p3' };
const indeterminate: HerdrLivenessProbe = { kind: 'indeterminate', reason: 'timeout' };

function lifecycleWith(api: HerdrApiClient, probe: HerdrLivenessProbe, tmuxOwnerStamp = vi.fn(async () => {
  throw new Error('tmux must not be called');
})) {
  const host = createHerdrCompanionHost({
    api,
    probeOwner: async () => probe,
    tmuxOwnerStamp,
    ensureWorkspace: async () => 'w2',
    sizeTerminal: async () => 'sized',
  });
  return createCompanionTerminalLifecycle({ host, adapters: { 'codex-resume-remote': codexAdapter() } });
}

describe('companion terminal lifecycle on a simulated Herdr host with no tmux', () => {
  it('opens a Codex companion on Herdr with no tmux session', async () => {
    const fake = createFakeHerdrApi();
    const tmuxOwnerStamp = vi.fn(async () => {
      throw new Error('tmux must not be called');
    });
    const result = await lifecycleWith(fake.api, alive, tmuxOwnerStamp).open(owner);

    expect(result).toMatchObject({ status: 'attached', sessionName: 'companion-conv-20261106-1898', reused: false });
    expect(tmuxOwnerStamp).not.toHaveBeenCalled();
  });

  it('reuses the companion on a second open', async () => {
    const fake = createFakeHerdrApi();

    const first = await lifecycleWith(fake.api, alive).open(owner);
    expect(first).toMatchObject({ status: 'attached', reused: false });

    const second = await lifecycleWith(fake.api, alive).open(owner);
    expect(second).toMatchObject({ status: 'attached', reused: true });

    const tabCreateCalls = fake.api.call.mock.calls.filter(([method]) => method === 'tab.create');
    expect(tabCreateCalls).toHaveLength(1);
  });

  it('answers owner-not-running and reaps the companion when the owner exited', async () => {
    const fake = createFakeHerdrApi();
    await lifecycleWith(fake.api, alive).open(owner);
    expect(fake.panes).toHaveLength(1);

    const result = await lifecycleWith(fake.api, exited).open(owner);

    expect(result).toMatchObject({ status: 'unavailable', reason: 'owner-not-running' });
    expect(fake.panes).toHaveLength(0);
  });

  it('rejects without reaping when Herdr does not answer', async () => {
    const fake = createFakeHerdrApi();
    await lifecycleWith(fake.api, alive).open(owner);
    expect(fake.panes).toHaveLength(1);

    await expect(lifecycleWith(fake.api, indeterminate).open(owner)).rejects.toThrow();
    expect(fake.panes).toHaveLength(1);
  });

  it('keeps the companion out of the agent inventory', async () => {
    const fake = createFakeHerdrApi();
    await lifecycleWith(fake.api, alive).open(owner);

    const agents = await listHerdrAgents(fake.api);
    expect(agents.some((agent) => agent.agentId.startsWith('companion-'))).toBe(false);
  });
});
