import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  appendContinueSessionEntryForIssue: vi.fn(),
  clearIssueClosedCache: vi.fn(),
}));

vi.mock('../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../xbrief/lifecycle-io.js', () => ({
  appendContinueSessionEntryForIssue: mocks.appendContinueSessionEntryForIssue,
}));

vi.mock('../cloister/issue-closed.js', () => ({
  clearIssueClosedCache: mocks.clearIssueClosedCache,
}));

import { reopenWorkspaceState } from '../reopen.js';

describe('reopenWorkspaceState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
  });

  it('reports continueFileUpdated: false when the adapter finds no workspace worktree (ac5)', async () => {
    mocks.appendContinueSessionEntryForIssue.mockReturnValue(false);

    const result = await reopenWorkspaceState('PAN-1919', null, { reason: 'ready-again' });

    expect(result.continueFileUpdated).toBe(false);
    expect(mocks.clearIssueClosedCache).toHaveBeenCalledWith('PAN-1919');
  });

  it('reports continueFileUpdated: true when the adapter writes the session entry', async () => {
    mocks.appendContinueSessionEntryForIssue.mockReturnValue(true);

    const result = await reopenWorkspaceState('PAN-1919', null, { reason: 'ready-again' });

    expect(result.continueFileUpdated).toBe(true);
  });

  it('reports continueFileUpdated: false when the issue has no resolvable project', async () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    const result = await reopenWorkspaceState('PAN-1919', null, {});

    expect(result.continueFileUpdated).toBe(false);
    expect(mocks.appendContinueSessionEntryForIssue).not.toHaveBeenCalled();
  });
});
