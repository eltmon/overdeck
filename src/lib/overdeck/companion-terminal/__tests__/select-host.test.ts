import { describe, expect, it, vi } from 'vitest';
import { createBackendCompanionHost, type BackendCompanionHostDeps } from '../select-host.js';
import type { CompanionTerminalHost } from '../host.js';

function fakeHost(label: string): CompanionTerminalHost {
  return {
    ownerStamp: vi.fn(async () => label),
    readGeneration: vi.fn(async () => label),
    create: vi.fn(async () => undefined),
    kill: vi.fn(async () => true),
  };
}

describe('backend companion host', () => {
  it('forwards every operation to the tmux host when the backend is tmux and never loads the Herdr host', async () => {
    const tmuxHost = fakeHost('tmux');
    const herdr = vi.fn(async (): Promise<CompanionTerminalHost> => {
      throw new Error('must not load the Herdr host');
    });
    const host = createBackendCompanionHost({
      backendName: async () => 'tmux',
      tmux: () => tmuxHost,
      herdr,
    } satisfies Partial<BackendCompanionHostDeps>);

    expect(await host.ownerStamp('conv-a')).toBe('tmux');
    expect(await host.readGeneration('companion-a')).toBe('tmux');
    await host.create('companion-a', { cwd: '/w', argv: ['x'], generation: 'g' });
    expect(await host.kill('companion-a')).toBe(true);

    expect(tmuxHost.ownerStamp).toHaveBeenCalledWith('conv-a');
    expect(tmuxHost.readGeneration).toHaveBeenCalledWith('companion-a');
    expect(tmuxHost.create).toHaveBeenCalledWith('companion-a', { cwd: '/w', argv: ['x'], generation: 'g' });
    expect(tmuxHost.kill).toHaveBeenCalledWith('companion-a');
    expect(herdr).not.toHaveBeenCalled();
  });

  it('forwards every operation to the Herdr host when the backend is herdr', async () => {
    const herdrHost = fakeHost('herdr');
    const tmux = vi.fn((): CompanionTerminalHost => {
      throw new Error('must not use the tmux host');
    });
    const host = createBackendCompanionHost({
      backendName: async () => 'herdr',
      tmux,
      herdr: async () => herdrHost,
    } satisfies Partial<BackendCompanionHostDeps>);

    expect(await host.ownerStamp('conv-b')).toBe('herdr');
    expect(await host.readGeneration('companion-b')).toBe('herdr');
    await host.create('companion-b', { cwd: '/w', argv: ['y'], generation: 'g2' });
    expect(await host.kill('companion-b')).toBe(true);

    expect(herdrHost.ownerStamp).toHaveBeenCalledWith('conv-b');
    expect(herdrHost.readGeneration).toHaveBeenCalledWith('companion-b');
    expect(herdrHost.create).toHaveBeenCalledWith('companion-b', { cwd: '/w', argv: ['y'], generation: 'g2' });
    expect(herdrHost.kill).toHaveBeenCalledWith('companion-b');
    expect(tmux).not.toHaveBeenCalled();
  });

  it('asks the backend on each call', async () => {
    const backendName = vi.fn(async () => 'tmux' as const);
    const tmuxHost = fakeHost('tmux');
    const host = createBackendCompanionHost({
      backendName,
      tmux: () => tmuxHost,
      herdr: async () => fakeHost('herdr'),
    } satisfies Partial<BackendCompanionHostDeps>);

    await host.ownerStamp('conv-c');
    await host.readGeneration('companion-c');
    await host.create('companion-c', { cwd: '/w', argv: ['z'], generation: 'g3' });
    await host.kill('companion-c');

    expect(backendName).toHaveBeenCalledTimes(4);
  });
});
