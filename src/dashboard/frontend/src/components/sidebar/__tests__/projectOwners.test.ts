import { beforeEach, describe, expect, it } from 'vitest';

import {
  COLLAPSED_OWNERS_KEY,
  githubOwnerOf,
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

  it('reads [] from malformed storage and round-trips written owners', () => {
    localStorage.setItem(COLLAPSED_OWNERS_KEY, '{not json');
    expect(readCollapsedOwners()).toEqual([]);
    writeCollapsedOwners(['acme']);
    expect(readCollapsedOwners()).toEqual(['acme']);
  });
});
