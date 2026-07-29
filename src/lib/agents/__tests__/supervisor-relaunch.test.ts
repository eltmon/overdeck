/**
 * PAN-3257: crash-resume must re-wire the PTY supervisor by deciding
 * eligibility fresh — never by trusting the persisted supervisorEnabled flag,
 * which a state rewrite can lose (observed on PAN-1837: the resumed agent ran
 * supervisor-less forever while its stale socket refused every delivery).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWritePtyToken, getHome } = vi.hoisted(() => {
  let home = '';
  return {
    mockWritePtyToken: vi.fn(async () => undefined),
    getHome: (next?: string) => {
      if (next !== undefined) home = next;
      return home;
    },
  };
});

vi.mock('../../pty-token.js', () => ({
  writePtyToken: mockWritePtyToken,
  readPtyToken: vi.fn(async () => null),
}));

vi.mock('../../channels/pty-supervisor-locate.js', () => ({
  resolvePtySupervisorScriptPath: () => '/repo/dist/pty-supervisor.js',
}));

vi.mock('../../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../paths.js')>()),
  getOverdeckHome: () => getHome(),
}));

import { prepareSupervisorForRelaunch } from '../supervisor-channels.js';
import type { AgentState } from '../agent-state.js';

function workState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1837',
    issueId: 'PAN-1837',
    workspace: '/tmp/workspaces/feature-pan-1837',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-5',
    status: 'stopped',
    ...overrides,
  } as AgentState;
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'overdeck-supervisor-relaunch-'));
  getHome(home);
  mkdirSync(join(home, 'sockets'), { recursive: true });
  mockWritePtyToken.mockClear();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('prepareSupervisorForRelaunch (PAN-3257)', () => {
  it('re-wires the supervisor even when the persisted supervisorEnabled flag was lost', async () => {
    const state = workState(); // no supervisorEnabled field at all

    const result = await prepareSupervisorForRelaunch(
      'agent-pan-1837',
      state,
      'claude-sonnet-5',
      'claude-code',
    );

    expect(result).toEqual({
      useSupervisor: true,
      supervisorScriptPath: '/repo/dist/pty-supervisor.js',
    });
    expect(state.supervisorEnabled).toBe(true);
    expect(mockWritePtyToken).toHaveBeenCalledWith('agent-pan-1837');
  });

  it('removes a stale supervisor socket when the relaunch is ineligible', async () => {
    const socketPath = join(home, 'sockets', 'pty-agent-pan-1837-review.sock');
    writeFileSync(socketPath, '');
    const state = workState({
      id: 'agent-pan-1837-review',
      role: 'review',
      supervisorEnabled: true,
    });

    const result = await prepareSupervisorForRelaunch(
      'agent-pan-1837-review',
      state,
      'claude-sonnet-5',
      'claude-code',
    );

    expect(result).toEqual({ useSupervisor: false });
    expect(state.supervisorEnabled).toBeUndefined();
    expect(existsSync(socketPath)).toBe(false);
    expect(mockWritePtyToken).not.toHaveBeenCalled();
  });

  it('stays supervisor-less for harnesses without PTY supervisor support', async () => {
    const state = workState({ harness: 'ohmypi' });

    const result = await prepareSupervisorForRelaunch(
      'agent-pan-1837',
      state,
      'gpt-5.5',
      'ohmypi',
    );

    expect(result).toEqual({ useSupervisor: false });
    expect(mockWritePtyToken).not.toHaveBeenCalled();
  });
});
