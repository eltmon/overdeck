/** PAN-4651 WI-3 (D-4651-11): git origin slugs and the owner's project list. */
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  _resetMachineProjectsHashForTests,
  gitOriginOf,
  listMachineProjects,
  machineProjectsHash,
  machineProjectsHashForHeartbeat,
  sameGitOrigin,
} from '../project-origin.js';

const projects = async (): Promise<Array<{ key: string; config: ProjectConfig }>> => [
  { key: 'web', config: { name: 'Web', path: '/home/me/web', gitlab_repo: 'acme/web' } as ProjectConfig },
  { key: 'overdeck', config: { name: 'Overdeck', path: '/home/me/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig },
  { key: 'scratch', config: { name: '', path: '/home/me/scratch' } as ProjectConfig },
];

afterEach(() => _resetMachineProjectsHashForTests());

describe('project origins (D-4651-11)', () => {
  it('builds github and gitlab slugs, null without a remote repo', () => {
    expect(gitOriginOf({ github_repo: 'eltmon/overdeck' })).toBe('github.com/eltmon/overdeck');
    expect(gitOriginOf({ gitlab_repo: 'group/sub/repo' })).toBe('gitlab.com/group/sub/repo');
    expect(gitOriginOf({})).toBeNull();
    expect(gitOriginOf(undefined)).toBeNull();
  });

  it('compares slugs ignoring case; null never matches', () => {
    expect(sameGitOrigin('github.com/Eltmon/Overdeck', 'github.com/eltmon/overdeck')).toBe(true);
    expect(sameGitOrigin(null, null)).toBe(false);
    expect(sameGitOrigin('github.com/a/b', 'github.com/a/c')).toBe(false);
  });

  it('ac3: the list carries keys, names and slugs sorted by key, and no paths', async () => {
    const list = await listMachineProjects(projects);
    expect(list).toEqual([
      { key: 'overdeck', name: 'Overdeck', gitOrigin: 'github.com/eltmon/overdeck' },
      { key: 'scratch', name: 'scratch', gitOrigin: null },
      { key: 'web', name: 'Web', gitOrigin: 'gitlab.com/acme/web' },
    ]);
    expect(JSON.stringify(list)).not.toContain('/home/me');
  });

  it('hashes to 16 hex independent of order', async () => {
    const list = await listMachineProjects(projects);
    expect(machineProjectsHash(list)).toMatch(/^[0-9a-f]{16}$/);
    expect(machineProjectsHash([...list].reverse())).toBe(machineProjectsHash(list));
  });

  it('the heartbeat hash is the last computed one and never waits', async () => {
    expect(machineProjectsHashForHeartbeat(projects)).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(machineProjectsHashForHeartbeat(projects)).toBe(machineProjectsHash(await listMachineProjects(projects)));
  });
});
