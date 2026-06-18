import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../../src/lib/overdeck/conversations.js', async () => {
  const { vi } = await import('vitest');
  return {
    updateForkStatus: vi.fn(),
    markConversationEnded: vi.fn(),
    listConversations: vi.fn(),
    listArchivedConversationsWithEnrichment: vi.fn(),
    getStuckForks: vi.fn(),
    incrementForkRetryCount: vi.fn(),
    getConversationByName: vi.fn(),
    getConversationByClaudeSessionId: vi.fn(),
    getConversationById: vi.fn(),
    createConversation: vi.fn(),
    markConversationActive: vi.fn(),
    updateLastAttached: vi.fn(),
    updateConversationTitle: vi.fn(),
    updateConversationCost: vi.fn(),
    setConversationModel: vi.fn(),
    setConversationHarness: vi.fn(),
    setConversationClaudeSessionId: vi.fn(),
    updateConversationDeliveryMethod: vi.fn(),
    updateConversationForkFallbackReason: vi.fn(),
    setForkRequest: vi.fn(),
    recordConversationHandoff: vi.fn(),
    backfillConversationModel: vi.fn(),
    archiveConversation: vi.fn(),
    unarchiveConversation: vi.fn(),
    canReplaceTitle: vi.fn(),
    listFavoritedIds: vi.fn(),
    setFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    updateSpawnError: vi.fn(),
    hasOtherActiveConversationOnTmuxSession: vi.fn(),
  };
});

const { handleForkPipelineFailure } = await import(
  '../../../../../src/dashboard/server/routes/conversations.js'
);
const {
  updateForkStatus,
  markConversationEnded,
} = await import('../../../../../src/lib/overdeck/conversations.js');

describe('handleForkPipelineFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the fork failed and ended when the pipeline rejects with an Error', () => {
    handleForkPipelineFailure('fork-1', new Error('forced failure'));

    expect(updateForkStatus).toHaveBeenCalledWith('fork-1', 'failed', 'forced failure');
    expect(markConversationEnded).toHaveBeenCalledWith('fork-1');
  });

  it('marks the fork failed and ended for a non-Error rejection value', () => {
    handleForkPipelineFailure('fork-2', 'string failure');

    expect(updateForkStatus).toHaveBeenCalledWith('fork-2', 'failed', 'string failure');
    expect(markConversationEnded).toHaveBeenCalledWith('fork-2');
  });
});
