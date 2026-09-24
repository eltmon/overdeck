/**
 * PAN-3917 W12: a failed spawn must leave terminal, diagnosable state.
 *
 * `pan start PAN-3705` died inside `launchAgentPane` — Herdr created the pane,
 * never detected the harness behind the PTY supervisor's own pty, and closed
 * it. The launch call had no try/catch, so nothing on the failure path ran and
 * `~/.overdeck/agents/agent-pan-3705/state.json` sat at `status: 'starting'`
 * with no reason, no stop time, and no record of which backend or pane the
 * agent had been given.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getHome } = vi.hoisted(() => {
  let home = '';
  return {
    getHome: (next?: string) => {
      if (next !== undefined) home = next;
      return home;
    },
  };
});

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/paths.js')>()),
  getOverdeckHome: () => getHome(),
}));

import { markSpawnFailed } from '../../../../src/lib/agents/agent-state.js';
import { launchAgentPane } from '../../../../src/lib/terminal-backends/launch.js';
import { TerminalBackendError, unsupported, type TerminalBackend } from '../../../../src/lib/terminal-backends/types.js';

let home: string;

function writeState(agentId: string, state: Record<string, unknown>): string {
  const dir = join(home, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'state.json');
  writeFileSync(path, JSON.stringify(state, null, 2));
  return path;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'overdeck-spawn-failure-'));
  getHome(home);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('markSpawnFailed', () => {
  it('turns a launch that died at `starting` into a stopped agent with a reason', async () => {
    const path = writeState('agent-pan-3705', {
      id: 'agent-pan-3705',
      issueId: 'PAN-3705',
      workspace: '/tmp/workspaces/feature-pan-3705',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-5',
      status: 'starting',
      startedAt: '2026-09-19T10:03:00.960Z',
    });

    await markSpawnFailed('agent-pan-3705', 'launch failed: herdr detected no agent in pane wE:p2');

    const saved = JSON.parse(readFileSync(path, 'utf-8'));
    expect(saved.status).toBe('stopped');
    expect(saved.lastFailureReason).toContain('herdr detected no agent in pane wE:p2');
    expect(typeof saved.stoppedAt).toBe('string');
    expect(saved.lastFailureAt).toBe(saved.stoppedAt);
  });

  it('keeps the backend and pane the launch already recorded, so a stop can address them', async () => {
    const path = writeState('agent-pan-3705', {
      id: 'agent-pan-3705',
      issueId: 'PAN-3705',
      workspace: '/tmp/workspaces/feature-pan-3705',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-5',
      status: 'starting',
      startedAt: '2026-09-19T10:03:00.960Z',
      backend: 'herdr',
      paneId: 'wE:p2',
    });

    await markSpawnFailed('agent-pan-3705', 'launch failed: boom');

    const saved = JSON.parse(readFileSync(path, 'utf-8'));
    expect(saved.backend).toBe('herdr');
    expect(saved.paneId).toBe('wE:p2');
  });

  it('is a no-op for an agent with no state file, and never throws', async () => {
    await expect(markSpawnFailed('agent-does-not-exist', 'launch failed')).resolves.toBeUndefined();
  });
});

/**
 * The failure the catch has to see: `launchAgentPane` must THROW when the
 * backend cannot place the agent. A rejected promise is what reaches spawn's
 * try/catch; a swallowed one leaves `starting` behind again.
 */
function fakeBackend(overrides: Partial<TerminalBackend>): TerminalBackend {
  return {
    name: 'herdr',
    workspaceFor: () => Effect.succeed({ backend: 'herdr', workspaceId: 'wE', issueId: 'PAN-3705', cwd: '/tmp/w' }),
    startAgent: () => Effect.succeed({
      backend: 'herdr', workspaceId: 'wE', paneId: 'wE:p2', terminalId: 't', agentName: 'agent-pan-3705',
    }),
    ...overrides,
  } as TerminalBackend;
}

describe('launchAgentPane with a failing backend', () => {
  const request = {
    issueId: 'PAN-3705',
    cwd: '/tmp/workspaces/feature-pan-3705',
    agentId: 'agent-pan-3705',
    argv: ['bash', '/tmp/launcher.sh'],
    env: {},
    tokens: { issue: 'PAN-3705', role: 'work' as const, harness: 'claude-code', model: 'claude-sonnet-5' },
  };

  it('rejects when the backend fails to start the agent (the PAN-3705 detection timeout)', async () => {
    const backend = fakeBackend({
      startAgent: () => Effect.fail(new TerminalBackendError({
        backend: 'herdr',
        operation: 'startAgent',
        message: 'herdr detected no agent in pane wE:p2 within 60000ms',
      })),
    });

    await expect(launchAgentPane(request, backend)).rejects.toThrow('herdr detected no agent in pane wE:p2');
  });

  it('rejects when the backend reports the operation unsupported', async () => {
    const backend = fakeBackend({ startAgent: () => Effect.succeed(unsupported('no such workspace')) });

    await expect(launchAgentPane(request, backend)).rejects.toThrow('could not start agent-pan-3705');
  });
});
