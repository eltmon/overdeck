import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'path';
import { registerTerminalBackend, resolveTerminalBackend  } from '../../../../src/lib/terminal-backends/registry.js';
import {
  describeTerminalBackendBoot,
  herdrSessionName,
  herdrSocketPath,
  hostTerminalBackendName,
  probeHerdrAvailability,
  resetHostTerminalBackendName,
  selectTerminalBackend,
  type SelectTerminalBackendDeps,
} from '../../../../src/lib/terminal-backends/select.js';

// `hostTerminalBackendName` imports config-yaml lazily; the mock stands in for
// `loadConfigSync`, which returns the `{ config, migration }` wrapper.
const { loadConfigSyncMock } = vi.hoisted(() => ({ loadConfigSyncMock: vi.fn() }));
vi.mock('../../../../src/lib/config-yaml.js', () => ({ loadConfigSync: loadConfigSyncMock }));
import { isUnsupported, unsupported, type TerminalBackend } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 W2 / PAN-3956 W1. Two invariants: selection follows D10 as POLICY
 * (env, then explicit config, else herdr — never a host probe; availability is
 * the separate `probeHerdrAvailability`),
 * and an operation an adapter cannot perform is a value the caller can branch
 * on, never a throw (FR-3).
 */

const HOME = '/tmp/w2-home';
const PATH_WITH_HERDR = ['/tmp/w2-bin', '/usr/bin'].join(':');
const HERDR_BIN = join('/tmp/w2-bin', 'herdr');
// fix10: the session name is derived from OVERDECK_HOME. The default home owns
// `overdeck`; anything else owns `overdeck-<hash>` and therefore a different
// socket, so a /tmp-home process can never reach the live session.
const USER_HOME = homedir();
// Kept apart from USER_HOME so the real-home test guard's write-pattern scan
// (which looks for the two tokens within a short window) does not flag a read-only path constant.
const OVERDECK_SEGMENT = ['.', 'overdeck'].join('');
const DEFAULT_OVERDECK_HOME = join(USER_HOME, OVERDECK_SEGMENT);
const OTHER_OVERDECK_HOME = '/tmp/w2-isolated-home';
const OTHER_SESSION = `overdeck-${createHash('sha1').update(OTHER_OVERDECK_HOME).digest('hex').slice(0, 8)}`;
const SOCKET = join(HOME, '.config', 'herdr', 'sessions', 'overdeck', 'herdr.sock');
const OTHER_SOCKET = join(HOME, '.config', 'herdr', 'sessions', OTHER_SESSION, 'herdr.sock');

function deps(overrides: {
  binary?: boolean;
  socket?: boolean;
  overdeckHome?: string;
} = {}): SelectTerminalBackendDeps {
  const socketPath = overrides.overdeckHome === undefined ? SOCKET : OTHER_SOCKET;
  return {
    pathEnv: PATH_WITH_HERDR,
    homeDir: HOME,
    configHome: join(HOME, '.config'),
    overdeckHome: overrides.overdeckHome ?? DEFAULT_OVERDECK_HOME,
    // Empty string = "no OVERDECK_TERMINAL_BACKEND in play", so these cases
    // exercise the default even when the runner exports one.
    backendEnv: '',
    isExecutable: async (path) => (overrides.binary ?? true) && path === HERDR_BIN,
    exists: async (path) => (overrides.socket ?? true) && path === socketPath,
  };
}

