import { describe, it, expect, vi, beforeEach } from 'vitest';

// PAN-2449: GITHUB_REPOS env must MERGE with projects.yaml (env wins
// per-prefix), never shadow it — a registered GitHub project (LEX) was
// invisible and its issue resolved against the wrong tracker.
const mocks = vi.hoisted(() => ({
  envContent: '' as string,
  projects: {} as Record<string, { github_repo?: string; issue_prefix?: string; linear_team?: string }>,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: unknown) => String(p).endsWith('.overdeck.env') ? true : actual.existsSync(p as never)),
    readFileSync: vi.fn((p: unknown, ...rest: never[]) =>
      String(p).endsWith('.overdeck.env') ? mocks.envContent : actual.readFileSync(p as never, ...rest)),
  };
});

vi.mock('../projects.js', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    loadProjectsConfigSync: vi.fn(() => ({ projects: mocks.projects })),
  };
});

import { parseGitHubReposSync } from '../tracker-utils.js';

describe('parseGitHubReposSync (PAN-2449)', () => {
  beforeEach(() => {
    mocks.envContent = '';
    mocks.projects = {};
  });

  it('merges projects.yaml github repos even when GITHUB_REPOS is set', () => {
    mocks.envContent = 'GITHUB_REPOS=eltmon/overdeck:PAN';
    mocks.projects = { lexerra: { github_repo: 'eltmon/lexerra', issue_prefix: 'LEX' } };
    const repos = parseGitHubReposSync();
    expect(repos).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: 'PAN', repo: 'overdeck' }),
      expect.objectContaining({ prefix: 'LEX', repo: 'lexerra' }),
    ]));
  });

  it('env entry wins over projects.yaml for the same prefix', () => {
    mocks.envContent = 'GITHUB_REPOS=someone/fork:LEX';
    mocks.projects = { lexerra: { github_repo: 'eltmon/lexerra', issue_prefix: 'LEX' } };
    const repos = parseGitHubReposSync().filter(r => r.prefix === 'LEX');
    expect(repos).toHaveLength(1);
    expect(repos[0]!.owner).toBe('someone');
  });

  it('still derives solely from projects.yaml when no env var', () => {
    mocks.projects = { krux: { github_repo: 'eltmon/krux' } };
    const repos = parseGitHubReposSync();
    expect(repos).toEqual([expect.objectContaining({ prefix: 'KRUX', repo: 'krux' })]);
  });
});
