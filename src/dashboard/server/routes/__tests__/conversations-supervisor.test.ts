import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This file dynamically imports the full conversations route module in each test.
// Under the full suite's parallel build/test load, those imports can exceed the
// default 5s timeout even though each assertion path is fast once loaded.
vi.setConfig({ testTimeout: 20_000 });
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let panopticonHome: string;
let channelsEnabled = false;
let createSupervisorSocket = false;
let dismissDevChannelsDialogMock: ReturnType<typeof vi.fn>;
let createSessionCalls: Array<{ session: string; command: string }> = [];

vi.mock('../../../../lib/agents.js', () => {
  dismissDevChannelsDialogMock = vi.fn().mockResolvedValue(undefined);
  return {
    deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
    writeChannelsBridgeMcpConfig: vi.fn().mockResolvedValue(undefined),
    dismissDevChannelsDialog: dismissDevChannelsDialogMock,
    clearReadySignal: vi.fn(),
    waitForReadySignal: vi.fn().mockResolvedValue(true),
    getAgentRuntimeBaseCommand: vi.fn().mockResolvedValue('claude --model claude-sonnet-4-6'),
    getProviderExportsForModel: vi.fn().mockResolvedValue(''),
    getProviderEnvForModel: vi.fn().mockResolvedValue({}),
    getProviderAuthMode: vi.fn().mockResolvedValue('anthropic'),
  };
});

vi.mock('../../../../lib/config-yaml.js', () => ({
  isClaudeCodeChannelsEnabled: vi.fn(() => channelsEnabled),
  loadConfigSync: vi.fn(() => ({
    config: {
      conversations: {
        titleModel: 'claude-haiku-4-5',
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'panopticon-native',
        richCompaction: false,
      },
      codex: { permissionMode: 'workspace' },
    },
  })),
}));

vi.mock('../../../../lib/providers.js', () => ({
  getProviderForModelSync: vi.fn(() => ({ name: 'anthropic' })),
  piProviderForModel: vi.fn(() => 'anthropic'),
  qualifyPiModel: vi.fn((m: string) => m),
}));

vi.mock('../../../../lib/workspace-manager.js', () => ({
  preTrustDirectory: vi.fn(),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  sendRawKeystroke: vi.fn(),
  MessageDeliveryFailed: class MessageDeliveryFailed extends Error {},
  capturePane: vi.fn(() => Effect.succeed('')),
  sessionExists: vi.fn(() => Effect.succeed(true)),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  createSession: vi.fn((session: string, _cwd: string, command: string) => Effect.sync(() => {
    createSessionCalls.push({ session, command });
    if (createSupervisorSocket) {
      const socketDir = join(panopticonHome, 'sockets');
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      const socketPath = join(socketDir, `pty-${session}.sock`);
      writeFileSync(socketPath, '');
      chmodSync(socketPath, 0o600);
    }
  })),
  setOption: vi.fn(() => Effect.succeed(undefined)),
  exactPaneTarget: vi.fn((name: string) => `=${name}:`),
  waitForClaudePrompt: vi.fn(() => Effect.succeed(Promise.resolve(true))),
  listSessionNames: vi.fn(() => Effect.succeed([])),
}));

function conversationDir(session: string): string {
  return join(panopticonHome, 'conversations', session);
}

function launcherFor(session: string): string {
  return readFileSync(join(conversationDir(session), 'launcher.sh'), 'utf8');
}

function cleanupSession(session: string): void {
  rmSync(conversationDir(session), { recursive: true, force: true });
  rmSync(join(panopticonHome, 'agents', session), { recursive: true, force: true });
  rmSync(join(panopticonHome, 'sockets', `pty-${session}.sock`), { force: true });
}

