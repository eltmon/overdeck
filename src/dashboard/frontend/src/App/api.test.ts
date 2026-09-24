import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeConversationHitOpenFailure, fetchConversationMessageLocator } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchConversationMessageLocator (PAN-3982)', () => {
  it('targets a subagent transcript with a bare agentId', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messageId: 'm', messageIndex: 1, sequence: 1, byteOffset: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchConversationMessageLocator('parent-conv', 42, 'deadbeef01');
    await fetchConversationMessageLocator('parent-conv', 42);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/conversations/parent-conv/message-locator?byteOffset=42&agentId=deadbeef01',
      '/api/conversations/parent-conv/message-locator?byteOffset=42',
    ]);
  });

  it('names the subagent in an open-failure toast', () => {
    const message = describeConversationHitOpenFailure({
      sessionId: 'agent-deadbeef01',
      conversationId: 'parent-conv',
      projectId: 'enc',
      projectKey: null,
      byteOffset: 42,
      label: 'hit',
      sourceLabel: 'Subagent of Conversation parent-conv',
      subagentId: 'deadbeef01',
    }, new Error('Unable to locate matching message (404)'));

    expect(message).toContain('subagent deadbeef01');
  });
});