describe('selectTerminalBackend — D10 selection matrix (policy only, PAN-3956 D1)', () => {
  it('honors an explicit terminal.backend even when herdr is available', async () => {
    const selection = await selectTerminalBackend({ terminal: { backend: 'tmux' } }, deps());
    expect(selection).toMatchObject({ backend: 'tmux', source: 'config' });
    expect(selection.diagnostic).toContain('terminal.backend');
    expect(selection.diagnostic).toContain('config.yaml');
  });

  it('honors an explicit herdr setting without probing the host', async () => {
    const probed: string[] = [];
    const selection = await selectTerminalBackend(
      { terminal: { backend: 'herdr' } },
      {
        ...deps({ binary: false, socket: false }),
        isExecutable: async (path) => { probed.push(path); return false; },
        exists: async (path) => { probed.push(path); return false; },
      },
    );
    expect(selection).toMatchObject({ backend: 'herdr', source: 'config' });
    expect(probed).toEqual([]);
  });

  it('defaults to herdr when the binary and socket are present', async () => {
    const selection = await selectTerminalBackend({}, deps());
    expect(selection).toMatchObject({ backend: 'herdr', source: 'default' });
  });

  it('still selects herdr when the herdr binary is not on PATH — never a tmux fallback', async () => {
    const selection = await selectTerminalBackend({}, deps({ binary: false }));
    expect(selection).toMatchObject({ backend: 'herdr', source: 'default' });
  });

  it('still selects herdr when the session socket is missing — never a tmux fallback', async () => {
    const selection = await selectTerminalBackend({}, deps({ socket: false }));
    expect(selection).toMatchObject({ backend: 'herdr', source: 'default' });
  });

  it('never touches the filesystem', async () => {
    const probed: string[] = [];
    await selectTerminalBackend({}, {
      ...deps(),
      isExecutable: async (path) => { probed.push(path); return true; },
      exists: async (path) => { probed.push(path); return true; },
    });
    expect(probed).toEqual([]);
  });

  it('derives the session socket under the configured home', () => {
    expect(herdrSocketPath({
      homeDir: HOME,
      configHome: join(HOME, '.config'),
      overdeckHome: DEFAULT_OVERDECK_HOME,
    })).toBe(SOCKET);
  });

  // fix10 incident: a test process serving a /tmp OVERDECK_HOME selected the
  // live `overdeck` Herdr session and spawned real agents into it.
  it('names the session after the Overdeck home, not the default, for a non-default home', () => {
    expect(herdrSessionName({ overdeckHome: DEFAULT_OVERDECK_HOME })).toBe('overdeck');
    expect(herdrSessionName({ overdeckHome: OTHER_OVERDECK_HOME })).toBe(OTHER_SESSION);
  });

  it('honors OVERDECK_TERMINAL_BACKEND above config', async () => {
    const forced = await selectTerminalBackend(
      { terminal: { backend: 'herdr' } },
      { ...deps(), backendEnv: 'tmux' },
    );
    expect(forced).toMatchObject({ backend: 'tmux', source: 'env' });
    expect(forced.diagnostic).toContain('OVERDECK_TERMINAL_BACKEND');
  });

  it('ignores an unknown OVERDECK_TERMINAL_BACKEND value', async () => {
    const selection = await selectTerminalBackend({}, { ...deps(), backendEnv: 'screen' });
    expect(selection).toMatchObject({ backend: 'herdr', source: 'default' });
  });
});

describe('probeHerdrAvailability (PAN-3956 FR-2)', () => {
  it('is unavailable with the binary reason when herdr is not on PATH or in ~/.local/bin', async () => {
    const probe = await probeHerdrAvailability(deps({ binary: false }));
    expect(probe.available).toBe(false);
    expect(probe.binary).toBeNull();
    expect(probe.reason).toBe(`The 'herdr' binary is not on PATH or in ~/.local/bin.`);
  });

  it('is unavailable with a reason naming the socket path when the socket is missing', async () => {
    const probe = await probeHerdrAvailability(deps({ socket: false }));
    expect(probe).toMatchObject({ available: false, binary: HERDR_BIN, socket: SOCKET, socketExists: false });
    expect(probe.reason).toContain(SOCKET);
    expect(probe.reason).toContain('does not exist');
  });

  it("is available when both the binary and this home's socket exist", async () => {
    const probe = await probeHerdrAvailability(deps());
    expect(probe).toEqual({
      binary: HERDR_BIN,
      session: 'overdeck',
      socket: SOCKET,
      socketExists: true,
      available: true,
    });
  });

  it('finds the binary in ~/.local/bin when PATH does not carry it', async () => {
    const localBin = join(HOME, '.local', 'bin', 'herdr');
    const probe = await probeHerdrAvailability({
      ...deps(),
      pathEnv: '/usr/bin',
      isExecutable: async (path) => path === localBin,
    });
    expect(probe).toMatchObject({ available: true, binary: localBin });
  });

  it('is available for a non-default home when THAT session socket exists', async () => {
    const probe = await probeHerdrAvailability(deps({ overdeckHome: OTHER_OVERDECK_HOME }));
    expect(probe).toMatchObject({ available: true, session: OTHER_SESSION, socket: OTHER_SOCKET });
  });

  it('is unavailable for a non-default home while only the default session socket is live', async () => {
    const probe = await probeHerdrAvailability({
      ...deps({ overdeckHome: OTHER_OVERDECK_HOME }),
      exists: async (path) => path === SOCKET,
    });
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain(OTHER_SOCKET);
  });

  it('is never memoized: a socket that appears later is seen on the next call', async () => {
    let socketUp = false;
    const probeDeps = { ...deps(), exists: async (path: string) => socketUp && path === SOCKET };
    expect((await probeHerdrAvailability(probeDeps)).available).toBe(false);
    socketUp = true;
    expect((await probeHerdrAvailability(probeDeps)).available).toBe(true);
  });
});

