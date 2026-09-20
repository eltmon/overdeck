import { describe, expect, it, vi } from 'vitest';

import {
  getConversationMessageLocator,
  getConversationMessagesRead,
} from '../../../../src/lib/overdeck/conversation-reads.js';

const deps = {
  resolveSessionFile: vi.fn(async () => {
    throw new Error('generic misses must not attempt transcript fallback resolution');
  }),
  shouldReportUnresolvedLiveSession: () => false,
};

describe('generic conversation reads', () => {
  it('returns the looked-up agent name without scanning agent transcripts', async () => {
    await expect(getConversationMessagesRead('agent-pan-3950', deps)).resolves.toEqual({
      status: 404,
      body: { error: 'Conversation not found', lookedUp: 'agent-pan-3950' },
    });
    expect(deps.resolveSessionFile).not.toHaveBeenCalled();
  });

  it('does not globally scan for unregistered session UUIDs or subagents', async () => {
    for (const name of [
      '3f2b1a4c-5d6e-4f70-8a91-b2c3d4e5f607',
      'agent-a8256731048d42b38',
    ]) {
      await expect(getConversationMessagesRead(name, deps)).resolves.toEqual({
        status: 404,
        body: { error: 'Conversation not found', lookedUp: name },
      });
      await expect(getConversationMessageLocator(name, 0, deps)).resolves.toEqual({
        status: 404,
        body: { error: 'Conversation not found', lookedUp: name },
      });
    }
    expect(deps.resolveSessionFile).not.toHaveBeenCalled();
  });
});
