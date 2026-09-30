import { describe, expect, it } from 'vitest';

import { describeConversationHit, type PaletteConversationHit } from './palette-conversation-hits';

function hit(overrides: Partial<PaletteConversationHit> = {}): PaletteConversationHit {
  return {
    sessionId: 'sess-a',
    conversationId: 'sess-a',
    projectId: '-home-eltmon-Projects-overdeck',
    projectKey: null,
    parentSessionId: null,
    subagentId: null,
    title: null,
    archived: false,
    matchTier: 'text',
    hitCount: 1,
    role: 'assistant',
    ts: '2026-06-02T01:00:00.000Z',
    byteOffset: 100,
    displayContent: 'needle appears here',
    excerpt: 'needle appears here',
    excerptSegments: [],
    rank: 1,
    ...overrides,
  };
}

describe('describeConversationHit', () => {
  it('labels a row with its title when it has one', () => {
    const described = describeConversationHit(hit({ title: 'Personal portfolio deployment' }));
    expect(described.label).toBe('Personal portfolio deployment');
  });

  it('falls back to displayContent when title is null', () => {
    const described = describeConversationHit(hit({ title: null, displayContent: 'needle in prose' }));
    expect(described.label).toBe('needle in prose');
  });

  it('only shows a hit-count chip when hitCount > 1', () => {
    const single = describeConversationHit(hit({ hitCount: 1 }));
    expect(single.chips.some((chip) => chip.kind === 'hits')).toBe(false);

    const multiple = describeConversationHit(hit({ hitCount: 3 }));
    expect(multiple.chips).toContainEqual({ kind: 'hits', text: '3 hits' });
  });

  it('shows an archived chip when archived', () => {
    const archived = describeConversationHit(hit({ archived: true }));
    expect(archived.chips).toContainEqual({ kind: 'archived', text: 'archived' });

    const notArchived = describeConversationHit(hit({ archived: false }));
    expect(notArchived.chips.some((chip) => chip.kind === 'archived')).toBe(false);
  });

  it('sets openRequest.byteOffset to null for a title-only hit', () => {
    const described = describeConversationHit(hit({ byteOffset: null, title: 'Title only row' }));
    expect(described.openRequest.byteOffset).toBeNull();
  });

  it('labels a title-only hit with no Claude session as a conversation, not a bare "Claude session" chip', () => {
    // A title-only row with no claude-code file falls back to sessionId = conversationId
    // (palette.ts), so conversationId === rootSessionId — but it always has a real
    // conversation row (title matching requires a non-null title) (PAN-4358 review).
    const described = describeConversationHit(hit({
      sessionId: 'conv-no-claude-session',
      conversationId: 'conv-no-claude-session',
      byteOffset: null,
      title: 'A conversation with no claude-code file',
    }));
    expect(described.sourceLabel).toBe('Conversation conv-no-claude-session');
  });
});
