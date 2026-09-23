import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PAN-3956 W2 (FR-3): an unavailable Herdr is a spawn-time error naming
 * `pan install`, never a tmux adapter resolved from a `herdr` policy.
 */

const { hostNameMock, probeMock, sessionExistsMock } = vi.hoisted(() => ({
  hostNameMock: vi.fn(),
  probeMock: vi.fn(),
  sessionExistsMock: vi.fn(),
}));

vi.mock('../../../../src/lib/terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: hostNameMock,
    probeHerdrAvailability: probeMock,
  };
});

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/tmux.js')>();
  return { ...actual, sessionExists: sessionExistsMock };
});

import { Effect } from 'effect';

import {
  agentPaneExists,
  closeAgentPane,
  launchAgentPane,
  resolveLaunchBackend,
} from '../../../../src/lib/terminal-backends/launch.js';
import { registerTerminalBackend, resolveTerminalBackend } from '../../../../src/lib/terminal-backends/registry.js';
import {
  TerminalBackendUnavailableError,
  type TerminalBackend,
} from '../../../../src/lib/terminal-backends/types.js';

const UNAVAILABLE = {
  binary: '/home/op/.local/bin/herdr',
  session: 'overdeck',
  socket: '/home/op/.config/herdr/sessions/overdeck/herdr.sock',
  socketExists: false,
  available: false,
  reason: "The 'herdr' binary is at /home/op/.local/bin/herdr but its 'overdeck' session socket "
    + '/home/op/.config/herdr/sessions/overdeck/herdr.sock does not exist.',
};

const AVAILABLE = { ...UNAVAILABLE, socketExists: true, available: true, reason: undefined };

beforeEach(() => {
  hostNameMock.mockReset();
  probeMock.mockReset();
  sessionExistsMock.mockReset();
  sessionExistsMock.mockImplementation(() => Effect.succeed(false));
});

describe('resolveLaunchBackend — strict Herdr (PAN-3956 FR-3)', () => {
  it('rejects with TerminalBackendUnavailableError naming pan install when herdr is unavailable', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValue(UNAVAILABLE);

    const error = await resolveLaunchBackend().then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(TerminalBackendUnavailableError);
    const message = (error as Error).message;
    expect(message).toContain('pan install');
    expect(message).toContain('terminal.backend: tmux');
    expect(message).toContain(UNAVAILABLE.socket);
    expect((error as TerminalBackendUnavailableError).backend).toBe('herdr');
  });

  it('resolves the herdr adapter when the probe is available', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValue(AVAILABLE);
    const backend = await resolveLaunchBackend();
    expect(backend.name).toBe('herdr');
  });

  it('resolves tmux under a tmux policy without probing Herdr', async () => {
    hostNameMock.mockResolvedValue('tmux');
    const backend = await resolveLaunchBackend();
    expect(backend.name).toBe('tmux');
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('probes on every call: a session server started later is picked up without a restart', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValueOnce(UNAVAILABLE).mockResolvedValueOnce(AVAILABLE);
    await expect(resolveLaunchBackend()).rejects.toBeInstanceOf(TerminalBackendUnavailableError);
    await expect(resolveLaunchBackend()).resolves.toMatchObject({ name: 'herdr' });
  });

  it('launchAgentPane and agentPaneExists surface the error instead of touching tmux', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValue(UNAVAILABLE);
    await expect(launchAgentPane({
      issueId: 'PAN-3956',
      cwd: '/tmp',
      agentId: 'agent-pan-3956',
      argv: ['true'],
      env: {},
      tokens: { issue: 'PAN-3956', role: 'work', harness: 'claude-code', model: 'm' },
    })).rejects.toBeInstanceOf(TerminalBackendUnavailableError);
    await expect(agentPaneExists('agent-pan-3956')).rejects.toBeInstanceOf(TerminalBackendUnavailableError);
    expect(sessionExistsMock).not.toHaveBeenCalled();
  });
});

describe('closeAgentPane while Herdr is unavailable', () => {
  it('still kills a legacy tmux session of that name', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValue(UNAVAILABLE);
    sessionExistsMock.mockImplementation(() => Effect.succeed(true));
    const closed: string[] = [];
    const real = resolveTerminalBackend('tmux');
    const spy: TerminalBackend = {
      ...real,
      close: (pane) => {
        closed.push('paneId' in pane ? pane.paneId : 'unknown');
        return Effect.succeed({ ok: true as const });
      },
    };
    registerTerminalBackend(spy);
    try {
      await expect(closeAgentPane('agent-pan-3956')).resolves.toBe(true);
      expect(closed).toEqual(['agent-pan-3956']);
    } finally {
      registerTerminalBackend(real);
    }
  });

  it('returns false when there is no legacy tmux session either', async () => {
    hostNameMock.mockResolvedValue('herdr');
    probeMock.mockResolvedValue(UNAVAILABLE);
    await expect(closeAgentPane('agent-pan-3956')).resolves.toBe(false);
  });
});
