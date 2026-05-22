import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';
import { getWorkspaceGitInfo } from '../../../src/lib/git-utils.js';

const mockExec = vi.mocked(exec);

describe('getWorkspaceGitInfo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns HEAD SHA and branch name', async () => {
    // exec is promisified internally; mock callback style
    mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
      if (_cmd.includes('--abbrev-ref')) {
        cb(null, { stdout: 'feature/pan-342\n', stderr: '' });
      } else {
        cb(null, { stdout: 'abc1234def5678abc1234def5678abc1234def56\n', stderr: '' });
      }
      return {} as any;
    });

    const result = await Effect.runPromise(getWorkspaceGitInfo('/some/workspace'));

    expect(result.HEAD).toBe('abc1234def5678abc1234def5678abc1234def56');
    expect(result.branch).toBe('feature/pan-342');
  });

  it('trims whitespace from git output', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
      if (_cmd.includes('--abbrev-ref')) {
        cb(null, { stdout: '  main  \n', stderr: '' });
      } else {
        cb(null, { stdout: '  deadbeef  \n', stderr: '' });
      }
      return {} as any;
    });

    const result = await Effect.runPromise(getWorkspaceGitInfo('/some/workspace'));

    expect(result.HEAD).toBe('deadbeef');
    expect(result.branch).toBe('main');
  });

  it('throws with workspacePath in message when git fails', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
      cb(new Error('not a git repository'), null);
      return {} as any;
    });

    await (await Effect.runPromise(expect(getWorkspaceGitInfo('/not/a/repo'))))ceGitInfo('/not/a/repo')))).rejects.toThrow(
      'getWorkspaceGitInfo failed for /not/a/repo'
    );
  });
});
