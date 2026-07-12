import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

describe('teardownWorkspaceDockerByNamePromise', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  async function loadTeardown() {
    const { teardownWorkspaceDockerByNamePromise } = await import(
      '../docker.js'
    );
    return teardownWorkspaceDockerByNamePromise;
  }

  it('runs docker compose down for the named project', async () => {
    const teardown = await loadTeardown();
    await teardown('pan-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );
    expect(commands).toContain(
      'docker compose -p "overdeck-feature-pan-9999" down -v --remove-orphans',
    );
  });

  it('runs docker network rm for the named network', async () => {
    const teardown = await loadTeardown();
    await teardown('pan-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );
    expect(commands).toContain('docker network rm "overdeck-feature-pan-9999_devnet"');
  });

  it('resolves when the network is reported not found', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker network rm')) {
        throw new Error('Error response from daemon: No such network: overdeck-feature-pan-9999_devnet');
      }
      return { stdout: '', stderr: '' };
    });

    await expect(teardown('pan-9999')).resolves.not.toThrow();
  });

  it('returns networkRemoved:true when the network is absent from docker network ls', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker network ls')) {
        return {
          stdout: 'bridge\nhost\noverdeck-feature-pan-other_devnet\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardown('pan-9999');
    expect(result.networkRemoved).toBe(true);
  });

  it('returns networkRemoved:false when the network is still listed', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker network ls')) {
        return {
          stdout: 'bridge\noverdeck-feature-pan-9999_devnet\nhost\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardown('pan-9999');
    expect(result.networkRemoved).toBe(false);
  });

  it('only emits project-scoped or network-scoped docker commands and never prunes', async () => {
    const teardown = await loadTeardown();
    await teardown('pan-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );

    for (const command of commands) {
      expect(command).toMatch(
        /docker (compose -p "overdeck-feature-pan-9999"|network (rm|ls)|ps -a --filter network|ps -a --format|rm -f)/,
      );
      expect(command).not.toMatch(/docker network prune/);
      expect(command).not.toMatch(/docker system prune/);
    }
  });

  it('tears down stacks under any project prefix discovered from live networks', async () => {
    const teardown = await loadTeardown();
    let networkListCalls = 0;
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker network ls')) {
        networkListCalls += 1;
        // First call is discovery; final call is post-teardown verification.
        return {
          stdout: networkListCalls === 1
            ? 'bridge\nmyn-feature-min-9999_devnet\nhost\n'
            : 'bridge\nhost\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardown('min-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );
    expect(commands).toContain(
      'docker compose -p "myn-feature-min-9999" down -v --remove-orphans',
    );
    expect(commands).toContain('docker network rm "myn-feature-min-9999_devnet"');
    expect(result.networkRemoved).toBe(true);
  });

  it('force-removes containers still attached to the network when compose down fails', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker compose') && command.includes('down')) {
        throw new Error('no configuration file provided: not found');
      }
      if (command.includes('docker ps -a --filter network')) {
        return { stdout: 'abc123\ndef456\n', stderr: '' };
      }
      if (command.includes('docker network ls')) {
        return { stdout: 'bridge\nhost\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardown('pan-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );
    expect(commands).toContain('docker rm -f "abc123" "def456"');
    expect(result.steps.some((s) => s.includes('Removed 2 container(s)'))).toBe(true);
    expect(result.networkRemoved).toBe(true);
  });

  it('does not run docker rm when no containers are attached to the network', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker ps -a --filter network')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('docker network ls')) {
        return { stdout: 'bridge\nhost\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await teardown('pan-9999');

    const commands = mockExecAsync.mock.calls.map(([call]) =>
      typeof call === 'string' ? call : call.cmd,
    );
    expect(commands.some((c) => c.includes('docker rm'))).toBe(false);
  });

  it('includes a human-readable step log', async () => {
    const teardown = await loadTeardown();
    const result = await teardown('pan-9999');

    expect(result.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.steps.some((s) => s.includes('Stopped Docker stack'))).toBe(true);
    expect(result.steps.some((s) => s.includes('network'))).toBe(true);
    expect(result.steps.some((s) => s.includes('Verified network') || s.includes('still present'))).toBe(true);
  });
});
