import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWN_HARNESSES } from '@overdeck/contracts';
import type { RuntimeName } from '../../runtimes/types.js';

const mocks = vi.hoisted(() => ({
  activeHarness: 'claude-code' as string,
  deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
  deliverControl: vi.fn().mockResolvedValue(undefined),
  getAgentState: vi.fn(),
  getConversationByName: vi.fn(),
  messageAgent: vi.fn().mockResolvedValue(undefined),
  runDetachedCommand: vi.fn(async (argv: readonly string[]) => ({
    kind: 'activity' as const,
    status: 'accepted' as const,
    command: `/pan ${argv.join(' ')}`,
    activityId: 'activity-matrix',
    message: 'Started command. Watch activity activity-matrix for progress.',
  })),
}));

vi.mock('../detached.js', () => ({
  runDetachedCommand: mocks.runDetachedCommand,
}));
vi.mock('../executors.js', () => ({
  runCapturedCommand: vi.fn(),
}));
vi.mock('../../overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
  setConversationClaudeSessionId: vi.fn(),
  updateConversationTitle: vi.fn(),
}));
vi.mock('../../../dashboard/server/services/conversation-compaction.js', () => ({
  compactConversationNative: vi.fn(),
  shouldInterceptManualCompact: vi.fn(() => false),
}));
vi.mock('../../../dashboard/server/services/conversation-eaten-message-watcher.js', () => ({
  watchForEatenConversationMessage: vi.fn(),
}));
vi.mock('../../model-capabilities.js', () => ({
  modelSupportsImagesSync: vi.fn(() => true),
}));
vi.mock('../../runtimes/behavior.js', () => ({
  getHarnessBehavior: vi.fn(() => ({
    injectsPromptTimeMemory: false,
    transcriptKind: 'claude-jsonl',
  })),
}));
vi.mock('../../transcript-landing.js', () => ({
  captureTranscriptUserRecordSnapshot: vi.fn(),
}));
vi.mock('../../agents.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
  getAgentState: mocks.getAgentState,
  injectPiConversationMemory: vi.fn(async (_context, message) => message),
  messageAgent: mocks.messageAgent,
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
  isPiControlChannelHarness: vi.fn((harness: RuntimeName) => harness === 'ohmypi'),
  pickDeliverAs: vi.fn(() => 'prompt'),
  resolveConversationDeliveryMethod: vi.fn(() => 'auto'),
}));

import { handleAgentMessage } from '../../../dashboard/server/routes/agents/messaging.js';
import { handleConversationMessage } from '../../overdeck/conversation-message.js';

// Derived from the canonical KNOWN_HARNESSES (PAN-1837 review fix) so this
// matrix automatically covers a newly-added harness instead of silently
// staying at whatever set was hardcoded when the test was written.
const HARNESSES = [...KNOWN_HARNESSES] as readonly RuntimeName[];
const PORTABLE_COMMAND = '/pan start PAN-999';
const EXPECTED_RESULT = {
  kind: 'activity',
  status: 'accepted',
  command: PORTABLE_COMMAND,
  activityId: 'activity-matrix',
  message: 'Started command. Watch activity activity-matrix for progress.',
};

function conversation(harness: RuntimeName) {
  return {
    name: `matrix-${harness}`,
    tmuxSession: `conv-matrix-${harness}`,
    cwd: `/tmp/matrix-${harness}`,
    issueId: 'PAN-999',
    harness,
    status: 'active' as const,
    titleSource: 'manual' as const,
  };
}

function dependencies() {
  return {
    resolveSessionFile: vi.fn(async () => null),
    generateAiTitle: vi.fn(async () => {}),
    shouldInterceptManualCompact: vi.fn(() => false),
    transformMessageForHarness: vi.fn((message: string) => message),
  };
}

function decodeJsonResponse(response: { body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversationByName.mockImplementation(() => conversation(mocks.activeHarness as RuntimeName));
  mocks.getAgentState.mockImplementation(() => Effect.succeed({
    harness: mocks.activeHarness,
    workspace: `/tmp/agent-${mocks.activeHarness}`,
    issueId: 'PAN-999',
  }));
});

describe('composer command harness interception matrix (all KNOWN_HARNESSES)', () => {
  it('returns identical canonical argv and results for conversation commands without delivery', async () => {
    const results = [];
    for (const harness of HARNESSES) {
      mocks.activeHarness = harness;
      mocks.getConversationByName.mockReturnValue(conversation(harness));
      const deps = dependencies();

      const response = await handleConversationMessage(
        `matrix-${harness}`,
        { message: PORTABLE_COMMAND },
        deps,
      );
      results.push(decodeJsonResponse(response));

      expect(deps.shouldInterceptManualCompact).not.toHaveBeenCalled();
      expect(deps.transformMessageForHarness).not.toHaveBeenCalled();
    }

    expect(results).toEqual(HARNESSES.map(() => EXPECTED_RESULT));
    expect(mocks.runDetachedCommand.mock.calls).toEqual(
      HARNESSES.map(() => [['start', 'PAN-999']]),
    );
    expect(mocks.deliverControl).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('returns identical canonical argv and results for agent commands without delivery', async () => {
    const results = [];
    for (const harness of HARNESSES) {
      mocks.activeHarness = harness;
      mocks.getAgentState.mockReturnValue(Effect.succeed({
        harness,
        workspace: `/tmp/agent-${harness}`,
        issueId: 'PAN-999',
      }));

      const response = await handleAgentMessage(
        `agent-matrix-${harness}`,
        PORTABLE_COMMAND,
      );
      results.push(decodeJsonResponse(response));
    }

    expect(results).toEqual(HARNESSES.map(() => EXPECTED_RESULT));
    expect(mocks.runDetachedCommand.mock.calls).toEqual(
      HARNESSES.map(() => [['start', 'PAN-999']]),
    );
    expect(mocks.deliverControl).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it.each(HARNESSES)('preserves conversation delivery negatives for %s', async harness => {
    for (const message of ['ordinary prompt text', 'pan start PAN-999']) {
      vi.clearAllMocks();
      mocks.activeHarness = harness;
      mocks.getConversationByName.mockReturnValue(conversation(harness));
      const deps = dependencies();

      const response = await handleConversationMessage(
        `matrix-${harness}`,
        { message },
        deps,
      );

      expect(decodeJsonResponse(response)).toEqual({ ok: true });
      expect(deps.transformMessageForHarness).toHaveBeenCalledWith(message, harness, []);
      if (harness === 'ohmypi') {
        expect(mocks.deliverControl).toHaveBeenCalledOnce();
        expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
      } else {
        expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
          `conv-matrix-${harness}`,
          message,
          'conversation-message',
          'auto',
        );
        expect(mocks.deliverControl).not.toHaveBeenCalled();
      }
      expect(mocks.runDetachedCommand).not.toHaveBeenCalled();
    }
  });

  it.each(HARNESSES)('preserves agent delivery negatives for %s', async harness => {
    for (const message of ['ordinary prompt text', 'pan start PAN-999']) {
      vi.clearAllMocks();
      mocks.activeHarness = harness;

      const response = await handleAgentMessage(`agent-matrix-${harness}`, message);

      expect(decodeJsonResponse(response)).toEqual({ success: true });
      expect(mocks.messageAgent).toHaveBeenCalledWith(
        `agent-matrix-${harness}`,
        message,
        'dashboard:user-message',
      );
      expect(mocks.deliverControl).not.toHaveBeenCalled();
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
      expect(mocks.runDetachedCommand).not.toHaveBeenCalled();
    }
  });
});
