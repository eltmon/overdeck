/**
 * PAN-4255: claude-code branch of POST /api/conversations/:name/thinking-level.
 * The level is persisted only after the live-change core confirms it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeLiveEffortResult } from '../../agents/effort-live.js';

let conversation: Record<string, unknown> | null = null;

vi.mock('../conversations.js', () => ({
  getConversationById: vi.fn(() => null),
  getConversationByName: vi.fn(() => conversation),
  setConversationEffort: vi.fn(),
  updateConversationDeliveryMethod: vi.fn(),
}));

const { handleConversationThinkingLevel } = await import('../conversation-delivery.js');

function decode(response: { status: number; body: unknown }): Record<string, unknown> {
  const payload = response.body as { body: Uint8Array } | null;
  return JSON.parse(payload?.body ? new TextDecoder().decode(payload.body) : '{}') as Record<string, unknown>;
}

function liveConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    name: 'claude-live',
    tmuxSession: 'conv-claude-live',
    cwd: '/tmp/claude-live',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'active',
    claudeSessionId: 'session-abc',
    deliveryMethod: null,
    effort: 'high',
    ...overrides,
  };
}

function deps(result: ClaudeLiveEffortResult) {
  return {
    applyLiveEffort: vi.fn(async () => result),
    persistEffort: vi.fn(),
  };
}

describe('handleConversationThinkingLevel — claude-code live effort', () => {
  beforeEach(() => {
    conversation = liveConversation();
  });

  it('delivers /effort to the conversation pane and persists the confirmed level', async () => {
    const d = deps({ ok: true, effort: 'low' });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'low' }, d);

    expect(d.applyLiveEffort).toHaveBeenCalledTimes(1);
    expect(d.applyLiveEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: 'conv-claude-live',
        workspace: '/tmp/claude-live',
        sessionId: 'session-abc',
        caller: 'conversation-effort',
      }),
      'low',
    );
    expect(d.persistEffort).toHaveBeenCalledWith('claude-live', 'low');
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ ok: true, effort: 'low', source: 'explicit' });
  });

  it.each([
    ['not-confirmed', 504],
    ['effort-rejected', 422],
    ['busy', 409],
    ['permission-pending', 409],
    ['input-target-not-main', 409],
    ['not-delivered', 502],
  ] as const)('maps %s to %i and persists nothing', async (code, status) => {
    const d = deps({ ok: false, code, error: `failed: ${code}` });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'low' }, d);

    expect(response.status).toBe(status);
    expect(decode(response)).toEqual({ error: `failed: ${code}`, code });
    expect(d.persistEffort).not.toHaveBeenCalled();
  });

  it('rejects an invalid level without delivering', async () => {
    const d = deps({ ok: true, effort: 'low' });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'bogus' }, d);

    expect(response.status).toBe(400);
    expect(d.applyLiveEffort).not.toHaveBeenCalled();
    expect(d.persistEffort).not.toHaveBeenCalled();
  });

  it('refuses an ended session', async () => {
    conversation = liveConversation({ status: 'ended' });
    const d = deps({ ok: true, effort: 'low' });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'low' }, d);

    expect(response.status).toBe(422);
    expect(d.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('refuses a session without a transcript yet', async () => {
    conversation = liveConversation({ claudeSessionId: null });
    const d = deps({ ok: true, effort: 'low' });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'low' }, d);

    expect(response.status).toBe(422);
    expect(d.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('treats a conversation without a harness as claude-code', async () => {
    conversation = liveConversation({ harness: null });
    const d = deps({ ok: true, effort: 'medium' });

    const response = await handleConversationThinkingLevel('claude-live', { level: 'medium' }, d);

    expect(response.status).toBe(200);
    expect(d.persistEffort).toHaveBeenCalledWith('claude-live', 'medium');
  });

  it('answers 404 for an unknown conversation', async () => {
    conversation = null;
    const d = deps({ ok: true, effort: 'low' });

    const response = await handleConversationThinkingLevel('missing', { level: 'low' }, d);

    expect(response.status).toBe(404);
  });
});
