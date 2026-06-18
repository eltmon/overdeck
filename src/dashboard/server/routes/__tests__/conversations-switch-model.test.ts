import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const {
  capturePaneMock,
  createSessionMock,
  deliverAgentMessageMock,
  getProviderExportsForModelMock,
  getProviderAuthModeMock,
  killSessionMock,
} = vi.hoisted(() => ({
  capturePaneMock: vi.fn(),
  createSessionMock: vi.fn(),
  deliverAgentMessageMock: vi.fn(),
  getProviderExportsForModelMock: vi.fn(),
  getProviderAuthModeMock: vi.fn(),
  killSessionMock: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', () => ({
  deliverAgentMessage: deliverAgentMessageMock,
  writeChannelsBridgeMcpConfig: vi.fn().mockResolvedValue(undefined),
  dismissDevChannelsDialog: vi.fn().mockResolvedValue(undefined),
  clearReadySignal: vi.fn(),
  waitForReadySignal: vi.fn().mockResolvedValue(true),
  getAgentRuntimeBaseCommand: vi.fn().mockResolvedValue('claude --model claude-fable-5'),
  getProviderExportsForModel: getProviderExportsForModelMock,
  getProviderEnvForModel: vi.fn().mockResolvedValue({}),
  getProviderAuthMode: getProviderAuthModeMock,
}));

vi.mock('../../../../lib/config-yaml.js', () => ({
  isClaudeCodeChannelsEnabled: vi.fn(() => false),
  loadConfigSync: vi.fn(() => ({
    config: {
      conversations: {
        titleModel: 'claude-haiku-4-5',
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'panopticon-native',
        richCompaction: false,
      },
    },
  })),
}));

vi.mock('../../../../lib/background-ai/features.js', () => ({
  isBackgroundFeatureEnabled: vi.fn((feature: string) => feature === 'summaryFork'),
}));

