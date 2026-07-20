import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { MergeSet } from '../../../src/lib/merge-set.js';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(command: string, optionsOrCallback: any, maybeCallback?: any) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined)
      .then(({ stdout = '', stderr = '' }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;
  return { ...actual, exec };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { rebaseAndPushRepos } from '../../../src/lib/rebase-helper.js';

const mergeSet: MergeSet = {
  issueId: 'MIN-882',
  projectKey: 'mind-your-now',
  projectPath: '/projects/mind-your-now',
  workspaceType: 'polyrepo',
  status: 'ready',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  repos: [{
    repoKey: 'api',
    repoPath: '/projects/mind-your-now/api',
    forge: 'gitlab',
    sourceBranch: 'feature/min-882',
    targetBranch: 'main',
    reviewStatus: 'passed',
    testStatus: 'passed',
    rebaseStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'ready',
    mergeOrder: 0,
    required: true,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  execMock.mockImplementation(async (command: string) => {
    if (command.startsWith('git fetch origin')) return { stdout: '', stderr: '' };
    if (command === 'git merge-base HEAD origin/main') return { stdout: 'base-sha\n', stderr: '' };
    if (command === 'git rev-parse origin/main') return { stdout: 'base-sha\n', stderr: '' };
    if (command === 'git rev-parse HEAD') return { stdout: 'feature-sha\n', stderr: '' };
    if (command === 'git rev-parse origin/feature/min-882') return { stdout: 'feature-sha\n', stderr: '' };
    if (command.startsWith('git push')) throw new Error(`unexpected push: ${command}`);
    throw new Error(`unexpected command: ${command}`);
  });
});

describe('rebaseAndPushRepos', () => {
  it('does not push when an up-to-date branch is already published', async () => {
    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));

    expect(result).toEqual({
      success: true,
      results: [{ repoKey: 'api', outcome: 'already-current' }],
    });
    expect(execMock.mock.calls.map(([command]) => command)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^git push/)]),
    );
  });

  it('uses a plain push for an unpublished commit on an up-to-date branch', async () => {
    execMock.mockImplementation(async (command: string) => {
      if (command.startsWith('git fetch origin')) return { stdout: '', stderr: '' };
      if (command === 'git merge-base HEAD origin/main') return { stdout: 'base-sha\n', stderr: '' };
      if (command === 'git rev-parse origin/main') return { stdout: 'base-sha\n', stderr: '' };
      if (command === 'git rev-parse HEAD') return { stdout: 'local-sha\n', stderr: '' };
      if (command === 'git rev-parse origin/feature/min-882') return { stdout: 'remote-sha\n', stderr: '' };
      if (command === 'git push origin HEAD:refs/heads/feature/min-882') return { stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command}`);
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));

    expect(result.success).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'git push origin HEAD:refs/heads/feature/min-882',
      expect.objectContaining({ cwd: '/workspace/api' }),
    );
    expect(execMock.mock.calls.map(([command]) => command).join('\n')).not.toContain('--force');
  });

  it('merges the target and pushes fast-forward for GitLab branches', async () => {
    execMock.mockImplementation(async (command: string) => {
      if (command.startsWith('git fetch origin')) return { stdout: '', stderr: '' };
      if (command === 'git merge-base HEAD origin/main') return { stdout: 'old-base\n', stderr: '' };
      if (command === 'git rev-parse origin/main') return { stdout: 'new-base\n', stderr: '' };
      if (command === 'git merge --no-edit origin/main') return { stdout: '', stderr: '' };
      if (command === 'git push origin HEAD:refs/heads/feature/min-882') return { stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command}`);
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));
    const commands = execMock.mock.calls.map(([command]) => command);

    expect(result.success).toBe(true);
    expect(commands).toContain('git merge --no-edit origin/main');
    expect(commands).toContain('git push origin HEAD:refs/heads/feature/min-882');
    expect(commands.join('\n')).not.toContain('git rebase');
    expect(commands.join('\n')).not.toContain('--force');
  });

  it('retains automatic planning-artifact conflict resolution for GitLab merges', async () => {
    execMock.mockImplementation(async (command: string) => {
      if (command.startsWith('git fetch origin')) return { stdout: '', stderr: '' };
      if (command === 'git merge-base HEAD origin/main') return { stdout: 'old-base\n', stderr: '' };
      if (command === 'git rev-parse origin/main') return { stdout: 'new-base\n', stderr: '' };
      if (command === 'git merge --no-edit origin/main') throw new Error('merge conflict');
      if (command === 'git diff --name-only --diff-filter=U') return { stdout: '.pan/state.json\n', stderr: '' };
      if (command === 'git checkout --ours ".pan/state.json"') return { stdout: '', stderr: '' };
      if (command === 'git add ".pan/state.json"') return { stdout: '', stderr: '' };
      if (command === 'git commit --no-edit') return { stdout: '', stderr: '' };
      if (command === 'git push origin HEAD:refs/heads/feature/min-882') return { stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command}`);
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));
    const commands = execMock.mock.calls.map(([command]) => command);

    expect(result.success).toBe(true);
    expect(commands).toContain('git commit --no-edit');
    expect(commands).not.toContain('git merge --abort');
    expect(commands.join('\n')).not.toContain('--force');
  });
});
