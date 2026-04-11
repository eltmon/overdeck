import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
}));

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;
  return { exec };
});

import { getForgeAdapter } from '../../../src/lib/forge.js';

describe('forge adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates GitHub review artifacts using the configured target branch', async () => {
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'https://github.com/org/repo/pull/42\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"url":"https://github.com/org/repo/pull/42","number":42}', stderr: '' });

    const result = await getForgeAdapter('github').createReviewArtifact({
      title: 'PAN-632',
      body: 'Body',
      sourceBranch: 'feature/pan-632',
      targetBranch: 'release',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('gh pr create --head feature/pan-632 --base release'),
      expect.objectContaining({ cwd: '/tmp/repo' })
    );
    expect(result).toMatchObject({
      forge: 'github',
      created: true,
      url: 'https://github.com/org/repo/pull/42',
      id: '42',
    });
  });

  it('creates GitLab review artifacts using merge requests', async () => {
    execMock
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'https://gitlab.example.com/group/repo/-/merge_requests/7\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[{"iid":7,"web_url":"https://gitlab.example.com/group/repo/-/merge_requests/7"}]', stderr: '' });

    const result = await getForgeAdapter('gitlab').createReviewArtifact({
      title: 'MIN-632',
      body: 'Body',
      sourceBranch: 'feature/min-632',
      targetBranch: 'qa',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('glab mr create --source-branch feature/min-632 --target-branch qa'),
      expect.objectContaining({ cwd: '/tmp/repo' })
    );
    expect(result).toMatchObject({
      forge: 'gitlab',
      created: true,
      url: 'https://gitlab.example.com/group/repo/-/merge_requests/7',
      id: '7',
    });
  });
});
