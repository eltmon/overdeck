import { createElement } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addCitation,
  CitationTargetContext,
  consumeCitations,
  getConversationCitations,
  removeCitation,
  resetCitationStore,
  updateCitationComment,
  useCitationTarget,
} from '../composerCitations.js';

const SOURCE = { kind: 'message' as const, messageId: 'msg-1', role: 'assistant' as const };
const FILE_SOURCE = { kind: 'file' as const, path: '/repo/docs/a.md' };

beforeEach(() => {
  localStorage.clear();
  resetCitationStore();
});

describe('addCitation / updateCitationComment / removeCitation / consumeCitations', () => {
  it('adds citations in order and preserves order on read', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'First', comment: '' });
    addCitation('conv-a', { source: SOURCE, quotedText: 'Second', comment: 'note' });

    const citations = getConversationCitations('conv-a');
    expect(citations.map((c) => c.quotedText)).toEqual(['First', 'Second']);
  });

  it('returns null and adds nothing for a whitespace-only quote', () => {
    const result = addCitation('conv-a', { source: SOURCE, quotedText: '   ', comment: '' });
    expect(result).toBeNull();
    expect(getConversationCitations('conv-a')).toEqual([]);
  });

  it('trims the quote and comment when storing', () => {
    const citation = addCitation('conv-a', { source: SOURCE, quotedText: '  Hi  ', comment: '  note  ' });
    expect(citation?.quotedText).toBe('Hi');
    expect(citation?.comment).toBe('note');
  });

  it('updates a citation comment by id', () => {
    const citation = addCitation('conv-a', { source: SOURCE, quotedText: 'Hi', comment: '' })!;
    updateCitationComment('conv-a', citation.id, 'now with a comment');
    expect(getConversationCitations('conv-a')[0]!.comment).toBe('now with a comment');
  });

  it('removes a citation by id', () => {
    const first = addCitation('conv-a', { source: SOURCE, quotedText: 'First', comment: '' })!;
    addCitation('conv-a', { source: SOURCE, quotedText: 'Second', comment: '' });
    removeCitation('conv-a', first.id);
    expect(getConversationCitations('conv-a').map((c) => c.quotedText)).toEqual(['Second']);
  });

  it('consume clears the list and removes the storage key', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'First', comment: '' });
    consumeCitations('conv-a');
    expect(getConversationCitations('conv-a')).toEqual([]);
    expect(localStorage.getItem('conv-citations:conv-a')).toBeNull();
  });
});

describe('conversation isolation', () => {
  it('does not let one conversation see another conversation’s citations', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'A', comment: '' });
    addCitation('conv-b', { source: SOURCE, quotedText: 'B', comment: '' });

    expect(getConversationCitations('conv-a').map((c) => c.quotedText)).toEqual(['A']);
    expect(getConversationCitations('conv-b').map((c) => c.quotedText)).toEqual(['B']);
  });
});

describe('persistence across reload', () => {
  it('resetCitationStore rebuilds state from localStorage', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'Survives reload', comment: '' });
    resetCitationStore();
    expect(getConversationCitations('conv-a').map((c) => c.quotedText)).toEqual(['Survives reload']);
  });

  it('reads an empty list for corrupt JSON', () => {
    localStorage.setItem('conv-citations:conv-a', '{not json');
    resetCitationStore();
    expect(getConversationCitations('conv-a')).toEqual([]);
  });

  it('reads an empty list for an unsupported storage version', () => {
    localStorage.setItem(
      'conv-citations:conv-a',
      JSON.stringify({ v: 2, citations: [{ id: 'x', source: SOURCE, quotedText: 'Q', comment: '', createdAt: 'now' }] }),
    );
    resetCitationStore();
    expect(getConversationCitations('conv-a')).toEqual([]);
  });

  it('drops entries with an invalid shape while keeping valid ones', () => {
    localStorage.setItem(
      'conv-citations:conv-a',
      JSON.stringify({
        v: 1,
        citations: [
          { id: 'ok', source: SOURCE, quotedText: 'Valid', comment: '', createdAt: 'now' },
          { id: 'bad', source: { kind: 'message', messageId: 'm', role: 'narrator' }, quotedText: 'Invalid', comment: '', createdAt: 'now' },
        ],
      }),
    );
    resetCitationStore();
    expect(getConversationCitations('conv-a').map((c) => c.id)).toEqual(['ok']);
  });

  it('round-trips a file citation unchanged across a reload', () => {
    const citation = addCitation('conv-a', { source: FILE_SOURCE, quotedText: 'Some code', comment: '' });
    resetCitationStore();
    expect(getConversationCitations('conv-a')).toEqual([citation]);
  });

  it('drops file citations with an empty or missing path, keeping other valid entries', () => {
    localStorage.setItem(
      'conv-citations:conv-a',
      JSON.stringify({
        v: 1,
        citations: [
          { id: 'empty-path', source: { kind: 'file', path: '' }, quotedText: 'A', comment: '', createdAt: 'now' },
          { id: 'no-path', source: { kind: 'file' }, quotedText: 'B', comment: '', createdAt: 'now' },
          { id: 'bad-kind', source: { kind: 'note' }, quotedText: 'C', comment: '', createdAt: 'now' },
          { id: 'ok', source: SOURCE, quotedText: 'Valid', comment: '', createdAt: 'now' },
        ],
      }),
    );
    resetCitationStore();
    expect(getConversationCitations('conv-a').map((c) => c.id)).toEqual(['ok']);
  });
});

describe('CitationTargetContext / useCitationTarget', () => {
  it('defaults to null outside a provider', () => {
    const { result } = renderHook(() => useCitationTarget());
    expect(result.current).toBeNull();
  });

  it('reflects the nearest CitationTargetContext.Provider value', () => {
    const { result } = renderHook(() => useCitationTarget(), {
      wrapper: ({ children }) =>
        createElement(CitationTargetContext.Provider, { value: 'conv-a' }, children),
    });
    expect(result.current).toBe('conv-a');
  });
});

describe('storage failure resilience', () => {
  it('does not throw out of addCitation when localStorage.setItem throws', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };

    try {
      expect(() => addCitation('conv-a', { source: SOURCE, quotedText: 'Hi', comment: '' })).not.toThrow();
      expect(getConversationCitations('conv-a').map((c) => c.quotedText)).toEqual(['Hi']);
    } finally {
      localStorage.setItem = original;
    }
  });
});