describe('spawnConversationSession PTY supervisor wiring', () => {
  beforeEach(() => {
    panopticonHome = join(tmpdir(), `pan-conv-supervisor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = panopticonHome;
    channelsEnabled = false;
    dismissDevChannelsDialogMock?.mockClear();
    delete process.env.PAN_DOCKER;
    delete process.env.OVERDECK_DOCKER_WORKSPACE;
    createSupervisorSocket = false;
    createSessionCalls = [];
  });

  afterEach(() => {
    for (const call of createSessionCalls) cleanupSession(call.session);
    rmSync(panopticonHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
    delete process.env.PAN_DOCKER;
    delete process.env.OVERDECK_DOCKER_WORKSPACE;
  });

  it('wraps Claude Code conversations with the PTY supervisor and waits for its socket', async () => {
    createSupervisorSocket = true;
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-supervisor-test',
      tmpdir(),
      'session-supervisor-test',
      'claude-sonnet-4-6',
      undefined,
      'PAN-1405',
      false,
      'claude-code',
    );

    const launcher = launcherFor('conv-supervisor-test');
    expect(launcher).toContain("export OVERDECK_AGENT_ID='conv-supervisor-test'");
    expect(launcher).toContain("node '");
    expect(launcher).toContain("/dist/pty-supervisor.js' claude --model claude-sonnet-4-6");
    expect(existsSync(join(panopticonHome, 'agents', 'conv-supervisor-test', 'pty-token'))).toBe(true);
    expect((statSync(join(panopticonHome, 'sockets', 'pty-conv-supervisor-test.sock')).mode & 0o777)).toBe(0o600);
    expect(dismissDevChannelsDialogMock).not.toHaveBeenCalled();
  });

  it('wraps Codex TUI conversations with the PTY supervisor and waits for its socket', async () => {
    createSupervisorSocket = true;
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-codex-supervisor-test',
      tmpdir(),
      'session-codex-supervisor-test',
      'gpt-5.5',
      undefined,
      'PAN-1405',
      false,
      'codex',
    );

    const launcher = launcherFor('conv-codex-supervisor-test');
    expect(launcher).toContain("export OVERDECK_AGENT_ID='conv-codex-supervisor-test'");
    expect(launcher).toContain(`export CODEX_HOME='${join(panopticonHome, 'agents', 'conv-codex-supervisor-test', 'codex-home')}'`);
    expect(launcher).toContain("node '");
    expect(launcher).toContain("/dist/pty-supervisor.js' codex");
    expect(existsSync(join(panopticonHome, 'agents', 'conv-codex-supervisor-test', 'pty-token'))).toBe(true);
    expect((statSync(join(panopticonHome, 'sockets', 'pty-conv-codex-supervisor-test.sock')).mode & 0o777)).toBe(0o600);
    expect(dismissDevChannelsDialogMock).not.toHaveBeenCalled();
  });

  it('resumes Codex TUI conversations with the persisted thread id', async () => {
    createSupervisorSocket = true;
    const session = 'conv-codex-resume-supervisor-test';
    const threadId = '019eaaec-4dfa-7ab1-90ba-9104d16534d1';
    const agentDir = join(panopticonHome, 'agents', session);
    const dayDir = join(agentDir, 'codex-home', 'sessions', '2026', '06', '14');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, `rollout-2026-06-14T10-00-00-${threadId}.jsonl`), '{"type":"session_meta"}\n');

    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      session,
      tmpdir(),
      'ignored-claude-session-id',
      'gpt-5.5',
      undefined,
      'PAN-1405',
      true,
      'codex',
    );

    const launcher = launcherFor(session);
    expect(launcher).toContain(`/dist/pty-supervisor.js' codex resume -c project_doc_max_bytes=0 '${threadId}'`);
    expect(launcher).not.toContain('codex exec resume');
  });

  it('keeps plain forks off Channels MCP while routing them through the supervisor', async () => {
    channelsEnabled = true;
    createSupervisorSocket = true;
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-plain-fork-test',
      tmpdir(),
      'session-plain-fork-test',
      'claude-sonnet-4-6',
      undefined,
      'PAN-1405',
      true,
      'claude-code',
      true,
    );

    const launcher = launcherFor('conv-plain-fork-test');
    expect(launcher).toContain('pty-supervisor.js');
    expect(launcher).not.toContain('--mcp-config');
    expect(launcher).not.toContain('--dangerously-load-development-channels');
    expect(dismissDevChannelsDialogMock).not.toHaveBeenCalled();
  });

  it('dismisses the dev-channels dialog only when Channels MCP is wired', async () => {
    channelsEnabled = true;
    createSupervisorSocket = true;
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-channels-test',
      tmpdir(),
      'session-channels-test',
      'claude-sonnet-4-6',
      undefined,
      'PAN-1405',
      false,
      'claude-code',
    );

    expect(launcherFor('conv-channels-test')).toContain('--dangerously-load-development-channels');
    expect(dismissDevChannelsDialogMock).toHaveBeenCalledWith('conv-channels-test');
  });

  it('does not wrap Pi conversations with the PTY supervisor', async () => {
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-pi-test',
      tmpdir(),
      'session-pi-test',
      'claude-sonnet-4-6',
      undefined,
      'PAN-1405',
      false,
      'pi',
    );

    const launcher = launcherFor('conv-pi-test');
    expect(launcher).not.toContain('pty-supervisor.js');
    expect(existsSync(join(panopticonHome, 'agents', 'conv-pi-test', 'pty-token'))).toBe(false);
  });

  it('does not wrap Docker conversations with the PTY supervisor', async () => {
    process.env.PAN_DOCKER = '1';
    const { spawnConversationSession } = await import('../conversations.js');

    await spawnConversationSession(
      'conv-docker-test',
      tmpdir(),
      'session-docker-test',
      'claude-sonnet-4-6',
      undefined,
      'PAN-1405',
      false,
      'claude-code',
    );

    const launcher = launcherFor('conv-docker-test');
    expect(launcher).not.toContain('pty-supervisor.js');
    expect(existsSync(join(panopticonHome, 'agents', 'conv-docker-test', 'pty-token'))).toBe(false);
  });
});
