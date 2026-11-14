import { describe, it, expect, beforeEach } from 'vitest';
import { clearDraft, hasSavedDraft, loadDraft, saveDraft } from '../composerDraft.js';

beforeEach(() => {
  localStorage.clear();
});

describe('clearDraft / loadDraft / saveDraft', () => {
  it('clearDraft removes the conv-draft key', () => {
    localStorage.setItem('conv-draft:c1', 'hi');
    clearDraft('c1');
    expect(localStorage.getItem('conv-draft:c1')).toBeNull();
  });

  it('loadDraft returns the saved text and an empty string when absent', () => {
    expect(loadDraft('c1')).toBe('');
    saveDraft('c1', 'hello');
    expect(loadDraft('c1')).toBe('hello');
  });
});

describe('hasSavedDraft', () => {
  it('is false with no draft keys', () => {
    expect(hasSavedDraft()).toBe(false);
  });

  it('is false when the saved draft is empty', () => {
    localStorage.setItem('conv-draft:a', '');
    expect(hasSavedDraft()).toBe(false);
  });

  it('is true when a draft has text', () => {
    localStorage.setItem('conv-draft:a', 'hi');
    expect(hasSavedDraft()).toBe(true);
  });

  it('ignores unrelated keys', () => {
    localStorage.setItem('other-key', 'hi');
    expect(hasSavedDraft()).toBe(false);
  });
});