vi.mock('../../../../lib/conversations/smart-compaction.js', () => ({
  generateSmartSummary: vi.fn(() => Effect.succeed({
    summary: 'Mocked compact summary for switch-model coverage.',
    summaryModel: 'claude-haiku-4-5',
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
  capturePane: capturePaneMock,
  sessionExists: vi.fn(() => Effect.succeed(true)),
  isHarnessProcessAlive: vi.fn(() => Effect.succeed(true)),
  killSession: killSessionMock,
  createSession: createSessionMock,
  setOption: vi.fn(() => Effect.succeed(undefined)),
  exactPaneTarget: vi.fn((name: string) => `=${name}:`),
  listSessionNames: vi.fn(() => Effect.succeed([])),
}));

let testHome: string;
let originalHome: string | undefined;

function decodeJsonResponse(response: { status: number; body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function postSwitchModel(conversationName: string, body: Record<string, unknown>) {
  const { conversationsRouteLayer } = await import('../conversations.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/conversations/${conversationName}/switch-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3011' },
    body: JSON.stringify(body),
  }));

  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
}

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

describe('POST /api/conversations/:name/switch-model', () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.resetModules();

    testHome = join(tmpdir(), `pan-switch-model-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = testHome;
    process.env.PANOPTICON_HOME = join(testHome, '.panopticon');
    mkdirSync(process.env.PANOPTICON_HOME, { recursive: true });

    capturePaneMock.mockImplementation(() => Effect.succeed('Claude Fable 5 (claude-fable-5)\nctx 21%  cost $0.0000'));
    deliverAgentMessageMock.mockResolvedValue({ ok: true, path: 'supervisor' });
    getProviderExportsForModelMock.mockResolvedValue('');
    getProviderAuthModeMock.mockResolvedValue('anthropic');
    killSessionMock.mockImplementation(() => Effect.succeed(undefined));
    createSessionMock.mockImplementation((session: string) => Effect.sync(() => {
      const socketDir = join(process.env.PANOPTICON_HOME!, 'sockets');
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      const socketPath = join(socketDir, `pty-${session}.sock`);
      writeFileSync(socketPath, '');
      chmodSync(socketPath, 0o600);
    }));
  });

  afterEach(async () => {
    await resetDb();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.PANOPTICON_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('does not append a compact boundary for a 206k-token same-harness switch that fits the inferred target window', async () => {
    const cwd = join(testHome, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const sessionId = '206k-session';
    const sessionFile = sessionFilePath(cwd, sessionId);
    mkdirSync(join(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Keep all of this context' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-10T00:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Still in context' }],
          usage: { input_tokens: 206_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');

    createConversation({
      name: 'switch-regression',
      tmuxSession: 'conv-switch-regression',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      claudeSessionId: sessionId,
    });

    const response = await postSwitchModel('switch-regression', { model: 'claude-fable-5' });

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toMatchObject({
      model: 'claude-fable-5',
      harness: 'claude-code',
      sessionAlive: true,
    });
    expect(deliverAgentMessageMock).toHaveBeenCalledWith(
      'conv-switch-regression',
      '/model claude-fable-5',
      'conversation-switch-model',
      'auto',
    );
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(readFileSync(sessionFile, 'utf8')).not.toContain('"subtype":"compact_boundary"');
  });

  it('falls back to respawn when Tier 1 delivery fails', async () => {
    deliverAgentMessageMock.mockRejectedValueOnce(new Error('MessageDeliveryFailed: socket missing'));
    const cwd = join(testHome, 'fallback-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const sessionId = 'fallback-session';
    const sessionFile = sessionFilePath(cwd, sessionId);
    mkdirSync(join(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Keep context' }] } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-10T00:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Still in context' }],
          usage: { input_tokens: 206_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');

    createConversation({
      name: 'switch-fallback',
      tmuxSession: 'conv-switch-fallback',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      claudeSessionId: sessionId,
    });

    const response = await postSwitchModel('switch-fallback', { model: 'claude-fable-5' });

    expect(response.status).toBe(200);
    expect(killSessionMock).toHaveBeenCalledWith('conv-switch-fallback');
    expect(createSessionMock).toHaveBeenCalled();
    expect(readFileSync(sessionFile, 'utf8')).not.toContain('"subtype":"compact_boundary"');
  });

  it('keeps default-model Anthropic switches in Tier 1 when provider exports only unset env', async () => {
    getProviderExportsForModelMock.mockResolvedValue([
      'unset ANTHROPIC_BASE_URL',
      'unset ANTHROPIC_AUTH_TOKEN',
      'unset OPENAI_API_KEY',
    ].join('\n') + '\n');
    const cwd = join(testHome, 'default-model-anthropic-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const sessionId = 'default-model-anthropic-session';
    const sessionFile = sessionFilePath(cwd, sessionId);
    mkdirSync(join(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Default Anthropic conversation' }] } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-10T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Still in context' }],
          usage: { input_tokens: 206_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');

    createConversation({
      name: 'switch-default-anthropic',
      tmuxSession: 'conv-switch-default-anthropic',
      cwd,
      model: null,
      harness: 'claude-code',
      claudeSessionId: sessionId,
    });

    const response = await postSwitchModel('switch-default-anthropic', { model: 'claude-fable-5' });

    expect(response.status).toBe(200);
    expect(deliverAgentMessageMock).toHaveBeenCalledWith(
      'conv-switch-default-anthropic',
      '/model claude-fable-5',
      'conversation-switch-model',
      'auto',
    );
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(readFileSync(sessionFile, 'utf8')).not.toContain('"subtype":"compact_boundary"');
  });

  it('respawns default-model conversations when switching to a routed provider target', async () => {
    getProviderExportsForModelMock.mockImplementation(async (model: string) => (
      model === 'gpt-5.5' ? 'export ANTHROPIC_BASE_URL=http://127.0.0.1:4545\nexport ANTHROPIC_AUTH_TOKEN=proxy-token' : ''
    ));
    const cwd = join(testHome, 'default-model-routed-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const sessionId = 'default-model-routed-session';
    const sessionFile = sessionFilePath(cwd, sessionId);
    mkdirSync(join(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Default model conversation' }] } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-10T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Small context' }],
          usage: { input_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');

    createConversation({
      name: 'switch-default-routed',
      tmuxSession: 'conv-switch-default-routed',
      cwd,
      model: null,
      harness: 'claude-code',
      claudeSessionId: sessionId,
    });

    const response = await postSwitchModel('switch-default-routed', { model: 'gpt-5.5' });

    expect(response.status).toBe(200);
    expect(deliverAgentMessageMock).not.toHaveBeenCalled();
    expect(killSessionMock).toHaveBeenCalledWith('conv-switch-default-routed');
    expect(createSessionMock).toHaveBeenCalled();
    expect(readFileSync(sessionFile, 'utf8')).not.toContain('"subtype":"compact_boundary"');
  });

  it('does not treat an echoed /model command as Tier 1 statusline confirmation', async () => {
    vi.useFakeTimers();
    try {
      capturePaneMock.mockImplementation(() => Effect.succeed([
        '/model claude-fable-5',
        'error: failed to switch to Claude Fable 5',
        'Claude Opus 4.8 (claude-opus-4-8)',
        'ctx 10% cost $0.0000',
      ].join('\n')));
      const cwd = join(testHome, 'echo-workspace');
      mkdirSync(cwd, { recursive: true });

      const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
      const { sessionFilePath } = await import('../../../../lib/paths.js');
      const sessionId = 'echo-session';
      const sessionFile = sessionFilePath(cwd, sessionId);
      mkdirSync(join(sessionFile, '..'), { recursive: true });
      writeFileSync(sessionFile, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Keep context' }] } }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-06-10T00:00:00.000Z',
          message: {
            role: 'assistant',
            model: 'claude-opus-4-8',
            content: [{ type: 'text', text: 'Still in context' }],
            usage: { input_tokens: 206_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
      ].join('\n') + '\n');

      createConversation({
        name: 'switch-echo',
        tmuxSession: 'conv-switch-echo',
        cwd,
        model: 'claude-opus-4-8',
        harness: 'claude-code',
        claudeSessionId: sessionId,
      });

      const responsePromise = postSwitchModel('switch-echo', { model: 'claude-fable-5' });
      await vi.waitFor(() => {
        expect(capturePaneMock).toHaveBeenCalled();
      });
      await vi.advanceTimersByTimeAsync(5_500);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(deliverAgentMessageMock).toHaveBeenCalledWith(
        'conv-switch-echo',
        '/model claude-fable-5',
        'conversation-switch-model',
        'auto',
      );
      expect(killSessionMock).toHaveBeenCalledWith('conv-switch-echo');
      expect(createSessionMock).toHaveBeenCalled();
      expect(readFileSync(sessionFile, 'utf8')).not.toContain('"subtype":"compact_boundary"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('compacts to a forked session file when the same-harness switch exceeds the target window threshold', async () => {
    const cwd = join(testHome, 'over-window-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const sessionId = 'over-window-session';
    const sessionFile = sessionFilePath(cwd, sessionId);
    mkdirSync(join(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Too much context' }] } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-10T00:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Large context still in transcript' }],
          usage: { input_tokens: 900_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');

    createConversation({
      name: 'switch-over-window',
      tmuxSession: 'conv-switch-over-window',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      claudeSessionId: sessionId,
    });

    const response = await postSwitchModel('switch-over-window', { model: 'claude-fable-5' });

    expect(response.status).toBe(200);
    expect(deliverAgentMessageMock).not.toHaveBeenCalled();
    expect(killSessionMock).toHaveBeenCalledWith('conv-switch-over-window');
    expect(createSessionMock).toHaveBeenCalled();

    // Sacred-file invariant: original session file must NOT be modified
    const originalContent = readFileSync(sessionFile, 'utf8');
    expect(originalContent).not.toContain('"subtype":"compact_boundary"');

    // Fork file (new UUID.jsonl in same sessions directory) must contain the compact boundary
    const sessionsDir = join(sessionFile, '..');
    const forkFiles = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl') && f !== `${sessionId}.jsonl`);
    expect(forkFiles).toHaveLength(1);
    const forkContent = readFileSync(join(sessionsDir, forkFiles[0]), 'utf8');
    expect(forkContent).toContain('"subtype":"compact_boundary"');
    expect(forkContent).toContain('"preTokens":900000');
  });
});
