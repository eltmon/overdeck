/**
 * PAN-4485: restart-all respawns each live terminal session exactly once,
 * through its owner — a superseded /clear row is never restarted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listConversations, closeConversationPane, spawnConversationSession,
  resolveAllowedHarness, markConversationActive, setConversationHarness,
} = vi.hoisted(() => ({
  listConversations: vi.fn(),
  closeConversationPane: vi.fn().mockResolvedValue(undefined),
  spawnConversationSession: vi.fn().mockResolvedValue(undefined),
  resolveAllowedHarness: vi.fn().mockResolvedValue('claude-code'),
  markConversationActive: vi.fn(),
  setConversationHarness: vi.fn(),
}));

vi.mock('../conversations.js', () => ({
  listConversations, markConversationActive, setConversationHarness,
}));
vi.mock('../conversation-liveness.js', () => ({
  listLiveConversationSessions: async () => new Set(['conv-p']),
  closeConversationPane,
}));
vi.mock('../conversation-runtime.js', () => ({
  resolveAllowedHarness, spawnConversationSession,
  stopConversationRuntime: vi.fn(),
  waitForConversationRuntimeReady: vi.fn(),
}));
vi.mock('../resume-contract-delivery.js', () => ({ deliverMandatoryKimiResumeContext: vi.fn() }));
vi.mock('../conversation-delivery.js', () => ({ resolveConversationDeliveryMethod: vi.fn() }));
vi.mock('../conversation-launch-context.js', () => ({ conversationLaunchContext: () => ({}) }));

import { handleConversationRestartAll } from '../conversation-restart-all.js';

function decodeJsonResponse(response: { body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAllowedHarness.mockResolvedValue('claude-code');
});

describe('handleConversationRestartAll', () => {
  it('restarts a live session exactly once, through its chain head', async () => {
    listConversations.mockReturnValue([
      { id: 1, name: 'p', tmuxSession: 'conv-p', clearedToConvId: 2, claudeSessionId: 'old', harness: 'claude-code', cwd: '/fixture', model: null, effort: null, issueId: null, bareContext: false },
      { id: 2, name: 'p-post-clear-x', tmuxSession: 'conv-p', clearedToConvId: null, claudeSessionId: 'new', harness: 'claude-code', cwd: '/fixture', model: null, effort: null, issueId: null, bareContext: false },
    ]);

    const response = await handleConversationRestartAll({ resolveSessionFile: async () => null });
    const result = decodeJsonResponse(response as unknown as { body: unknown });

    expect(spawnConversationSession).toHaveBeenCalledTimes(1);
    expect(spawnConversationSession.mock.calls[0]?.[0]).toBe('conv-p');
    expect(spawnConversationSession.mock.calls[0]?.[2]).toBe('new');
    expect(closeConversationPane).toHaveBeenCalledTimes(1);
    expect(result['restarted']).toBe(1);
  });
});
