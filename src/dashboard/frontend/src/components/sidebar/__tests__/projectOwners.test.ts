import { beforeEach, describe, expect, it } from 'vitest';

import {
  COLLAPSED_OWNERS_KEY,
  githubOwnerOf,
  gitlabGroupOf,
  groupProjectsByOwner,
  readCollapsedOwners,
  writeCollapsedOwners,
} from '../projectOwners';

// PAN-5153 W9: the sidebar groups projects by GitHub owner.
describe('projectOwners (PAN-5153)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads the owner out of owner/repo only', () => {
    expect(githubOwnerOf('a/b')).toBe('a');
    expect(githubOwnerOf(null)).toBeNull();
    expect(githubOwnerOf('nope')).toBeNull();
  });

  it('returns one group without an owner when only one owner exists', () => {
    const projects = [{ name: 'x', githubRepo: 'acme/x' }, { name: 'y', githubRepo: 'acme/y' }, { name: 'z' }];
    expect(groupProjectsByOwner(projects)).toEqual([{ owner: null, projects }]);
  });

  it('sorts owner groups, merges spellings and puts projects without a repository last', () => {
    const zeta = { name: 'z', githubRepo: 'zeta/z' };
    const acmeX = { name: 'x', githubRepo: 'Acme/x' };
    const acmeY = { name: 'y', githubRepo: 'acme/y' };
    const local = { name: 'local', githubRepo: null };
    expect(groupProjectsByOwner([zeta, acmeX, local, acmeY])).toEqual([
      { owner: 'Acme', projects: [acmeX, acmeY] },
      { owner: 'zeta', projects: [zeta] },
      { owner: null, projects: [local] },
    ]);
  });

  // PAN-5161: owner, then GitHub owner, then GitLab group, then Other.
  it('lets an explicit owner win over the GitHub owner', () => {
    const myn = { name: 'mind-your-now', owner: 'mindyournow', githubRepo: 'eltmon/mind-your-now' };
    const cli = { name: 'myn-cli', githubRepo: 'MindYourNow/myn-cli' };
    const pan = { name: 'overdeck', githubRepo: 'eltmon/overdeck' };
    expect(groupProjectsByOwner([myn, cli, pan])).toEqual([
      { owner: 'eltmon', projects: [pan] },
      { owner: 'mindyournow', projects: [myn, cli] },
    ]);
  });

  it('falls back to the GitLab group when there is no GitHub repository', () => {
    expect(gitlabGroupOf('group/sub/repo')).toBe('group');
    expect(gitlabGroupOf('repo')).toBeNull();
    const gitlab = { name: 'app', githubRepo: null, gitlabRepo: 'acme/platform/app' };
    const github = { name: 'site', githubRepo: 'zeta/site' };
    expect(groupProjectsByOwner([github, gitlab])).toEqual([
      { owner: 'acme', projects: [gitlab] },
      { owner: 'zeta', projects: [github] },
    ]);
  });

  it('keeps a project with no owner, GitHub repo or GitLab repo in Other', () => {
    const acme = { name: 'a', githubRepo: 'acme/a' };
    const zeta = { name: 'z', gitlabRepo: 'zeta/z' };
    const local = { name: 'local', owner: '  ', githubRepo: null, gitlabRepo: null };
    expect(groupProjectsByOwner([local, acme, zeta])).toEqual([
      { owner: 'acme', projects: [acme] },
      { owner: 'zeta', projects: [zeta] },
      { owner: null, projects: [local] },
    ]);
  });

  it('reads [] from malformed storage and round-trips written owners', () => {
    localStorage.setItem(COLLAPSED_OWNERS_KEY, '{not json');
    expect(readCollapsedOwners()).toEqual([]);
    writeCollapsedOwners(['acme']);
    expect(readCollapsedOwners()).toEqual(['acme']);
  });
});
