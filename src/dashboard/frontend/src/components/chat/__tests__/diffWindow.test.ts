import { afterEach, describe, expect, it, vi } from 'vitest';

import { conversationDiffWindowUrl, hasConversationChanges, openConversationDiffWindow } from '../diffWindow';

// PAN-5295 WI-4: the diff window URL the ⋯ menu and the turn card open.

function paramsOf(url: string): URLSearchParams {
  expect(url.startsWith('/popout/diff?')).toBe(true);
  return new URLSearchParams(url.slice('/popout/diff?'.length));
}

describe('conversationDiffWindowUrl', () => {
  it('carries diff, prefix, agentId, repo, root and diffFilePath', () => {
    const params = paramsOf(conversationDiffWindowUrl({ name: 'a b', cwd: '/repo' }, { filePath: 'docs/x.md', rootId: 'project:p' }));
    expect(Object.fromEntries(params)).toEqual({
      diff: '1',
      prefix: '/api/conversations/a%20b/diffs',
      agentId: 'a b',
      repo: '/repo',
      root: 'project:p',
      diffFilePath: 'docs/x.md',
    });
  });

  it('omits root, file and repo when they are not set', () => {
    const params = paramsOf(conversationDiffWindowUrl({ name: 'c1', cwd: '' }, { rootId: null }));
    expect(Object.fromEntries(params)).toEqual({ diff: '1', prefix: '/api/conversations/c1/diffs', agentId: 'c1' });
  });
});

describe('openConversationDiffWindow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the URL in a sized new window', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openConversationDiffWindow({ name: 'c1', cwd: '/repo' });
    expect(open).toHaveBeenCalledWith('/popout/diff?diff=1&prefix=%2Fapi%2Fconversations%2Fc1%2Fdiffs&agentId=c1&repo=%2Frepo', '_blank', 'width=1000,height=800');
  });
});

describe('hasConversationChanges', () => {
  it('is true for a real local conversation only', () => {
    expect(hasConversationChanges({ id: 3 })).toBe(true);
    expect(hasConversationChanges({ id: 3, origin: 'local' })).toBe(true);
    expect(hasConversationChanges({ id: -1 })).toBe(false);
    expect(hasConversationChanges({ id: 3, origin: 'linked' })).toBe(false);
    expect(hasConversationChanges({ id: 3, origin: 'vault' })).toBe(false);
  });
});
