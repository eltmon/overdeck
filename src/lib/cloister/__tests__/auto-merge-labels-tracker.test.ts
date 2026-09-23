/**
 * Review of #4017: the per-issue UAT hold reads labels from the issue's own
 * tracker. A Linear-tracked project with a `github_repo` must not read the
 * unrelated GitHub issue `<github_repo>#<n>`.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
  loadConfigSync: vi.fn(),
  getIssue: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: mocks.execFile,
}));
vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));
vi.mock('../../tracker-utils.js', () => ({ resolveGitHubIssueSync: mocks.resolveGitHubIssueSync }));
vi.mock('../../config.js', () => ({ loadConfigSync: mocks.loadConfigSync }));
vi.mock('../../tracker/factory.js', () => ({
  createTrackerFromConfig: () => ({ getIssue: mocks.getIssue }),
}));

import { issueHoldsForUat } from '../auto-merge-eligibility.js';

function ghLabels(labels: string[]): void {
  mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: labels.join('\n'), stderr: '' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'lexerra', projectPath: '/p' });
  mocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'lexerra', prefix: 'LEX', number: 7 });
});

describe('issueHoldsForUat label source', () => {
  it('reads a Linear-tracked issue\'s labels from Linear, never from the code repo\'s GitHub issue', async () => {
    mocks.getProjectSync.mockReturnValue({ tracker: 'linear', github_repo: 'eltmon/lexerra', auto_merge_default: 'auto' });
    mocks.loadConfigSync.mockReturnValue({ trackers: { primary: 'linear', linear: { type: 'linear' } } });
    mocks.getIssue.mockReturnValue(Effect.succeed({ labels: ['hold-for-uat'] }));
    ghLabels(['auto-merge']);

    await expect(issueHoldsForUat('LEX-7', { auto_merge_default: 'auto' }, false)).resolves.toBe(true);
    expect(mocks.getIssue).toHaveBeenCalledWith('LEX-7');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('uses the project and global tiers when the issue\'s tracker is not configured', async () => {
    mocks.getProjectSync.mockReturnValue({ tracker: 'linear', github_repo: 'eltmon/lexerra' });
    mocks.loadConfigSync.mockReturnValue({ trackers: { primary: 'github', github: { type: 'github' } } });

    await expect(issueHoldsForUat('LEX-7', { auto_merge_default: 'hold' }, false)).resolves.toBe(true);
    expect(mocks.getIssue).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('reads a GitHub-tracked issue from the project\'s own github_repo', async () => {
    mocks.getProjectSync.mockReturnValue({ github_repo: 'eltmon/lexerra' });
    ghLabels(['hold-for-uat']);

    await expect(issueHoldsForUat('LEX-7', { auto_merge_default: 'auto' }, false)).resolves.toBe(true);
    expect(mocks.execFile).toHaveBeenCalledWith('gh', expect.arrayContaining(['--repo', 'eltmon/lexerra']), expect.anything(), expect.any(Function));
  });

  it('does not read a GitHub issue from a repo other than the project\'s own', async () => {
    mocks.getProjectSync.mockReturnValue({ github_repo: 'eltmon/other' });
    ghLabels(['hold-for-uat']);

    await expect(issueHoldsForUat('LEX-7', { auto_merge_default: 'auto' }, false)).resolves.toBe(false);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
