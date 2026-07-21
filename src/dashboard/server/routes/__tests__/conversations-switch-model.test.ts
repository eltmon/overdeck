import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const {
  createSessionMock,
  deliverAgentMessageMock,
  getProviderAuthModeMock,
  killSessionMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deliverAgentMessageMock: vi.fn(),
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
  getProviderExportsForModel: vi.fn().mockResolvedValue(''),
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
        manualCompactMode: 'overdeck-native',
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
  capturePane: vi.fn(() => Effect.succeed('')),
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
    process.env.OVERDECK_HOME = join(testHome, '.overdeck');
    mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

    getProviderAuthModeMock.mockResolvedValue('anthropic');
    killSessionMock.mockImplementation(() => Effect.succeed(undefined));
    createSessionMock.mockImplementation(() => Effect.succeed(undefined));
  });

  afterEach(async () => {
    await resetDb();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.OVERDECK_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('allows a brand-new conversation to choose its model before the first session exists', async () => {
    const cwd = join(testHome, 'fresh-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({
      name: 'fresh-switch',
      tmuxSession: 'conv-fresh-switch',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });

    const response = await postSwitchModel('fresh-switch', { model: 'claude-fable-5', harness: 'claude-code' });

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toMatchObject({
      model: 'claude-fable-5',
      harness: 'claude-code',
      sessionAlive: false,
    });
    expect(getConversationByName('fresh-switch')?.model).toBe('claude-fable-5');
    expect(deliverAgentMessageMock).not.toHaveBeenCalled();
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('rejects a started conversation and does not tear down its session', async () => {
    const cwd = join(testHome, 'started-workspace');
    mkdirSync(cwd, { recursive: true });

    const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({
      name: 'started-switch',
      tmuxSession: 'conv-started-switch',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      claudeSessionId: 'started-session',
    });

    const response = await postSwitchModel('started-switch', { model: 'claude-fable-5' });

    expect(response.status).toBe(409);
    expect(decodeJsonResponse(response).error).toBe('Conversation model is locked once a conversation has started');
    expect(getConversationByName('started-switch')?.model).toBe('claude-opus-4-8');
    expect(deliverAgentMessageMock).not.toHaveBeenCalled();
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('rejects after the first allowed pre-start model choice once a session id is recorded', async () => {
    const cwd = join(testHome, 'post-first-workspace');
    mkdirSync(cwd, { recursive: true });

    const {
      createConversation,
      getConversationByName,
      setConversationClaudeSessionId,
    } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({
      name: 'post-first-switch',
      tmuxSession: 'conv-post-first-switch',
      cwd,
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });

    const freshResponse = await postSwitchModel('post-first-switch', { model: 'claude-fable-5' });
    expect(freshResponse.status).toBe(200);

    setConversationClaudeSessionId('post-first-switch', 'post-first-session');
    const lockedResponse = await postSwitchModel('post-first-switch', { model: 'claude-opus-4-8' });

    expect(lockedResponse.status).toBe(409);
    expect(getConversationByName('post-first-switch')?.model).toBe('claude-fable-5');
    expect(killSessionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