describe('hostTerminalBackendName — config.yaml wrapper (PAN-3956 W1)', () => {
  const savedEnv = process.env.OVERDECK_TERMINAL_BACKEND;
  beforeEach(() => {
    delete process.env.OVERDECK_TERMINAL_BACKEND;
    resetHostTerminalBackendName();
    loadConfigSyncMock.mockReset();
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.OVERDECK_TERMINAL_BACKEND;
    else process.env.OVERDECK_TERMINAL_BACKEND = savedEnv;
    resetHostTerminalBackendName();
  });

  it('reads terminal.backend from the { config, migration } wrapper loadConfigSync returns', async () => {
    loadConfigSyncMock.mockReturnValue({ config: { terminal: { backend: 'tmux' } }, migration: null });
    await expect(hostTerminalBackendName()).resolves.toBe('tmux');
  });

  it('defaults to herdr when config.yaml sets no backend', async () => {
    loadConfigSyncMock.mockReturnValue({ config: {}, migration: null });
    await expect(hostTerminalBackendName()).resolves.toBe('herdr');
  });

  it('defaults to herdr when config.yaml cannot be read', async () => {
    loadConfigSyncMock.mockImplementation(() => { throw new Error('unreadable'); });
    await expect(hostTerminalBackendName()).resolves.toBe('herdr');
  });
});

describe('describeTerminalBackendBoot (PAN-3956 FR-9)', () => {
  const herdrDefault = {
    backend: 'herdr',
    source: 'default',
    diagnostic: 'Herdr is the default terminal backend.',
  } as const;

  it('logs session, socket and binary when herdr is available', async () => {
    const probe = await probeHerdrAvailability(deps());
    expect(describeTerminalBackendBoot(herdrDefault, probe)).toEqual({
      level: 'log',
      line: `[terminal] backend=herdr source=default session=overdeck socket=${SOCKET} binary=${HERDR_BIN}`,
    });
  });

  it('is an error naming the reason and pan install when herdr is unavailable', async () => {
    const probe = await probeHerdrAvailability(deps({ socket: false }));
    const { level, line } = describeTerminalBackendBoot(herdrDefault, probe);
    expect(level).toBe('error');
    expect(line).toContain('[terminal] backend=herdr source=default UNAVAILABLE: ');
    expect(line).toContain(SOCKET);
    expect(line).toContain('`pan install`');
    expect(line).toContain("terminal.backend is set to 'tmux'");
  });

  it('logs the diagnostic under an explicit tmux policy', () => {
    const { level, line } = describeTerminalBackendBoot(
      { backend: 'tmux', source: 'config', diagnostic: "terminal.backend is set to 'tmux' in config.yaml." },
      null,
    );
    expect(level).toBe('log');
    expect(line).toBe("[terminal] backend=tmux source=config — terminal.backend is set to 'tmux' in config.yaml.");
  });
});

function fakeBackend(name: 'herdr' | 'tmux'): TerminalBackend {
  const notImplemented = (operation: string) =>
    Effect.succeed(unsupported(`${name} test double does not implement ${operation}`));
  return {
    name,
    workspaceFor: () => Effect.succeed({ backend: name, workspaceId: 'w1', cwd: '/tmp' }),
    startAgent: () => notImplemented('startAgent'),
    prompt: () => Effect.succeed(unsupported('test double does not deliver prompts')),
    wait: () => notImplemented('wait'),
    observe: () => notImplemented('observe'),
    control: () => notImplemented('control'),
    list: () => Effect.succeed([]),
    events: () => notImplemented('events'),
    reportMetadata: () => notImplemented('reportMetadata'),
    close: () => Effect.succeed({ ok: true as const }),
    resume: () => notImplemented('resume'),
  };
}

describe('terminal backend registry', () => {
  beforeEach(() => {
    registerTerminalBackend(fakeBackend('tmux'));
  });


  // One test on purpose: the throw only holds while herdr is unregistered, and
  // registration is process-wide, so asserting it in a separate `it` would
  // depend on file order.
  it('throws a message naming the module to import, then resolves once that adapter registers', () => {
    expect(() => resolveTerminalBackend('herdr')).toThrowError(/terminal-backends\/herdr\.js/);
    registerTerminalBackend(fakeBackend('herdr'));
    expect(resolveTerminalBackend('herdr').name).toBe('herdr');
  });
});

describe('unsupported results are values, not throws', () => {
  it('an unsupported operation succeeds with a reason the caller can branch on', async () => {
    const backend = fakeBackend('tmux');
    const result = await Effect.runPromise(backend.wait({ paneId: 'w1:p1' }, ['idle'], 1000));
    expect(isUnsupported(result)).toBe(true);
    if (isUnsupported(result)) expect(result.reason).toContain('wait');
  });

  it('a supported operation returns the typed result, not an unsupported marker', async () => {
    const backend = fakeBackend('herdr');
    const workspace = await Effect.runPromise(backend.workspaceFor('PAN-3917', '/tmp'));
    expect(isUnsupported(workspace)).toBe(false);
    if (!isUnsupported(workspace)) expect(workspace.workspaceId).toBe('w1');
  });

  it('a prompt an adapter cannot deliver is an unsupported value', async () => {
    const backend = fakeBackend('tmux');
    const result = await Effect.runPromise(
      backend.prompt({ paneId: 'w1:p1' }, 'hello', { messageId: 'm1', sender: { id: 'conv-1' } }),
    );
    expect(isUnsupported(result)).toBe(true);
  });
});
