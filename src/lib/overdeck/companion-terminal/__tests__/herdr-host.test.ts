import { describe, expect, it, vi } from 'vitest';
import {
  COMPANION_GENERATION_TOKEN,
  COMPANION_NAME_TOKEN,
  createHerdrCompanionHost,
  findHerdrCompanionTerminalId,
} from '../herdr-host.js';
import type { HerdrApiClient } from '../../../terminal-backends/herdr-api.js';
import type { HerdrLivenessProbe } from '../../../terminal-backends/herdr.js';

interface RecordedCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function fakeApi(calls: RecordedCall[], overrides: Partial<Record<string, (params: Record<string, unknown>) => unknown>> = {}) {
  const call = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    const handler = overrides[method];
    if (handler) return handler(params);
    switch (method) {
      case 'tab.create':
        return { root_pane: { pane_id: 'w2:p9', terminal_id: 't-9', workspace_id: 'w2' } };
      case 'pane.layout':
        return { layout: { panes: [{ pane_id: params.pane_id, rect: { width: 80, height: 24 } }] } };
      case 'pane.report_metadata':
      case 'pane.send_input':
      case 'pane.close':
        return {};
      case 'session.snapshot':
        return { snapshot: { panes: [] } };
      default:
        throw new Error(`unexpected herdr method ${method}`);
    }
  });
  return { call } as unknown as HerdrApiClient;
}

function createHostForCreate(calls: RecordedCall[], overrides: Partial<Record<string, (params: Record<string, unknown>) => unknown>> = {}) {
  return createHerdrCompanionHost({
    api: fakeApi(calls, overrides),
    ensureWorkspace: vi.fn(async () => 'w2'),
    sizeTerminal: vi.fn(async () => 'sized'),
  });
}

