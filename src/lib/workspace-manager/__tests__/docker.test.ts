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

describe('teardownWorkspaceDockerByName', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  async function loadTeardown() {
    const { teardownWorkspaceDockerByName } = await import(
      '../docker.js'
    );
    return teardownWorkspaceDockerByName;
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

  it('carries the actual remaining network names on the result (PAN-3049)', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker network ls')) {
        return {
          stdout: 'bridge\nmyn-feature-min-901_devnet\nhost\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardown('min-901');
    expect(result.networkRemoved).toBe(false);
    expect(result.remainingNetworks).toEqual(['myn-feature-min-901_devnet']);
  });

  it('omits remainingNetworks when the network is fully removed', async () => {
    const teardown = await loadTeardown();
    const result = await teardown('pan-9999');
    expect(result.networkRemoved).toBe(true);
    expect(result.remainingNetworks).toBeUndefined();
  });

  it('only emits project-scoped or network-scoped docker commands and never prunes', async () => {
    const teardown = await loadTeardown();
    await teardown('pan-9999');

    // execAsync(shellString) and execFileAsync('docker', argv) both land here.
    const commands = mockExecAsync.mock.calls.map(([first, second]) =>
      Array.isArray(second) ? [first, ...second].join(' ') : first,
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
        return { stdout: 'abc123\toverdeck-feature-pan-9999\ndef456\toverdeck-feature-pan-9999\n', stderr: '' };
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

  it('disconnects foreign containers (shared traefik) instead of removing them', async () => {
    const teardown = await loadTeardown();
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('docker ps -a --filter network')) {
        // One container from this stack, plus traefik (different compose project).
        return { stdout: 'abc123\toverdeck-feature-pan-9999\ntrf999\toverdeck-infra\n', stderr: '' };
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
    expect(commands).toContain('docker rm -f "abc123"');
    expect(commands).toContain(
      'docker network disconnect -f "overdeck-feature-pan-9999_devnet" "trf999"',
    );
    expect(commands.some((c) => c.includes('rm -f') && c.includes('trf999'))).toBe(false);
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

function argvCommands(): string[] {
  return mockExecAsync.mock.calls.map(([first, second]) =>
    Array.isArray(second) ? [first, ...second].join(' ') : String(first),
  );
}

describe('removeComposeProjectNetworks (PAN-3900)', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  async function loadRemove() {
    const { removeComposeProjectNetworks } = await import('../docker.js');
    return removeComposeProjectNetworks;
  }

  function mockDocker(handler: (argv: string[]) => { stdout: string } | Error) {
    mockExecAsync.mockImplementation(async (cmd: string, argv?: string[]) => {
      if (cmd !== 'docker' || !Array.isArray(argv)) return { stdout: '', stderr: '' };
      const out = handler(argv);
      if (out instanceof Error) throw out;
      return { ...out, stderr: '' };
    });
  }

  it('lists networks by the exact compose project label and removes each one', async () => {
    const remove = await loadRemove();
    mockDocker((argv) => {
      if (argv[0] === 'network' && argv[1] === 'ls') {
        return { stdout: 'overdeck-feature-pan-9999_devnet\noverdeck-feature-pan-9999_default\n' };
      }
      return { stdout: '' };
    });

    const result = await remove('overdeck-feature-pan-9999');

    const commands = argvCommands();
    expect(commands).toContain(
      'docker network ls --filter label=com.docker.compose.project=overdeck-feature-pan-9999 --format {{.Name}}',
    );
    expect(commands).toContain('docker network rm overdeck-feature-pan-9999_devnet');
    expect(commands).toContain('docker network rm overdeck-feature-pan-9999_default');
    expect(result.removed).toEqual(['overdeck-feature-pan-9999_devnet', 'overdeck-feature-pan-9999_default']);
    expect(result.remaining).toEqual([]);
  });

  it('disconnects a foreign container (traefik) and never removes it', async () => {
    const remove = await loadRemove();
    mockDocker((argv) => {
      if (argv[0] === 'network' && argv[1] === 'ls') return { stdout: 'overdeck-feature-pan-9999_devnet\n' };
      if (argv[0] === 'ps') return { stdout: 'trf999\toverdeck-infra\nabc123\toverdeck-feature-pan-9999\n' };
      return { stdout: '' };
    });

    await remove('overdeck-feature-pan-9999');

    const commands = argvCommands();
    expect(commands).toContain('docker network disconnect -f overdeck-feature-pan-9999_devnet trf999');
    expect(commands).toContain('docker rm -f abc123');
    expect(commands.some((c) => c.includes('rm -f') && c.includes('trf999'))).toBe(false);
    expect(commands).toContain('docker network rm overdeck-feature-pan-9999_devnet');
  });

  it('reports a network docker refuses to remove as remaining', async () => {
    const remove = await loadRemove();
    mockDocker((argv) => {
      if (argv[0] === 'network' && argv[1] === 'ls') return { stdout: 'myn-feature-min-1_devnet\n' };
      if (argv[0] === 'network' && argv[1] === 'rm') return new Error('error: network has active endpoints');
      return { stdout: '' };
    });

    const result = await remove('myn-feature-min-1');
    expect(result.remaining).toEqual(['myn-feature-min-1_devnet']);
    expect(result.removed).toEqual([]);
  });

  it('touches nothing when no network carries the project label', async () => {
    const remove = await loadRemove();
    const result = await remove('overdeck-feature-pan-9999');
    const commands = argvCommands();
    expect(commands.filter((c) => c.includes('network rm') || c.includes('rm -f'))).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe('teardownWorkspaceDockerByName removes labeled non-devnet networks (PAN-3900)', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  it('removes the project _default network found by label', async () => {
    const { teardownWorkspaceDockerByName } = await import('../docker.js');
    mockExecAsync.mockImplementation(async (cmd: string, argv?: string[]) => {
      if (cmd === 'docker' && Array.isArray(argv) && argv[0] === 'network' && argv[1] === 'ls'
        && argv.includes('label=com.docker.compose.project=overdeck-feature-pan-9999')) {
        return { stdout: 'overdeck-feature-pan-9999_default\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await teardownWorkspaceDockerByName('pan-9999');

    expect(argvCommands()).toContain('docker network rm overdeck-feature-pan-9999_default');
    expect(result.networkRemoved).toBe(true);
  });
});
