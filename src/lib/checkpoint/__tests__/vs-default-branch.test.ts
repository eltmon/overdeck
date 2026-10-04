import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectsMocks = vi.hoisted(() => ({
  findProjectByPath: vi.fn(),
  getProjectSync: vi.fn(),
}));

vi.mock('../../projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../projects.js')>('../../projects.js');
  return {
    ...actual,
    findProjectByPath: projectsMocks.findProjectByPath,
    getProjectSync: projectsMocks.getProjectSync,
  };
});

import { diffVsDefaultBranch } from '../vs-default-branch.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    },
  });
}

describe('diffVsDefaultBranch (PAN-4501)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-4501-vs-default-branch-'));
    git(repo, ['init', '--quiet']);
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '--quiet', '-m', 'initial']);
    git(repo, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(repo, 'a.txt'), 'a\nchanged\n');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, ['add', 'a.txt', 'b.txt']);
    git(repo, ['commit', '--quiet', '-m', 'feature change']);

    projectsMocks.findProjectByPath.mockReset();
    projectsMocks.getProjectSync.mockReset();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('diffs against the configured default branch when it exists', async () => {
    projectsMocks.findProjectByPath.mockReturnValue({ workspace: { default_branch: 'trunk' } });

    const result = await diffVsDefaultBranch(repo);

    expect(result.baseBranch).toBe('trunk');
    expect(result.baseRef).toBe('trunk');
    expect(result.files.map(f => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(result).not.toHaveProperty('diff');
  });

  it('includes a scoped patch when filePath is given', async () => {
    projectsMocks.findProjectByPath.mockReturnValue({ workspace: { default_branch: 'trunk' } });

    const result = await diffVsDefaultBranch(repo, { filePath: 'b.txt' });

    expect(result.diff).toContain('+++ b/b.txt');
  });

  it('falls back to main and returns an empty result when the branch does not exist', async () => {
    projectsMocks.findProjectByPath.mockReturnValue(null);

    const result = await diffVsDefaultBranch(repo);

    expect(result).toEqual({ baseBranch: 'main', baseRef: null, files: [] });
  });

  it('resolves the project by explicit key before falling back to findProjectByPath', async () => {
    projectsMocks.getProjectSync.mockReturnValue({ workspace: { default_branch: 'trunk' } });
    projectsMocks.findProjectByPath.mockReturnValue(null);

    const result = await diffVsDefaultBranch(repo, { projectKey: 'k' });

    expect(result.baseBranch).toBe('trunk');
    expect(projectsMocks.getProjectSync).toHaveBeenCalledWith('k');
  });
});
