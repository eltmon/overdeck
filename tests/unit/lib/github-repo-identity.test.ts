import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectGitHubIdentities,
  configureWorkspaceGitHubIdentity,
  resolveRepoIdentity,
  type RepoIdentityDeps,
} from '../../../src/lib/github-repo-identity.js';

// PAN-5153 W4: one function answers "who acts on this repository".
describe('GitHub repository identity (PAN-5153)', () => {
  const configureBot = vi.fn<NonNullable<RepoIdentityDeps['configureBot']>>(async () => undefined);
  const getRepoToken = vi.fn<NonNullable<RepoIdentityDeps['getRepoToken']>>(async () => 'repo-token');

  function deps(overrides: Partial<RepoIdentityDeps> = {}): RepoIdentityDeps {
    return {
      appCoversRepo: async () => true,
      isAppConfigured: () => true,
      botName: () => 'overdeck-agent[bot]',
      ghLogin: async () => 'eltmon',
      listProjects: () => [],
      getRepoToken,
      configureBot,
      ...overrides,
    };
  }

  beforeEach(() => {
    configureBot.mockClear();
    getRepoToken.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the bot on a covered repository', async () => {
    await expect(resolveRepoIdentity('eltmon', 'overdeck', deps())).resolves.toEqual({
      mode: 'app',
      actor: 'overdeck-agent[bot]',
      detail: 'GitHub App is installed on this repository',
    });
  });

  it('names the gh user on an uncovered repository, with a detail that says why', async () => {
    const uncovered = deps({ appCoversRepo: async () => false });
    await expect(resolveRepoIdentity('mindyournow', 'myn-cli', uncovered)).resolves.toEqual({
      mode: 'user',
      actor: 'eltmon',
      detail: 'GitHub App is not installed on this repository',
    });
    await expect(resolveRepoIdentity('mindyournow', 'myn-cli', { ...uncovered, isAppConfigured: () => false }))
      .resolves.toEqual({ mode: 'user', actor: 'eltmon', detail: 'No GitHub App is configured' });
  });

  it('reports nobody when gh is not signed in and the App does not cover the repository', async () => {
    await expect(resolveRepoIdentity('a', 'b', deps({ appCoversRepo: async () => false, ghLogin: async () => null })))
      .resolves.toEqual({ mode: 'none', actor: null, detail: 'gh is not signed in. Run: gh auth login' });
  });

  it('groups projects by owner case-insensitively, skips projects without a repository and sorts owners', async () => {
    const snapshot = await collectGitHubIdentities({}, deps({
      appCoversRepo: async (owner) => owner.toLowerCase() === 'acme',
      listProjects: () => [
        { key: 'a', config: { name: 'Acme A', github_repo: 'Acme/a' } },
        { key: 'z', config: { name: 'Zeta C', github_repo: 'zeta/c' } },
        { key: 'b', config: { name: 'Acme B', github_repo: 'acme/b' } },
        { key: 'none', config: { name: 'No repo' } },
      ],
    }));
    expect(snapshot.owners.map((o) => o.owner)).toEqual(['Acme', 'zeta']);
    expect(snapshot.owners[0].projects.map((p) => p.repo)).toEqual(['Acme/a', 'acme/b']);
    expect(snapshot.owners[0].projects[0]).toMatchObject({ key: 'a', mode: 'app', actor: 'overdeck-agent[bot]' });
    expect(snapshot.owners[1].projects).toEqual([
      { key: 'z', name: 'Zeta C', repo: 'zeta/c', mode: 'user', actor: 'eltmon', detail: 'GitHub App is not installed on this repository' },
    ]);
    expect(snapshot.owners.flatMap((o) => o.projects).some((p) => p.key === 'none')).toBe(false);
    expect(snapshot.ghLogin).toBe('eltmon');
    expect(snapshot.appSlug).toBe('overdeck-agent');
  });

  it('reports no App slug when the App is not configured', async () => {
    const snapshot = await collectGitHubIdentities({}, deps({ isAppConfigured: () => false, appCoversRepo: async () => false }));
    expect(snapshot.appSlug).toBeNull();
  });

  it('configures the workspace for the bot only when the App acts there', async () => {
    await expect(configureWorkspaceGitHubIdentity('agent-1', '/ws', 'eltmon/overdeck', deps()))
      .resolves.toMatchObject({ mode: 'app' });
    expect(getRepoToken).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(configureBot).toHaveBeenCalledTimes(1);
    expect(configureBot).toHaveBeenCalledWith('/ws', 'eltmon', 'overdeck', 'repo-token');

    configureBot.mockClear();
    await expect(configureWorkspaceGitHubIdentity('agent-1', '/ws', 'mindyournow/myn-cli', deps({ appCoversRepo: async () => false })))
      .resolves.toMatchObject({ mode: 'user' });
    await expect(configureWorkspaceGitHubIdentity('agent-1', '/ws', 'a/b', deps({ appCoversRepo: async () => false, ghLogin: async () => null })))
      .resolves.toMatchObject({ mode: 'none' });
    expect(configureBot).not.toHaveBeenCalled();
  });
});
