import { describe, expect, it } from 'vitest';

import { InvalidEffortError } from '../../agents/resolve-effort.js';
import { canonicalConversationEffort, isValidConversationEffort, resolveConversationEffort } from '../conversation-effort.js';

describe('resolveConversationEffort', () => {
  it('keeps xhigh and max for claude-opus-5-5 on claude-code', () => {
    expect(resolveConversationEffort({ effort: 'xhigh', model: 'claude-opus-5-5', harness: 'claude-code' })).toBe('xhigh');
    expect(resolveConversationEffort({ effort: 'max', model: 'claude-opus-5-5', harness: 'claude-code' })).toBe('max');
  });

  it('clamps max to xhigh on ohmypi', () => {
    expect(resolveConversationEffort({ effort: 'max', harness: 'ohmypi' })).toBe('xhigh');
  });

  it('maps pi off/minimal to low', () => {
    expect(resolveConversationEffort({ effort: 'off', harness: 'ohmypi' })).toBe('low');
    expect(resolveConversationEffort({ effort: 'minimal', harness: 'ohmypi' })).toBe('low');
  });

  it('defaults to high when effort is undefined and no issueId is given', () => {
    expect(resolveConversationEffort({ effort: undefined, harness: 'claude-code' })).toBe('high');
  });

  it('rejects a non-canonical value on claude-code', () => {
    expect(() => resolveConversationEffort({ effort: 'bogus', harness: 'claude-code' })).toThrow(InvalidEffortError);
  });

  it('passes an opencode variant through unchanged', () => {
    expect(resolveConversationEffort({ effort: 'bogus-variant', harness: 'opencode' })).toBe('bogus-variant');
  });
});

describe('isValidConversationEffort', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max', 'off', 'minimal'])('accepts %s on claude-code', (value) => {
    expect(isValidConversationEffort(value, 'claude-code')).toBe(true);
  });

  it('rejects bogus on claude-code', () => {
    expect(isValidConversationEffort('bogus', 'claude-code')).toBe(false);
  });

  it('accepts an opencode variant', () => {
    expect(isValidConversationEffort('custom', 'opencode')).toBe(true);
  });
});

describe('canonicalConversationEffort', () => {
  it('maps off and minimal to low and leaves everything else unchanged', () => {
    expect(canonicalConversationEffort('off')).toBe('low');
    expect(canonicalConversationEffort('minimal')).toBe('low');
    expect(canonicalConversationEffort('xhigh')).toBe('xhigh');
  });
});
