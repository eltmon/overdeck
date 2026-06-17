import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
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

  it('allows switching the model of a brand-new conversation before the first message', async () => {
    const cwd = join(testHome, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    createConversation({
      name: 'fresh-conversation',
      tmuxSession: 'conv-fresh-conversation',
      cwd,
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
    });

    const response = await postSwitchModel('fresh-conversation', { model: 'claude-fable-5' });

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toMatchObject({
      model: 'claude-fable-5',
      harness: 'claude-code',
    });
    expect(getConversationByName('fresh-conversation')?.model).toBe('claude-fable-5');
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('rejects switching when the conversation already has a session', async () => {
    const cwd = join(testHome, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    createConversation({
      name: 'started-conversation',
      tmuxSession: 'conv-started-conversation',
      cwd,
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
      claudeSessionId: 'started-session',
    });

    const response = await postSwitchModel('started-conversation', { model: 'claude-fable-5' });

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response).error).toMatch(/locked/i);
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('rejects switching when the conversation already has messages', async () => {
    const cwd = join(testHome, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    createConversation({
      name: 'messaged-conversation',
      tmuxSession: 'conv-messaged-conversation',
      cwd,
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
      claudeSessionId: 'messaged-session',
    });

    const response = await postSwitchModel('messaged-conversation', { model: 'claude-fable-5' });

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response).error).toMatch(/locked/i);
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
