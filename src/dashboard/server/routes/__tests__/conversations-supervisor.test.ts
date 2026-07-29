import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This file dynamically imports the full conversations route module in each test.
// Under the full suite's parallel build/test load, those imports can exceed the
// default 5s timeout even though each assertion path is fast once loaded.
vi.setConfig({ testTimeout: 20_000 });
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

let overdeckHome: string;
let channelsEnabled = false;
let createSupervisorSocket = false;
let createAcpHostArtifacts = false;
let resolvedHarnessBinary: string | null = '/usr/bin/claude';
let resolvedConversationHarness = 'claude-code';
let resolvedProviderName = 'anthropic';
let deliveryResult: { ok: boolean; path?: string; failure?: string } = { ok: true, path: 'supervisor' };
let listedSessionNames: string[] = [];
let dismissDevChannelsDialogMock: ReturnType<typeof vi.fn>;
let createSessionCalls: Array<{ session: string; command: string }> = [];

vi.mock('../../../../lib/agents.js', () => {
  dismissDevChannelsDialogMock = vi.fn().mockResolvedValue(undefined);
  return {
    deliverAgentMessage: vi.fn(async () => deliveryResult),
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

vi.mock('../../../../lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn(async (harness: string) => {
    if (!resolvedHarnessBinary) {
      const name = harness === 'claude-code' ? 'Claude Code' : harness === 'ohmypi' ? 'OhMyPi' : 'Codex CLI';
      throw new Error(
        `${name} executable was not found. Install ${name} or add its installation directory to PATH, then restart Overdeck. No terminal session was created.`,
      );
    }
    const directory = dirname(resolvedHarnessBinary);
    return {
      binaryPath: resolvedHarnessBinary,
      pathExport: `export PATH='${directory}':"$PATH"`,
    };
  }),
}));

vi.mock('../../../../lib/config-yaml.js', () => ({
  isClaudeCodeChannelsEnabled: vi.fn(() => channelsEnabled),
  loadConfigSync: vi.fn(() => ({
    config: {
      conversations: {
        titleModel: 'claude-haiku-4-5',
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'overdeck-native',
        richCompaction: false,
      },
      codex: { permissionMode: 'workspace' },
    },
  })),
}));

vi.mock('../../../../lib/providers.js', () => ({
  UnknownModelError: class UnknownModelError extends Error {},
  getProviderForModelSync: vi.fn(() => ({ name: resolvedProviderName })),
  piProviderForModel: vi.fn(() => 'anthropic'),
  qualifyPiModel: vi.fn((m: string) => m),
}));

vi.mock('../../../../lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(async () => resolvedConversationHarness),
}));

vi.mock('../../../../lib/workspace-manager.js', () => ({
  preTrustDirectory: vi.fn(),
}));

vi.mock('../../event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
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
      const socketDir = join(overdeckHome, 'sockets');
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      const socketPath = join(socketDir, `pty-${session}.sock`);
      writeFileSync(socketPath, '');
      chmodSync(socketPath, 0o600);
    }
    if (createAcpHostArtifacts) {
      const agentDir = join(overdeckHome, 'agents', session);
      const socketDir = join(overdeckHome, 'sockets');
      mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(agentDir, 'acp-session-id'), 'fresh-acp-session\n', { mode: 0o600 });
      writeFileSync(join(agentDir, 'acp-token'), 'test-token\n', { mode: 0o600 });
      writeFileSync(join(socketDir, `acp-${session}.sock`), '', { mode: 0o600 });
    }
  })),
  setOption: vi.fn(() => Effect.succeed(undefined)),
  exactPaneTarget: vi.fn((name: string) => `=${name}:`),
  waitForClaudePrompt: vi.fn(() => Effect.succeed(Promise.resolve(true))),
  listSessionNames: vi.fn(() => Effect.succeed(listedSessionNames)),
}));

function conversationDir(session: string): string {
  return join(overdeckHome, 'conversations', session);
}

function launcherFor(session: string): string {
  return readFileSync(join(conversationDir(session), 'launcher.sh'), 'utf8');
}

