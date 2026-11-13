import { describe, it, expect, beforeEach } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../composerDraft.js';

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
