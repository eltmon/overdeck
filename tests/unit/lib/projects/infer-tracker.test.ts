import { describe, expect, it, vi } from 'vitest';

import {
  githubRepoFromRemoteUrl,
  inferMissingProjectTrackers,
  inferProjectGithubRepo,
  type InferProjectTrackerDeps,
} from '../../../../src/lib/projects/infer-tracker.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

describe('githubRepoFromRemoteUrl', () => {
  it.each([
    ['git@github.com:eltmon/overdeck.git', 'eltmon/overdeck'],
    ['git@github.com:eltmon/overdeck', 'eltmon/overdeck'],
    ['ssh://git@github.com/eltmon/overdeck.git', 'eltmon/overdeck'],
    ['https://github.com/eltmon/overdeck.git', 'eltmon/overdeck'],
    ['https://github.com/eltmon/overdeck', 'eltmon/overdeck'],
    ['https://x-access-token:abc@github.com/eltmon/overdeck.git\n', 'eltmon/overdeck'],
  ])('reads %s as %s', (url, slug) => {
    expect(githubRepoFromRemoteUrl(url)).toBe(slug);
  });

  it.each([
    'git@gitlab.com:group/repo.git',
    'https://gitlab.com/group/sub/repo.git',
    'https://bitbucket.org/team/repo.git',
    'https://notgithub.com/eltmon/overdeck.git',
    '../repo',
    'owner/repo',
    '/srv/git/github.com/repo.git',
    '',
  ])('returns null for %s', (url) => {
    expect(githubRepoFromRemoteUrl(url)).toBeNull();
  });
});

function makeDeps(origin: string | null, writes = true): InferProjectTrackerDeps & {
  readOriginUrl: ReturnType<typeof vi.fn>;
  writeGithubRepo: ReturnType<typeof vi.fn>;
} {
  return {
    readOriginUrl: vi.fn(async () => origin),
    writeGithubRepo: vi.fn(async () => writes),
  };
}

const bare: ProjectConfig = { name: 'overdeck', path: '/projects/overdeck' };

describe('inferProjectGithubRepo', () => {
  it('writes github_repo from a GitHub origin for a project with no tracker', async () => {
    const deps = makeDeps('git@github.com:eltmon/overdeck.git');
    await expect(inferProjectGithubRepo('overdeck', bare, deps)).resolves.toBe('eltmon/overdeck');
    expect(deps.readOriginUrl).toHaveBeenCalledWith('/projects/overdeck');
    expect(deps.writeGithubRepo).toHaveBeenCalledWith('overdeck', 'eltmon/overdeck');
  });

  it('leaves a project that already resolves a tracker alone', async () => {
    const deps = makeDeps('git@github.com:eltmon/overdeck.git');
    const configured: ProjectConfig = { ...bare, tracker: 'linear' };
    await expect(inferProjectGithubRepo('overdeck', configured, deps)).resolves.toBeNull();
    expect(deps.readOriginUrl).not.toHaveBeenCalled();
    expect(deps.writeGithubRepo).not.toHaveBeenCalled();
  });

  it('does nothing without an origin remote', async () => {
    const deps = makeDeps(null);
    await expect(inferProjectGithubRepo('overdeck', bare, deps)).resolves.toBeNull();
    expect(deps.writeGithubRepo).not.toHaveBeenCalled();
  });

  it('does nothing for a non-GitHub origin', async () => {
    const deps = makeDeps('git@gitlab.com:group/repo.git');
    await expect(inferProjectGithubRepo('overdeck', bare, deps)).resolves.toBeNull();
    expect(deps.writeGithubRepo).not.toHaveBeenCalled();
  });

  it('skips a multi-repo root', async () => {
    const deps = makeDeps('git@github.com:eltmon/overdeck.git');
    const polyrepo: ProjectConfig = { ...bare, workspace: { type: 'polyrepo', repos: [] } };
    await expect(inferProjectGithubRepo('overdeck', polyrepo, deps)).resolves.toBeNull();
    expect(deps.readOriginUrl).not.toHaveBeenCalled();
  });

  it('reports nothing when the writer declines (entry changed under it)', async () => {
    const deps = makeDeps('https://github.com/eltmon/overdeck.git', false);
    await expect(inferProjectGithubRepo('overdeck', bare, deps)).resolves.toBeNull();
  });
});

describe('inferMissingProjectTrackers', () => {
  it('configures only the projects that resolve no tracker and have a GitHub origin', async () => {
    const origins: Record<string, string | null> = {
      '/projects/overdeck': 'git@github.com:eltmon/overdeck.git',
      '/projects/internal': 'git@git.internal:team/repo.git',
      '/projects/myn': 'git@github.com:eltmon/myn.git',
    };
    const deps = {
      readOriginUrl: vi.fn(async (path: string) => origins[path] ?? null),
      writeGithubRepo: vi.fn(async () => true),
    };
    const result = await inferMissingProjectTrackers(deps, async () => [
      { key: 'overdeck', config: bare },
      { key: 'internal', config: { name: 'internal', path: '/projects/internal' } },
      { key: 'myn', config: { name: 'MYN', path: '/projects/myn', issue_prefix: 'MIN' } },
    ]);
    expect(result).toEqual([
      { key: 'overdeck', name: 'overdeck', path: '/projects/overdeck', githubRepo: 'eltmon/overdeck' },
    ]);
    expect(deps.readOriginUrl).not.toHaveBeenCalledWith('/projects/myn');
    expect(deps.writeGithubRepo).toHaveBeenCalledTimes(1);
  });
});