function cleanupSession(session: string): void {
  rmSync(conversationDir(session), { recursive: true, force: true });
  rmSync(join(overdeckHome, 'agents', session), { recursive: true, force: true });
  rmSync(join(overdeckHome, 'sockets', `pty-${session}.sock`), { force: true });
  rmSync(join(overdeckHome, 'sockets', `acp-${session}.sock`), { force: true });
}

function ensurePtySupervisorBuildArtifact(): void {
  const supervisorDistPath = join(process.cwd(), 'dist', 'pty-supervisor.js');
  if (existsSync(supervisorDistPath)) return;
  mkdirSync(dirname(supervisorDistPath), { recursive: true });
  writeFileSync(supervisorDistPath, '#!/usr/bin/env node\n');
}

function decodeJsonResponse(response: { body: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function resetConversationDb(): Promise<void> {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

describe('spawnConversationSession PTY supervisor wiring', () => {
  beforeEach(() => {
    ensurePtySupervisorBuildArtifact();
    overdeckHome = join(tmpdir(), `pan-conv-supervisor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = overdeckHome;
    channelsEnabled = false;
    dismissDevChannelsDialogMock?.mockClear();
    delete process.env.PAN_DOCKER;
    delete process.env.OVERDECK_DOCKER_WORKSPACE;
    createSupervisorSocket = false;
    createAcpHostArtifacts = false;
    resolvedHarnessBinary = '/usr/bin/claude';
    resolvedConversationHarness = 'claude-code';
    resolvedProviderName = 'anthropic';
    deliveryResult = { ok: true, path: 'supervisor' };
    listedSessionNames = [];
    createSessionCalls = [];
  });

  afterEach(async () => {
    await resetConversationDb();
    for (const call of createSessionCalls) cleanupSession(call.session);
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
    delete process.env.PAN_DOCKER;
    delete process.env.OVERDECK_DOCKER_WORKSPACE;
  });

  it('launches a PATH-invisible Claude binary through the shared resolver', async () => {
    createSupervisorSocket = true;
    resolvedHarnessBinary = '/home/test/.local/bin/claude';
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    expect(launcher).toContain("export PATH='/home/test/.local/bin':\"$PATH\"");
    expect(launcher).toContain("export OVERDECK_AGENT_ID='conv-supervisor-test'");
    expect(launcher).toContain("node '");
    expect(launcher).toContain("/dist/pty-supervisor.js' claude --model claude-sonnet-4-6");
    expect(existsSync(join(overdeckHome, 'agents', 'conv-supervisor-test', 'pty-token'))).toBe(true);
    expect((statSync(join(overdeckHome, 'sockets', 'pty-conv-supervisor-test.sock')).mode & 0o777)).toBe(0o600);
    expect(dismissDevChannelsDialogMock).not.toHaveBeenCalled();
  });

  it('reports a missing harness before creating a tmux session', async () => {
    resolvedHarnessBinary = null;
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

    let error: unknown;
    try {
      await spawnConversationSession(
        'conv-missing-harness-test',
        tmpdir(),
        'session-missing-harness-test',
        'claude-sonnet-4-6',
        undefined,
        'PAN-2869',
        false,
        'claude-code',
      );
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Install Claude Code or add its installation directory to PATH');
    expect((error as Error).message).not.toContain('execvp');
    expect(createSessionCalls).toEqual([]);
    expect(existsSync(conversationDir('conv-missing-harness-test'))).toBe(false);
  });

  it('launches Codex app-server conversations without the PTY supervisor', async () => {
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    expect(launcher).toContain(`export CODEX_HOME='${join(overdeckHome, 'agents', 'conv-codex-supervisor-test', 'codex-home')}'`);
    expect(launcher).toContain("node '");
    expect(launcher).toContain("/dist/codex-app-server-host.js'");
    expect(launcher).not.toContain('pty-supervisor.js');
    expect(existsSync(join(overdeckHome, 'agents', 'conv-codex-supervisor-test', 'pty-token'))).toBe(false);
    expect(existsSync(join(overdeckHome, 'sockets', 'pty-conv-codex-supervisor-test.sock'))).toBe(false);
    expect(dismissDevChannelsDialogMock).not.toHaveBeenCalled();
  });

  it('resumes Codex app-server conversations with the persisted thread id', async () => {
    createSupervisorSocket = true;
    const session = 'conv-codex-resume-supervisor-test';
    const threadId = '019eaaec-4dfa-7ab1-90ba-9104d16534d1';
    const agentDir = join(overdeckHome, 'agents', session);
    const dayDir = join(agentDir, 'codex-home', 'sessions', '2026', '06', '14');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, `rollout-2026-06-14T10-00-00-${threadId}.jsonl`), '{"type":"session_meta"}\n');

    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    expect(launcher).toContain(`/dist/codex-app-server-host.js' --model 'gpt-5.5' --resume '${threadId}'`);
    expect(launcher).not.toContain('pty-supervisor.js');
    expect(launcher).not.toContain('codex exec resume');
  });

  it('keeps plain forks off Channels MCP while routing them through the supervisor', async () => {
    channelsEnabled = true;
    createSupervisorSocket = true;
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    expect(existsSync(join(overdeckHome, 'agents', 'conv-pi-test', 'pty-token'))).toBe(false);
  });

  it('does not wrap Docker conversations with the PTY supervisor', async () => {
    process.env.PAN_DOCKER = '1';
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

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
    expect(existsSync(join(overdeckHome, 'agents', 'conv-docker-test', 'pty-token'))).toBe(false);
  });

  it('launches ACP conversations through the package host with the exact Kimi executable', async () => {
    channelsEnabled = true;
    createAcpHostArtifacts = true;
    resolvedHarnessBinary = '/opt/kimi code/bin/kimi';
    resolvedProviderName = 'kimi';
    const session = 'conv-acp-test';
    const agentDir = join(overdeckHome, 'agents', session);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'acp-session-id'), 'persisted-acp-session\n');
    const agents = await import('../../../../lib/agents.js');
    vi.mocked(agents.writeChannelsBridgeMcpConfig).mockClear();
    const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

    await spawnConversationSession(
      session,
      tmpdir(),
      'claude-shaped-session-id',
      'kimi-k2.7-code',
      'high',
      'PAN-2858',
      true,
      'acp',
    );

    const launcher = launcherFor(session);
    expect(launcher).toContain(`${process.cwd()}/dist/acp-host.js`);
    expect(launcher).toContain("--binary-path '/opt/kimi code/bin/kimi'");
    expect(launcher).toContain("--resume 'persisted-acp-session'");
    expect(launcher).toContain(`export OVERDECK_AGENT_ID='${session}'`);
    expect(launcher).not.toContain('pty-supervisor.js');
    expect(launcher).not.toContain('--mcp-config');
    expect(launcher).not.toContain('--session-id');
    expect(launcher).not.toContain('--effort');
    expect(launcher).not.toContain('claude-shaped-session-id');
    expect(readFileSync(join(agentDir, 'acp-session-id'), 'utf8').trim()).toBe('fresh-acp-session');
    expect(existsSync(join(agentDir, 'pty-token'))).toBe(false);
    expect(agents.writeChannelsBridgeMcpConfig).not.toHaveBeenCalled();
  });

  it('resumes a stopped Kimi Code conversation with -S <captured-id> and does not pin a new session (PAN-1837)', async () => {
    createSupervisorSocket = true;
    resolvedHarnessBinary = '/opt/kimi/bin/kimi';
    resolvedProviderName = 'kimi';
    const session = 'conv-kimi-resume-test';
    const workspace = tmpdir();
    const pinnedSessionId = 'pinned-kimi-session-abc';
    const previousHome = process.env.HOME;
    process.env.HOME = overdeckHome;

    try {
      const { kimiSessionsRoot } = await import('../../../../lib/runtimes/kimi-code.js');
      const kimiHome = join(overdeckHome, '.kimi-code');
      const wireDir = join(kimiSessionsRoot(kimiHome, workspace), pinnedSessionId, 'agents', 'main');
      mkdirSync(wireDir, { recursive: true });
      writeFileSync(join(wireDir, 'wire.jsonl'), '{"type":"metadata"}\n');
      const agentDir = join(overdeckHome, 'agents', session);
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'kimi-session-id'), `${pinnedSessionId}\n`);
      const bucketDir = kimiSessionsRoot(kimiHome, workspace);
      const entriesBefore = new Set(readdirSync(bucketDir));

      const { spawnConversationSession } = await import('../../../../lib/overdeck/conversation-runtime.js');

      await spawnConversationSession(
        session,
        workspace,
        'ignored-claude-session-id',
        'kimi-code/k3',
        undefined,
        'PAN-1837',
        true,
        'kimi-code',
      );

      const launcher = launcherFor(session);
      expect(launcher).toContain(`-S '${pinnedSessionId}'`);
      // The point of the fix: a true resume must not snapshot/wait for a new
      // session directory or overwrite the pinned pointer with a fresh one.
      expect(readFileSync(join(agentDir, 'kimi-session-id'), 'utf8').trim()).toBe(pinnedSessionId);
      const entriesAfter = new Set(readdirSync(bucketDir));
      expect(entriesAfter).toEqual(entriesBefore);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it('tears down ACP creation when the initial protocol prompt fails', async () => {
    createAcpHostArtifacts = true;
    resolvedHarnessBinary = '/opt/kimi/bin/kimi';
    resolvedConversationHarness = 'acp';
    resolvedProviderName = 'kimi';
    deliveryResult = { ok: false, path: 'acp', failure: 'provider rejected prompt' };
    const tmux = await import('../../../../lib/tmux.js');
    vi.mocked(tmux.killSession).mockClear();
    const { handleConversationCreate } = await import('../../../../lib/overdeck/conversation-runtime.js');
    const conversations = await import('../../../../lib/overdeck/conversations.js');

    const response = await handleConversationCreate(
      {
        message: 'start the ACP conversation',
        model: 'kimi-k2.7-code',
        harness: 'acp',
      },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );
    const created = decodeJsonResponse(response);
    const name = created['name'] as string;
    const session = created['tmuxSession'] as string;

    await vi.waitFor(() => {
      expect(conversations.getConversationByName(name)?.spawnError).toContain(
        'ACP initial prompt did not land: provider rejected prompt',
      );
    });
    expect(tmux.killSession).toHaveBeenCalledWith(session);
  });

  it('tears down a newly resolved ACP runtime when restart readiness fails', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      resolvedHarnessBinary = '/opt/kimi/bin/kimi';
      resolvedConversationHarness = 'acp';
      resolvedProviderName = 'kimi';
      const name = 'restart-to-acp';
      const session = 'conv-restart-to-acp';
      listedSessionNames = [session];
      const conversations = await import('../../../../lib/overdeck/conversations.js');
      conversations.createConversation({
        name,
        tmuxSession: session,
        cwd: tmpdir(),
        claudeSessionId: 'old-claude-session',
        model: 'kimi-k2.7-code',
        harness: 'claude-code',
      });
      const tmux = await import('../../../../lib/tmux.js');
      vi.mocked(tmux.killSession).mockClear();
      const { handleConversationRestartAll } = await import('../../../../lib/overdeck/conversation-runtime.js');

      const restart = handleConversationRestartAll({
        resolveSessionFile: vi.fn().mockResolvedValue(null),
      });
      await vi.waitFor(() => {
        expect(createSessionCalls.some((call) => call.session === session)).toBe(true);
      });
      await vi.advanceTimersByTimeAsync(30_500);
      const result = decodeJsonResponse(await restart);

      expect(result['results']).toEqual([
        { name, model: 'kimi-k2.7-code', status: 'failed' },
      ]);
      expect(vi.mocked(tmux.killSession).mock.calls.filter(([target]) => target === session)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
