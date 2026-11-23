/**
 * PAN-5614: the verdict command takes the forge from the project
 * configuration. A polyrepo wrapper root has no remote, and a failed remote
 * read is an error, never GitHub.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  ForgeResolutionError,
  readMemberMrFacts,
  resolveReviewArtifactTargets,
} from '../review-artifact-targets.js';

const MYN = {
  name: 'mind-your-now',
  path: '/projects/myn',
  gitlab_repo: 'eltmon/mind-your-now',
  workspace: {
    type: 'polyrepo',
    repos: [
      { name: 'fe', path: 'frontend' },
      { name: 'infra', path: 'infra' },
      { name: 'skills', path: 'myn-skills', remote: 'github' },
      { name: 'vendored', path: 'vendored', readonly: true },
    ],
  },
} as unknown as ProjectConfig;

const OVERDECK = { name: 'overdeck', path: '/projects/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig;

const noRemote = vi.fn(async () => {
  throw new Error('error: No such remote \'origin\'');
});

describe('resolveReviewArtifactTargets', () => {
  it('resolves a polyrepo GitLab workspace whose root has no remote to its member repos', async () => {
    const result = await resolveReviewArtifactTargets('MIN-1144', '/projects/myn/workspaces/feature-min-1144', {
      projectFor: () => ({ key: 'myn', config: MYN }),
      remoteUrl: noRemote,
    });

    expect(result.polyrepo).toBe(true);
    expect(result.targets).toEqual([
      { repoKey: 'fe', forge: 'gitlab', cwd: '/projects/myn/frontend', sourceBranch: 'feature/min-1144' },
      { repoKey: 'infra', forge: 'gitlab', cwd: '/projects/myn/infra', sourceBranch: 'feature/min-1144' },
      { repoKey: 'skills', forge: 'github', cwd: '/projects/myn/myn-skills', sourceBranch: 'feature/min-1144' },
    ]);
    expect(noRemote).not.toHaveBeenCalled();
  });

  it('still resolves a standalone GitHub repo to github at the workspace', async () => {
    const result = await resolveReviewArtifactTargets('PAN-5614', '/projects/overdeck/workspaces/feature-pan-5614', {
      projectFor: () => ({ key: 'overdeck', config: OVERDECK }),
      remoteUrl: noRemote,
    });

    expect(result).toEqual({
      polyrepo: false,
      targets: [{
        repoKey: 'overdeck',
        forge: 'github',
        cwd: '/projects/overdeck/workspaces/feature-pan-5614',
        sourceBranch: 'feature/pan-5614',
      }],
    });
  });

  it('reads the remote of a project that configures no forge', async () => {
    const result = await resolveReviewArtifactTargets('ABC-1', '/work/abc', {
      projectFor: () => ({ key: 'abc', config: { name: 'abc', path: '/work/abc' } as ProjectConfig }),
      remoteUrl: async () => 'git@gitlab.example.com:team/abc.git',
    });

    expect(result.targets[0]?.forge).toBe('gitlab');
  });

  it('reports a failed remote read with no configured forge instead of answering github', async () => {
    const read = resolveReviewArtifactTargets('ABC-1', '/work/abc', { projectFor: () => null, remoteUrl: noRemote });

    await expect(read).rejects.toBeInstanceOf(ForgeResolutionError);
    await expect(read).rejects.toThrow(/no project is configured for ABC-1.*No such remote/);
  });
});

describe('readMemberMrFacts', () => {
  it('reads the MR named by the discovered URL', async () => {
    const url = 'https://gitlab.com/eltmon/myn-infra/-/merge_requests/19';
    const readFacts = vi.fn(async () => ({ approved: false }) as never);

    await readMemberMrFacts('MIN-1144', 'feature/min-1144', url, readFacts);

    expect(readFacts).toHaveBeenCalledWith('MIN-1144', {
      iid: 19, web_url: url, source_branch: 'feature/min-1144', state: 'opened',
    });
  });
});
