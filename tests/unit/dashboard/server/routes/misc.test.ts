import { describe, expect, it } from 'vitest';

import { serializeRegisteredProjects } from '../../../../../src/dashboard/server/routes/misc.js';

describe('serializeRegisteredProjects', () => {
  it('includes issuePattern in the registered projects response contract', () => {
    const result = serializeRegisteredProjects([
      {
        key: 'panopticon',
        config: {
          name: 'Panopticon',
          path: '/repo/panopticon',
          issue_prefix: 'PAN',
          issue_pattern: '^(BUG)-(\\d+)$',
          github_repo: 'eltmon/panopticon-cli',
          linear_project: 'Panopticon',
        },
      },
    ]);

    expect(result).toEqual([
      {
        key: 'panopticon',
        name: 'Panopticon',
        path: '/repo/panopticon',
        linearTeam: 'PAN',
        githubRepo: 'eltmon/panopticon-cli',
        linearProject: 'Panopticon',
        issuePattern: '^(BUG)-(\\d+)$',
      },
    ]);
  });

  it('normalizes missing issuePattern to null', () => {
    const result = serializeRegisteredProjects([
      {
        key: 'docs',
        config: {
          name: 'Docs',
          path: '/repo/docs',
        },
      },
    ]);

    expect(result).toEqual([
      {
        key: 'docs',
        name: 'Docs',
        path: '/repo/docs',
        linearTeam: null,
        githubRepo: null,
        linearProject: null,
        issuePattern: null,
      },
    ]);
  });
});
