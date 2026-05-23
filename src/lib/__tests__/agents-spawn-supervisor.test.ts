import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../agents.js';

let tmpHome: string;
let workspace: string;
let packageRootDir: string;
let createSessionMock: ReturnType<typeof vi.fn>;
let sendRawKeystrokeMock: ReturnType<typeof vi.fn>;
let capturePaneText: string;
let channelsMcpEnabled: boolean;

function baseState(partial: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1405',
    issueId: 'PAN-1405',
    workspace,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'starting',
    startedAt: '2026-05-23T00:00:00.000Z',
    ...partial,
  };
}

function writeSupervisorArtifact(): string {
  const path = join(packageRootDir, 'dist', 'pty-supervisor.js');
  mkdirSync(join(packageRootDir, 'dist'), { recursive: true });
  writeFileSync(path, '#!/usr/bin/env node\n');
  return path;
}

function mockSpawnDependencies(): void {
  createSessionMock = vi.fn(() => undefined);
  sendRawKeystrokeMock = vi.fn(() => Effect.void);

  vi.doMock('../paths.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../paths.js')>();
    return {
      ...actual,
      AGENTS_DIR: join(tmpHome, 'agents'),
      packageRoot: packageRootDir,
    };
  });

  vi.doMock('../tmux.js', () => ({
    createSessionSync: vi.fn(),
    createSession: vi.fn((...args: unknown[]) => Effect.sync(() => createSessionMock(...args))),
    killSessionSync: vi.fn(),
    killSession: vi.fn(() => Effect.void),
    sendKeys: vi.fn(() => Effect.void),
    sendRawKeystroke: sendRawKeystrokeMock,
    sessionExistsSync: vi.fn(() => false),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    getAgentSessionsSync: vi.fn(() => []),
    getAgentSessions: vi.fn(() => Effect.succeed([])),
    capturePaneSync: vi.fn(() => capturePaneText),
    capturePane: vi.fn(() => Effect.succeed(capturePaneText)),
    listPaneValuesSync: vi.fn(() => []),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    waitForClaudePrompt: vi.fn(async () => true),
    setOption: vi.fn(() => Effect.void),
  }));

  vi.doMock('../workspace/stack-health.js', () => ({
    getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: null })),
  }));
  vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(() => Effect.succeed(undefined)) }));
  vi.doMock('../activity-logger.js', () => ({
    emitActivityEntrySync: vi.fn(),
    emitActivityTtsSync: vi.fn(),
  }));
  vi.doMock('../cloister/work-agent-prompt.js', () => ({
    writeStoryFeatureContext: vi.fn(async () => undefined),
  }));
  vi.doMock('../config-yaml.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../config-yaml.js')>();
    return {
      ...actual,
      isClaudeCodeChannelsMcpEnabled: () => channelsMcpEnabled,
      loadConfigSync: () => ({
        config: {
          workhorses: actual.DEFAULT_WORKHORSES,
          roles: actual.DEFAULT_ROLES,
          caveman: { enabled: false },
        },
      }),
    };
  });
  vi.doMock('../claude-auth.js', () => ({
    getClaudeAuthStatus: vi.fn(() => Effect.succeed({ loggedIn: true, hasAnthropicApiKey: true })),
  }));
  vi.doMock('../projects.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../projects.js')),
    findProjectByPathSync: vi.fn(() => null),
  }));
}

beforeEach(() => {
  vi.resetModules();
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-spawn-supervisor-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-spawn-supervisor-workspace-'));
  packageRootDir = mkdtempSync(join(tmpdir(), 'pan-spawn-supervisor-package-'));
  process.env.PANOPTICON_HOME = tmpHome;
  capturePaneText = 'Claude Code';
  channelsMcpEnabled = false;
  delete process.env.PAN_DOCKER;
  delete process.env.PANOPTICON_DOCKER_WORKSPACE;
  mockSpawnDependencies();
});

afterEach(() => {
  vi.doUnmock('../paths.js');
  vi.doUnmock('../tmux.js');
  vi.doUnmock('../workspace/stack-health.js');
  vi.doUnmock('../beads-query.js');
  vi.doUnmock('../activity-logger.js');
  vi.doUnmock('../cloister/work-agent-prompt.js');
  vi.doUnmock('../config-yaml.js');
  vi.doUnmock('../claude-auth.js');
  vi.doUnmock('../projects.js');
  delete process.env.PANOPTICON_HOME;
  delete process.env.PAN_DOCKER;
  delete process.env.PANOPTICON_DOCKER_WORKSPACE;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(packageRootDir, { recursive: true, force: true });
});

