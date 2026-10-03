/** PAN-4486: POST /api/conversations request-body parsing. */
import { describe, expect, it } from 'vitest';

import {
  ConversationCreateInputError,
  parseConversationLaunchContext,
} from '../../../../src/lib/overdeck/conversation-create-input.js';

describe('parseConversationLaunchContext skillOverrides (PAN-4486)', () => {
  it('returns a valid map, including pack skill ids', () => {
    expect(parseConversationLaunchContext({ skillOverrides: { grilling: false, 'mattpocock/tdd': true } })).toEqual({
      bareContext: false,
      skipClaudeMd: false,
      skillOverrides: { grilling: false, 'mattpocock/tdd': true },
    });
  });

  it('omits the field when absent, null or empty', () => {
    expect(parseConversationLaunchContext({})).not.toHaveProperty('skillOverrides');
    expect(parseConversationLaunchContext({ skillOverrides: null })).not.toHaveProperty('skillOverrides');
    expect(parseConversationLaunchContext({ skillOverrides: {} })).not.toHaveProperty('skillOverrides');
  });

  it.each([
    ['a non-boolean value', { grilling: 'no' }],
    ['an array', [true]],
    ['a string', 'grilling'],
    ['a traversal key', { '../x': false }],
    ['too many entries', Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`skill-${i}`, false]))],
  ])('rejects %s', (_label, skillOverrides) => {
    expect(() => parseConversationLaunchContext({ skillOverrides })).toThrow(ConversationCreateInputError);
    expect(() => parseConversationLaunchContext({ skillOverrides })).toThrow('Invalid skillOverrides');
  });

  it('rejects a core skill', () => {
    expect(() => parseConversationLaunchContext({ skillOverrides: { 'pan-done': false } }))
      .toThrow('Core skill cannot be overridden: pan-done');
  });
});
