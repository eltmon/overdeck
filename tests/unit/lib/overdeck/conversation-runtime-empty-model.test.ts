import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn((opts: Record<string, unknown>) => ({
    id: 1,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...opts,
  })),
  emitOnly: vi.fn(),
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  listConversations: vi.fn(() => []),
  getConversationByName: vi.fn(() => null),
  createConversation: mocks.createConversation,
  markConversationEnded: vi.fn(),
  markConversationActive: vi.fn(),
  updateLastAttached: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationHarness: vi.fn(),
  backfillConversationModel: vi.fn(),
  archiveConversation: vi.fn(),
  removeFavorite: vi.fn(),
  updateSpawnError: vi.fn(),
  hasOtherActiveConversationOnTmuxSession: vi.fn(() => false),
}));

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: mocks.emitOnly })),
}));

vi.mock('../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn().mockRejectedValue(new Error('stop background spawn')),
}));

vi.mock('../../../../src/lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(() => 'claude-code'),
}));

import { handleConversationCreate } from '../../../../src/lib/overdeck/conversation-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleConversationCreate empty model metadata', () => {
  it('passes undefined for empty model and whitespace-only effort', async () => {
    await handleConversationCreate(
      { model: '', effort: '   ' },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      model: undefined,
      effort: undefined,
    }));
  });

  it('preserves a real model id', async () => {
    await handleConversationCreate(
      { model: 'claude-opus-5' },
      { generateAiTitle: vi.fn().mockResolvedValue(undefined) },
    );

    expect(mocks.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-5',
    }));
  });
});