describe('spawnAgent PTY supervisor wiring', () => {
  it('decides supervisor eligibility from Docker and harness only', async () => {
    const { decideSupervisorForWorkAgent } = await import('../agents.js');

    expect(decideSupervisorForWorkAgent('agent-pan-1405', {} as any, baseState())).toEqual({ eligible: true });

    process.env.PAN_DOCKER = '1';
    expect(decideSupervisorForWorkAgent('agent-pan-1405', {} as any, baseState())).toEqual({
      eligible: false,
      reason: 'docker-not-supported-yet',
    });
    delete process.env.PAN_DOCKER;

    process.env.PANOPTICON_DOCKER_WORKSPACE = '1';
    expect(decideSupervisorForWorkAgent('agent-pan-1405', {} as any, baseState())).toEqual({
      eligible: false,
      reason: 'docker-not-supported-yet',
    });
    delete process.env.PANOPTICON_DOCKER_WORKSPACE;

    expect(decideSupervisorForWorkAgent('agent-pan-1405', {} as any, baseState({ harness: 'pi' }))).toEqual({
      eligible: false,
      reason: 'harness-pi',
    });
  });

  it('persists supervisorEnabled through state read/write', async () => {
    const { getAgentStateSync, saveAgentStateSync } = await import('../agents.js');

    saveAgentStateSync({ ...baseState(), supervisorEnabled: true });

    expect(getAgentStateSync('agent-pan-1405')?.supervisorEnabled).toBe(true);
  });

  it('writes pty-token, skips Channels MCP by default, persists supervisorEnabled, and wraps the launcher', async () => {
    const supervisorScriptPath = writeSupervisorArtifact();
    const { spawnAgent } = await import('../agents.js');

    const state = await spawnAgent({
      issueId: 'PAN-1405',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
    });

    const agentDir = join(tmpHome, 'agents', 'agent-pan-1405');
    const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');
    const persisted = JSON.parse(readFileSync(join(agentDir, 'state.json'), 'utf8'));
    expect(existsSync(join(agentDir, 'pty-token'))).toBe(true);
    expect(existsSync(join(workspace, '.pan', 'agent-mcp.json'))).toBe(false);
    expect(existsSync(join(tmpHome, 'bridge-tokens', 'agent-pan-1405.token'))).toBe(false);
    expect(state.supervisorEnabled).toBe(true);
    expect(state.channelsEnabled).toBeUndefined();
    expect(persisted.supervisorEnabled).toBe(true);
    expect(persisted.channelsEnabled).toBeUndefined();
    expect(launcher).toContain(`exec node '${supervisorScriptPath}' claude`);
    expect(launcher).not.toContain('--mcp-config');
    expect(launcher).not.toContain('--dangerously-load-development-channels');
    expect(sendRawKeystrokeMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledWith(
      'agent-pan-1405',
      workspace,
      `bash ${join(agentDir, 'launcher.sh')}`,
      expect.any(Object),
    );
  });

  it('writes Channels MCP config and bridge token when the MCP override is enabled', async () => {
    vi.useFakeTimers();
    try {
      channelsMcpEnabled = true;
      capturePaneText = 'WARNING: Loading development channels';
      writeSupervisorArtifact();
      const { spawnAgent } = await import('../agents.js');

      const state = await spawnAgent({
        issueId: 'PAN-1405',
        workspace,
        role: 'work',
        model: 'claude-sonnet-4-6',
      });

      const agentDir = join(tmpHome, 'agents', 'agent-pan-1405');
      const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');
      const persisted = JSON.parse(readFileSync(join(agentDir, 'state.json'), 'utf8'));
      await Promise.resolve();
      await Promise.resolve();
      expect(existsSync(join(workspace, '.pan', 'agent-mcp.json'))).toBe(true);
      expect(existsSync(join(tmpHome, 'bridge-tokens', 'agent-pan-1405.token'))).toBe(true);
      expect(state.channelsEnabled).toBe(true);
      expect(persisted.channelsEnabled).toBe(true);
      expect(launcher).toContain(`--mcp-config '${join(workspace, '.pan', 'agent-mcp.json')}'`);
      expect(launcher).toContain('--dangerously-load-development-channels');
      expect(sendRawKeystrokeMock).toHaveBeenCalledWith(
        'agent-pan-1405',
        'C-m',
        'channels:dismiss-dev-dialog',
      );
      capturePaneText = '';
      await vi.advanceTimersByTimeAsync(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails before launcher or tmux creation when the supervisor artifact is missing', async () => {
    const { spawnAgent } = await import('../agents.js');

    await expect(spawnAgent({
      issueId: 'PAN-1405',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
    })).rejects.toThrow('pty-supervisor build artifact missing — run `npm run build`.');

    const agentDir = join(tmpHome, 'agents', 'agent-pan-1405');
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(existsSync(join(agentDir, 'launcher.sh'))).toBe(false);
    expect(existsSync(join(agentDir, 'pty-token'))).toBe(false);
  });
});
