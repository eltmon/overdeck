/**
 * Codex work agents on the app-server transport never get a PTY supervisor
 * wrap (the app-server branch of buildCodexCommand skips it), so the
 * supervisor eligibility decision must reject them. Stamping
 * supervisorEnabled anyway projected a strict 'supervisor' deliveryMethod
 * with no socket behind it — every state-routed delivery died with
 * socket-missing, which stalled the PAN-3743 review loop on 2026-08-16 when
 * the inspect verdict could not reach the work agent.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWritePtyToken, mockLoadConfigSync, getHome } = vi.hoisted(() => {
  let home = '';
  return {
    mockWritePtyToken: vi.fn(async () => undefined),
    mockLoadConfigSync: vi.fn(),
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

vi.mock('../../config-yaml.js', () => ({
  isClaudeCodeChannelsMcpEnabled: () => false,
  loadConfigSync: mockLoadConfigSync,
}));

import { decideSupervisorForWorkAgent, prepareSupervisorForFreshLaunch } from '../supervisor-channels.js';
import type { AgentState } from '../agent-state.js';

function workState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-3743',
    issueId: 'PAN-3743',
    workspace: '/tmp/workspaces/feature-pan-3743',
    harness: 'codex',
    role: 'work',
    model: 'gpt-5.6-sol',
    status: 'starting',
    ...overrides,
  } as AgentState;
}

function configWithCodexTransport(transport: 'app-server' | 'tui') {
  return { config: { codex: { transport } } };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'overdeck-supervisor-codex-transport-'));
  getHome(home);
  mkdirSync(join(home, 'sockets'), { recursive: true });
  mockWritePtyToken.mockClear();
  mockLoadConfigSync.mockReset();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('decideSupervisorForWorkAgent codex transport gate', () => {
  it('rejects codex on the default app-server transport', () => {
    mockLoadConfigSync.mockReturnValue(configWithCodexTransport('app-server'));
    const decision = decideSupervisorForWorkAgent('agent-pan-3743', {
      issueId: 'PAN-3743',
      workspace: '/tmp/workspaces/feature-pan-3743',
    }, workState());
    expect(decision).toEqual({ eligible: false, reason: 'codex-app-server-transport' });
  });

  it('keeps codex eligible on the work-tui transport, which the launcher does wrap', () => {
    mockLoadConfigSync.mockReturnValue(configWithCodexTransport('tui'));
    const decision = decideSupervisorForWorkAgent('agent-pan-3743', {
      issueId: 'PAN-3743',
      workspace: '/tmp/workspaces/feature-pan-3743',
    }, workState());
    expect(decision).toEqual({ eligible: true });
  });

  it('does not consult the codex transport for claude-code work agents', () => {
    // No mock return configured: a claude-code decision must not touch the
    // config load at all (short-circuit before the codex branch).
    const decision = decideSupervisorForWorkAgent('agent-pan-3743', {
      issueId: 'PAN-3743',
      workspace: '/tmp/workspaces/feature-pan-3743',
    }, workState({ harness: 'claude-code', model: 'claude-opus-5' }));
    expect(decision).toEqual({ eligible: true });
    expect(mockLoadConfigSync).not.toHaveBeenCalled();
  });
});

describe('prepareSupervisorForFreshLaunch codex app-server', () => {
  it('leaves supervisorEnabled unset so no strict supervisor deliveryMethod is projected', async () => {
    mockLoadConfigSync.mockReturnValue(configWithCodexTransport('app-server'));
    const state = workState();
    const result = await prepareSupervisorForFreshLaunch('agent-pan-3743', {
      issueId: 'PAN-3743',
      workspace: '/tmp/workspaces/feature-pan-3743',
    }, state);
    expect(result).toEqual({ useSupervisor: false });
    expect(state.supervisorEnabled).toBeUndefined();
    expect(mockWritePtyToken).not.toHaveBeenCalled();
  });
});
