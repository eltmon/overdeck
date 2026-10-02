import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../../../../src/lib/projects.js';
import { findProjectForGitOrigin } from '../../../../src/lib/projects/origin-match.js';

function project(key: string, extra: Partial<ProjectConfig>): { key: string; config: ProjectConfig } {
  return { key, config: { name: key, path: `/src/${key}`, ...extra } };
}

describe('findProjectForGitOrigin (PAN-4437 WI-2)', () => {
  const projects = [
    project('other', { github_repo: 'acme/other' }),
    project('widget', { github_repo: 'acme/widget' }),
    project('lab', { gitlab_repo: 'group/sub/lab' }),
    project('widget-dup', { github_repo: 'Acme/Widget' }),
  ];

  it('matches an SSH GitHub origin case-insensitively', () => {
    expect(findProjectForGitOrigin('git@github.com:Acme/Widget.git', projects)?.key).toBe('widget');
  });

  it('matches an HTTPS GitHub origin', () => {
    expect(findProjectForGitOrigin('https://github.com/acme/widget', projects)?.key).toBe('widget');
    expect(findProjectForGitOrigin('https://github.com/acme/widget.git', projects)?.key).toBe('widget');
  });

  it('matches a GitLab origin only against gitlab_repo', () => {
    expect(findProjectForGitOrigin('git@gitlab.com:group/sub/lab.git', projects)?.key).toBe('lab');
    const githubOnly = [project('gh', { github_repo: 'group/sub/lab' })];
    expect(findProjectForGitOrigin('git@gitlab.com:group/sub/lab.git', githubOnly)).toBeNull();
    const gitlabOnly = [project('gl', { gitlab_repo: 'acme/widget' })];
    expect(findProjectForGitOrigin('https://github.com/acme/widget.git', gitlabOnly)).toBeNull();
  });

  it('returns the first of two matches', () => {
    expect(findProjectForGitOrigin('https://github.com/ACME/widget.git', projects)?.key).toBe('widget');
  });

  it('returns null for null, unparseable and unknown-host origins', () => {
    expect(findProjectForGitOrigin(null, projects)).toBeNull();
    expect(findProjectForGitOrigin('', projects)).toBeNull();
    expect(findProjectForGitOrigin('-not a url', projects)).toBeNull();
    expect(findProjectForGitOrigin('https://git.internal/acme/widget.git', projects)).toBeNull();
    expect(findProjectForGitOrigin('https://github.com/acme/missing.git', projects)).toBeNull();
  });
});
