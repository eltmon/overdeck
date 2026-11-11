import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../../../src/lib/projects.js';

const { mockLoadProjectsConfigSync, mockListProjectsAsync } = vi.hoisted(() => ({
  mockLoadProjectsConfigSync: vi.fn(),
  mockListProjectsAsync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  loadProjectsConfigSync: mockLoadProjectsConfigSync,
  listProjectsAsync: mockListProjectsAsync,
}));

import {
  findJiraProjectsAsync,
  findProjectsByRallyProject,
} from '../../../../src/lib/tracker/tracker-projects.js';

const projects: Record<string, ProjectConfig> = {
  rallyApp: { name: 'Rally App', path: '/p/rally', tracker: 'rally', rally_project: '/project/822404704163' },
  jiraApp: { name: 'Jira App', path: '/p/jira', tracker: 'jira', issue_prefix: 'PROJ', jira: { site: 'https://acme.atlassian.net' } },
  linearApp: { name: 'Linear App', path: '/p/linear', tracker: 'linear', issue_prefix: 'MIN' },
};

beforeEach(() => {
  mockLoadProjectsConfigSync.mockReturnValue({ projects });
  mockListProjectsAsync.mockResolvedValue(
    Object.entries(projects).map(([key, config]) => ({ key, config })),
  );
});

describe('findProjectsByRallyProject', () => {
  it('returns only projects with a rally_project', () => {
    expect(findProjectsByRallyProject()).toEqual([{ key: 'rallyApp', config: projects.rallyApp }]);
  });
});

describe('findJiraProjectsAsync', () => {
  it('returns only tracker: jira projects', async () => {
    await expect(findJiraProjectsAsync()).resolves.toEqual([{ key: 'jiraApp', config: projects.jiraApp }]);
  });

  it('returns an empty list when no project uses Jira', async () => {
    mockListProjectsAsync.mockResolvedValue([{ key: 'linearApp', config: projects.linearApp }]);
    await expect(findJiraProjectsAsync()).resolves.toEqual([]);
  });
});
