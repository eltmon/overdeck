import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compact: vi.fn(),
  deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
  deliverControl: vi.fn().mockResolvedValue(undefined),
  getConversationByName: vi.fn(),
  getHarnessBehavior: vi.fn(() => ({
    injectsPromptTimeMemory: false,
    transcriptKind: 'claude-jsonl',
  })),
  runCapturedCommand: vi.fn(async (argv: readonly string[]) => ({
    kind: 'captured' as const,
    status: 'completed' as const,
    command: `/pan ${argv.join(' ')}`,
    output: 'captured output',
    truncated: false,
  })),
}));

vi.mock('../executors.js', () => ({
  runCapturedCommand: mocks.runCapturedCommand,
}));
vi.mock('../../overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
  setConversationClaudeSessionId: vi.fn(),
  updateConversationTitle: vi.fn(),
}));
vi.mock('../../../dashboard/server/services/conversation-compaction.js', () => ({
  compactConversationNative: mocks.compact,
  shouldInterceptManualCompact: vi.fn(() => false),
}));
vi.mock('../../../dashboard/server/services/conversation-eaten-message-watcher.js', () => ({
  watchForEatenConversationMessage: vi.fn(),
}));
vi.mock('../../model-capabilities.js', () => ({
  modelSupportsImagesSync: vi.fn(() => true),
}));
vi.mock('../../runtimes/behavior.js', () => ({
  getHarnessBehavior: mocks.getHarnessBehavior,
}));
vi.mock('../../transcript-landing.js', () => ({
  captureTranscriptUserRecordSnapshot: vi.fn(),
}));
vi.mock('../../agents.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
  injectPiConversationMemory: vi.fn(async (_context, message) => message),
}));
vi.mock('../../../dashboard/server/services/conversation-attachments.js', () => ({
  ensureConversationAttachmentDir: vi.fn(),
  extractConversationAttachmentPaths: vi.fn(() => []),
  getConversationAttachmentsRoot: vi.fn(),
  hasConversationAttachment: vi.fn(),
  isManagedConversationAttachmentPath: vi.fn(async () => false),
  removeConversationAttachment: vi.fn(),
}));
vi.mock('../../conversations/transcript-summary.js', () => ({
  derivePromptTitle: vi.fn(),
}));
vi.mock('../../overdeck/conversation-delivery.js', () => ({
  deliverConversationViaControlChannel: mocks.deliverControl,
  isPiControlChannelHarness: vi.fn(() => false),
  pickDeliverAs: vi.fn(() => 'prompt'),
  resolveConversationDeliveryMethod: vi.fn(() => 'auto'),
}));

import { handleConversationMessage } from '../../overdeck/conversation-message.js';
import { parseOverdeckComposerCommand } from '../parser.js';
import { handleComposerCommand } from '../router.js';

function decodeJsonResponse(response: { body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

const conversation = {
  name: 'test-conversation',
  tmuxSession: 'conv-test',
  cwd: '/tmp/test-conversation',
  harness: 'claude-code' as const,
  status: 'active' as const,
  titleSource: 'manual' as const,
};

function dependencies() {
  return {
    resolveSessionFile: vi.fn(async () => null),
    generateAiTitle: vi.fn(async () => {}),
    shouldInterceptManualCompact: vi.fn(() => false),
    transformMessageForHarness: vi.fn((message: string) => message),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversationByName.mockReturnValue(conversation);
  mocks.getHarnessBehavior.mockReturnValue({
    injectsPromptTimeMemory: false,
    transcriptKind: 'claude-jsonl',
  });
});

describe('conversation composer command routing', () => {
  it('intercepts registered /pan commands before compact, transform, or delivery', async () => {
    const deps = dependencies();
    const response = await handleConversationMessage(
      conversation.name,
      { message: '/pan status' },
      deps,
    );
    const body = decodeJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: 'captured',
      status: 'completed',
      command: '/pan status',
    });
    expect(deps.shouldInterceptManualCompact).not.toHaveBeenCalled();
    expect(deps.transformMessageForHarness).not.toHaveBeenCalled();
    expect(mocks.deliverControl).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('returns actionable parser errors without harness delivery', async () => {
    const deps = dependencies();
    const response = await handleConversationMessage(
      conversation.name,
      { message: '/pan bogus' },
      deps,
    );
    const body = decodeJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      code: 'unknown-command',
      token: 'bogus',
      expected: '/pan <command>',
    });
    expect(body.error).toContain('Type /pan to list available commands');
    expect(deps.shouldInterceptManualCompact).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('rejects terminal-only commands with the exact portable command name', async () => {
    const response = await handleConversationMessage(
      conversation.name,
      { message: '/pan doctor' },
      dependencies(),
    );
    const body = decodeJsonResponse(response);

    expect(response.status).toBe(422);
    expect(body).toEqual({
      kind: 'terminal-only',
      status: 'rejected',
      message: '/pan doctor must run in a terminal. Composer execution has not been enabled for this command.',
    });
  });

  it.each([
    'ordinary prompt text',
    'pan start PAN-42',
  ])('preserves ordinary message delivery: %s', async message => {
    const deps = dependencies();
    const response = await handleConversationMessage(
      conversation.name,
      { message },
      deps,
    );

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toEqual({ ok: true });
    expect(deps.shouldInterceptManualCompact).toHaveBeenCalledWith(message);
    expect(deps.transformMessageForHarness).toHaveBeenCalledWith(message, 'claude-code', []);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      conversation.tmuxSession,
      message,
      'conversation-message',
      'auto',
    );
  });

  it('dispatches captured policies with the canonical argv', async () => {
    const parsed = parseOverdeckComposerCommand('/pan status');
    expect(parsed).not.toBeNull();

    await expect(handleComposerCommand({
      parsed: parsed!,
      target: {
        kind: 'conversation',
        id: conversation.name,
        harness: conversation.harness,
      },
    })).resolves.toMatchObject({
      kind: 'captured',
      status: 'completed',
      command: '/pan status',
    });
    expect(mocks.runCapturedCommand).toHaveBeenCalledWith(['status']);
  });
});
