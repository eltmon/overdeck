import { describe, expect, it } from 'vitest';

import {
  collectConversationReferenceKeys,
  parseConversationHref,
  parseConversationReference,
  splitConversationReferences,
} from '../conversationReferences';

function keysOf(text: string): (string | undefined)[] {
  return splitConversationReferences(text)
    .filter((segment) => segment.key !== undefined)
    .map((segment) => segment.key);
}

describe('splitConversationReferences (PAN-5339 ref-patterns.ac1)', () => {
  it.each([
    ['conv-20261113-6031', '20261113-6031'],
    ['20261113-6031', '20261113-6031'],
    ['20260824-343d', '20260824-343d'],
    ['conv 3904', '3904'],
    ['Conversation 3904', '3904'],
    ['conv #3904', '3904'],
    ['/conv/3904', '3904'],
    ['/conv/20261113-6031', '20261113-6031'],
  ])('yields one keyed segment with key %2$s for %1$s', (text, key) => {
    const segments = splitConversationReferences(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text, key });
  });
});

describe('splitConversationReferences (PAN-5339 ref-patterns.ac2)', () => {
  it.each([
    '2026-11-13',
    'c9906c2370a',
    '555-123-4567',
    '12345678-1234-5678-9abc-def012345678',
    '20260706-3577-post-clear-78e2e542',
    'abc-20261113-6031',
    'conversations 12',
    'conv-20261113-6031/state.json',
    '20261113-6031.md',
  ])('yields no keyed segment for %s', (text) => {
    expect(keysOf(text)).toEqual([]);
  });

  it('still matches a reference followed by a sentence period', () => {
    expect(keysOf('See 20261113-6031.')).toEqual(['20261113-6031']);
  });
});

describe('parseConversationReference', () => {
  it('matches a whole-string reference', () => {
    expect(parseConversationReference('20261113-6031')).toBe('20261113-6031');
    expect(parseConversationReference('conv-20261113-6031')).toBe('20261113-6031');
    expect(parseConversationReference(' conv 3904 ')).toBe('3904');
  });

  it('returns null when the value holds more than just the reference', () => {
    expect(parseConversationReference('pan tell 20261113-6031 "x"')).toBeNull();
  });

  it('returns null for non-reference text', () => {
    expect(parseConversationReference('2026-11-13')).toBeNull();
    expect(parseConversationReference('')).toBeNull();
  });
});

describe('parseConversationHref (PAN-5339 ref-patterns.ac3)', () => {
  const localhostLocation = { origin: 'http://localhost:3011', hostname: 'localhost' };

  it('resolves a relative /conv/<key> path', () => {
    expect(parseConversationHref('/conv/3904', localhostLocation)).toBe('3904');
  });

  it('resolves an absolute URL on a loopback hostname matching a loopback location', () => {
    expect(parseConversationHref('http://overdeck.localhost/conv/3904', localhostLocation)).toBe('3904');
  });

  it('resolves an absolute URL on the same origin', () => {
    expect(parseConversationHref('http://localhost:3011/conv/20261113-6031', localhostLocation)).toBe(
      '20261113-6031',
    );
  });

  it('returns null for a non-matching external host', () => {
    expect(parseConversationHref('https://example.com/conv/3904', localhostLocation)).toBeNull();
  });

  it('returns null for a non-conversation path or missing href', () => {
    expect(parseConversationHref('/conv/not-a-key', localhostLocation)).toBeNull();
    expect(parseConversationHref('/issues/5339', localhostLocation)).toBeNull();
    expect(parseConversationHref(undefined, localhostLocation)).toBeNull();
  });

  it('ignores a trailing query or hash', () => {
    expect(parseConversationHref('/conv/3904?tab=diff', localhostLocation)).toBe('3904');
    expect(parseConversationHref('/conv/3904#bottom', localhostLocation)).toBe('3904');
  });
});

describe('collectConversationReferenceKeys (PAN-5339 ref-patterns.ac4)', () => {
  it('ignores a reference that appears only inside a fenced code block', () => {
    const markdown = ['```', 'See conv 20261113-6031', '```'].join('\n');
    expect(collectConversationReferenceKeys(markdown)).toEqual([]);
  });

  it('finds a reference outside the block when another is fenced', () => {
    const markdown = ['conv 3904', '```', '20261113-6031', '```'].join('\n');
    expect(collectConversationReferenceKeys(markdown)).toEqual(['3904']);
  });

  it('finds a /conv/<key> reference embedded in a Markdown link destination', () => {
    expect(collectConversationReferenceKeys('[the other one](https://overdeck.localhost/conv/3904)')).toEqual([
      '3904',
    ]);
  });

  it('caps at the default limit of 20 distinct keys', () => {
    const ids = Array.from({ length: 25 }, (_, i) => 3000 + i);
    const markdown = ids.map((id) => `conv ${id}`).join(', ');
    const keys = collectConversationReferenceKeys(markdown);
    expect(keys).toHaveLength(20);
    expect(keys).toEqual(ids.slice(0, 20).map(String));
  });

  it('caps at an explicit limit and dedupes repeats', () => {
    const markdown = 'conv 3904, conv 3904, conv 3905, conv 3906';
    expect(collectConversationReferenceKeys(markdown, 2)).toEqual(['3904', '3905']);
  });
});
