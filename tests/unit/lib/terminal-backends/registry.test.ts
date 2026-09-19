import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'path';
import { registerTerminalBackend, registeredTerminalBackends, resolveTerminalBackend } from '../../../../src/lib/terminal-backends/registry.js';
import { herdrSessionName, herdrSocketPath, selectTerminalBackend, type SelectTerminalBackendDeps } from '../../../../src/lib/terminal-backends/select.js';
import { isUnsupported, unsupported, type TerminalBackend } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 W2. Two invariants: selection follows D10 (explicit config wins,
 * else herdr only when the binary and the session socket are both present),
 * and an operation an adapter cannot perform is a value the caller can branch
 * on, never a throw (FR-3).
 */

const HOME = '/tmp/w2-home';
const PATH_WITH_HERDR = ['/tmp/w2-bin', '/usr/bin'].join(':');
const HERDR_BIN = join('/tmp/w2-bin', 'herdr');
// fix10: the session name is derived from OVERDECK_HOME. The default home owns
// `overdeck`; anything else owns `overdeck-<hash>` and therefore a different
// socket, so a /tmp-home process can never reach the live session.
const DEFAULT_OVERDECK_HOME = join(homedir(), '.overdeck');
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
    // exercise the host probe even when the runner exports one.
    backendEnv: '',
    isExecutable: async (path) => (overrides.binary ?? true) && path === HERDR_BIN,
    exists: async (path) => (overrides.socket ?? true) && path === socketPath,
  };
}

describe('selectTerminalBackend — D10 selection matrix', () => {
  it('honors an explicit terminal.backend even when herdr is available', async () => {
    const selection = await selectTerminalBackend({ terminal: { backend: 'tmux' } }, deps());
    expect(selection.backend).toBe('tmux');
    expect(selection.diagnostic).toContain('terminal.backend');
    expect(selection.diagnostic).toContain('config.yaml');
  });

  it('honors an explicit herdr setting without probing the host', async () => {
    const selection = await selectTerminalBackend(
      { terminal: { backend: 'herdr' } },
      { ...deps({ binary: false, socket: false }) },
    );
    expect(selection.backend).toBe('herdr');
  });

  it('selects herdr when the binary is on PATH and the session socket exists', async () => {
    const selection = await selectTerminalBackend({}, deps());
    expect(selection.backend).toBe('herdr');
    expect(selection.diagnostic).toContain(HERDR_BIN);
    expect(selection.diagnostic).toContain(SOCKET);
  });

  it('falls back to tmux when the herdr binary is not on PATH', async () => {
    const selection = await selectTerminalBackend({}, deps({ binary: false }));
    expect(selection.backend).toBe('tmux');
    expect(selection.diagnostic).toContain('not on PATH');
  });

  it('falls back to tmux when the session socket is missing, naming the socket path', async () => {
    const selection = await selectTerminalBackend({}, deps({ socket: false }));
    expect(selection.backend).toBe('tmux');
    expect(selection.diagnostic).toContain(SOCKET);
    expect(selection.diagnostic).toContain('does not exist');
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

  it('selects herdr for a non-default home only when THAT session socket exists', async () => {
    const selection = await selectTerminalBackend({}, deps({ overdeckHome: OTHER_OVERDECK_HOME }));
    expect(selection.backend).toBe('herdr');
    expect(selection.diagnostic).toContain(OTHER_SESSION);
  });

  it('falls back to tmux for a non-default home while the default session socket is live', async () => {
    const selection = await selectTerminalBackend({}, {
      ...deps({ overdeckHome: OTHER_OVERDECK_HOME }),
      // The DEFAULT session's socket is present; this home's is not.
      exists: async (path) => path === SOCKET,
    });
    expect(selection.backend).toBe('tmux');
    expect(selection.diagnostic).toContain(OTHER_SOCKET);
    expect(selection.diagnostic).toContain('does not exist');
  });

  it('honors OVERDECK_TERMINAL_BACKEND above config and the host probe', async () => {
    const forced = await selectTerminalBackend(
      { terminal: { backend: 'herdr' } },
      { ...deps(), backendEnv: 'tmux' },
    );
    expect(forced.backend).toBe('tmux');
    expect(forced.diagnostic).toContain('OVERDECK_TERMINAL_BACKEND');
  });

  it('ignores an unknown OVERDECK_TERMINAL_BACKEND value', async () => {
    const selection = await selectTerminalBackend({}, { ...deps(), backendEnv: 'screen' });
    expect(selection.backend).toBe('herdr');
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

  it('returns the adapter registered under the requested name', () => {
    expect(resolveTerminalBackend('tmux').name).toBe('tmux');
    expect(registeredTerminalBackends()).toContain('tmux');
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