describe('herdr companion host', () => {
  it('ownerStamp returns herdr:<paneId> for a live Herdr owner and never asks tmux', async () => {
    const tmuxOwnerStamp = vi.fn(async () => {
      throw new Error('must not be called');
    });
    const host = createHerdrCompanionHost({
      probeOwner: async () => ({ kind: 'alive', paneId: 'w1:p3', state: 'idle' } as HerdrLivenessProbe),
      tmuxOwnerStamp,
    });

    expect(await host.ownerStamp('conv-x')).toBe('herdr:w1:p3');
    expect(tmuxOwnerStamp).not.toHaveBeenCalled();
  });

  it('ownerStamp returns null for an exited owner', async () => {
    const host = createHerdrCompanionHost({
      probeOwner: async () => ({ kind: 'exited', paneId: 'w1:p3' } as HerdrLivenessProbe),
    });

    expect(await host.ownerStamp('conv-x')).toBeNull();
  });

  it('ownerStamp falls back to the tmux stamp when Herdr has no such pane', async () => {
    const tmuxOwnerStamp = vi.fn(async () => '1790000000');
    const host = createHerdrCompanionHost({
      probeOwner: async () => ({ kind: 'absent' } as HerdrLivenessProbe),
      tmuxOwnerStamp,
    });

    expect(await host.ownerStamp('conv-x')).toBe('1790000000');
    expect(tmuxOwnerStamp).toHaveBeenCalledWith('conv-x');
  });

  it('ownerStamp rejects when Herdr does not answer', async () => {
    const host = createHerdrCompanionHost({
      probeOwner: async () => ({ kind: 'indeterminate', reason: 'timeout' } as HerdrLivenessProbe),
    });

    await expect(host.ownerStamp('conv-x')).rejects.toThrow(/Herdr did not answer for conv-x: timeout/);
  });

  it('create stamps only the companion tokens and types the argv followed by exit', async () => {
    const calls: RecordedCall[] = [];
    const host = createHostForCreate(calls);

    await host.create('companion-conv-x', {
      cwd: '/w',
      argv: ['/bin/codex', 'resume', '--remote', 'unix:///s/app.sock', 'thread-1'],
      generation: 'g1',
    });

    const metadata = calls.find((c) => c.method === 'pane.report_metadata');
    expect(metadata?.params.tokens).toEqual({ [COMPANION_NAME_TOKEN]: 'companion-conv-x', [COMPANION_GENERATION_TOKEN]: 'g1' });
    expect(Object.keys(metadata?.params.tokens as object)).toHaveLength(2);

    const sendInput = calls.find((c) => c.method === 'pane.send_input');
    expect(sendInput?.params.text).toBe(`'/bin/codex' 'resume' '--remote' 'unix:///s/app.sock' 'thread-1' ; exit`);
  });

  it('create pins generation and TERM over adapter env', async () => {
    const calls: RecordedCall[] = [];
    const host = createHostForCreate(calls);

    await host.create('companion-conv-b', {
      cwd: '/w',
      argv: ['/bin/opencode', 'attach'],
      generation: 'g2',
      env: { OVERDECK_COMPANION_GENERATION: 'forged', FOO: 'bar' },
    });

    const tabCreate = calls.find((c) => c.method === 'tab.create');
    expect(tabCreate?.params.env).toEqual({ FOO: 'bar', OVERDECK_COMPANION_GENERATION: 'g2', TERM: 'xterm-256color' });
  });

  it('create closes the new pane when typing the command fails', async () => {
    const calls: RecordedCall[] = [];
    const host = createHostForCreate(calls, {
      'pane.send_input': () => {
        throw new Error('typing failed');
      },
    });

    await expect(
      host.create('companion-conv-c', { cwd: '/w', argv: ['/bin/codex'], generation: 'g3' }),
    ).rejects.toThrow('typing failed');

    const close = calls.find((c) => c.method === 'pane.close');
    expect(close?.params.pane_id).toBe('w2:p9');
  });

  it('create rejects an empty argv before calling Herdr', async () => {
    const calls: RecordedCall[] = [];
    const host = createHostForCreate(calls);

    await expect(host.create('companion-conv-d', { cwd: '/w', argv: [], generation: 'g4' })).rejects.toThrow(/argv is empty/);
    expect(calls).toHaveLength(0);
  });

  it('readGeneration: undefined when absent, null when exited or duplicated, the token when running', async () => {
    const hostWith = (panes: Array<{ pane_id: string; terminal_id: string; tokens?: Record<string, string> }>, liveness: 'running' | 'exited' = 'running') =>
      createHerdrCompanionHost({
        api: fakeApi([], { 'session.snapshot': () => ({ snapshot: { panes } }) }),
        paneLiveness: async () => liveness,
      });

    expect(await hostWith([]).readGeneration('companion-x')).toBeUndefined();

    const duplicated = [
      { pane_id: 'p1', terminal_id: 't1', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x', [COMPANION_GENERATION_TOKEN]: 'g1' } },
      { pane_id: 'p2', terminal_id: 't2', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x', [COMPANION_GENERATION_TOKEN]: 'g1' } },
    ];
    expect(await hostWith(duplicated).readGeneration('companion-x')).toBeNull();

    const single = [{ pane_id: 'p1', terminal_id: 't1', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x', [COMPANION_GENERATION_TOKEN]: 'g1' } }];
    expect(await hostWith(single, 'exited').readGeneration('companion-x')).toBeNull();

    const running = [{ pane_id: 'p1', terminal_id: 't1', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x', [COMPANION_GENERATION_TOKEN]: 'g7' } }];
    expect(await hostWith(running, 'running').readGeneration('companion-x')).toBe('g7');
  });

  it('kill closes every pane carrying the companion token and reports false when there is none', async () => {
    const calls: RecordedCall[] = [];
    const panes = [
      { pane_id: 'p1', terminal_id: 't1', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x' } },
      { pane_id: 'p2', terminal_id: 't2', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x' } },
    ];
    const host = createHerdrCompanionHost({ api: fakeApi(calls, { 'session.snapshot': () => ({ snapshot: { panes } }) }) });

    expect(await host.kill('companion-x')).toBe(true);
    const closed = calls.filter((c) => c.method === 'pane.close').map((c) => c.params.pane_id).sort();
    expect(closed).toEqual(['p1', 'p2']);

    const emptyHost = createHerdrCompanionHost({ api: fakeApi([], { 'session.snapshot': () => ({ snapshot: { panes: [] } }) }) });
    expect(await emptyHost.kill('companion-x')).toBe(false);
  });

  it("findHerdrCompanionTerminalId returns the running pane's terminal id and null on a transport error", async () => {
    const panes = [{ pane_id: 'p1', terminal_id: 't1', tokens: { [COMPANION_NAME_TOKEN]: 'companion-x' } }];
    const api = fakeApi([], {
      'session.snapshot': () => ({ snapshot: { panes } }),
      'pane.process_info': () => ({ process_info: { shell_pid: 1, foreground_processes: [{ pid: 2 }] } }),
    });
    expect(await findHerdrCompanionTerminalId('companion-x', api)).toBe('t1');

    const failingApi = fakeApi([], {
      'session.snapshot': () => {
        throw new Error('socket down');
      },
    });
    expect(await findHerdrCompanionTerminalId('companion-x', failingApi)).toBeNull();
  });
});
