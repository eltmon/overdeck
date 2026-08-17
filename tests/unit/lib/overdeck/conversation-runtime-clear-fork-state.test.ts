import { describe, expect, it, vi } from 'vitest';

const conversation: {
  name: string;
  tmuxSession: string;
  status: string;
  forkStatus: string | null;
  forkError: string | null;
  spawnError: string | null;
} = {
  name: 'repair-me',
  tmuxSession: 'conv-repair-me',
  status: 'active',
  forkStatus: 'failed',
  forkError: 'socket timeout',
  spawnError: 'socket timeout',
};

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  listConversations: vi.fn(() => []),
  getConversationByName: vi.fn((name: string) => name === conversation.name ? conversation : null),
  createConversation: vi.fn(),
  markConversationEnded: vi.fn(),
  markConversationActive: vi.fn(),
  updateLastAttached: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationHarness: vi.fn(),
  backfillConversationModel: vi.fn(),
  archiveConversation: vi.fn(),
  removeFavorite: vi.fn(),
  updateSpawnError: vi.fn(),
  clearConversationFailureState: vi.fn(),
  hasOtherActiveConversationOnTmuxSession: vi.fn(() => false),
}));

import { handleConversationClearForkState } from '../../../../src/lib/overdeck/conversation-runtime.js';

function responseBody(response: Awaited<ReturnType<typeof handleConversationClearForkState>>) {
  const body = response.body.toJSON() as { body: string };
  return JSON.parse(body.body) as Record<string, unknown>;
}

describe('handleConversationClearForkState', () => {
  it('returns 404 for an unknown conversation', async () => {
    const response = await handleConversationClearForkState('missing');

    expect(response.status).toBe(404);
    expect(responseBody(response)).toEqual({ error: 'Conversation not found' });
  });

  it('returns 409 without writing when the tmux session is dead', async () => {
    const clearFailureState = vi.fn();
    const response = await handleConversationClearForkState('repair-me', {
      sessionExists: vi.fn().mockResolvedValue(false),
      clearFailureState,
    });

    expect(response.status).toBe(409);
    expect(responseBody(response).error).toContain('tmux session is not alive');
    expect(clearFailureState).not.toHaveBeenCalled();
  });

  it('clears failure fields and returns a live conversation', async () => {
    const clearFailureState = vi.fn(() => {
      conversation.forkStatus = null;
      conversation.forkError = null;
      conversation.spawnError = null;
    });
    const response = await handleConversationClearForkState('repair-me', {
      sessionExists: vi.fn().mockResolvedValue(true),
      clearFailureState,
    });

    expect(response.status).toBe(200);
    expect(clearFailureState).toHaveBeenCalledWith('repair-me');
    expect(responseBody(response)).toMatchObject({
      forkStatus: null,
      forkError: null,
      spawnError: null,
      sessionAlive: true,
    });
  });
});
