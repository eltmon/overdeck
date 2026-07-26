import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import {
  fetchProjectPipelineMembership,
  groupProjects,
  refreshProjectPipelineMembership,
} from './projectsData';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-token',
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function feature(issueId: string, projectName: string): ProjectFeature {
  return {
    issueId,
    title: issueId,
    projectName,
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'open',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
  };
}

describe('project pipeline membership probes', () => {
  it('rejects a typed unavailable GET body returned with HTTP 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'unavailable',
      reason: 'forge_unavailable',
      message: 'HTTP 404',
      projectKey: 'overdeck',
    }), { status: 200 }));

    await expect(fetchProjectPipelineMembership('overdeck'))
      .rejects.toThrow('HTTP 404 (forge_unavailable)');
  });

  it('accepts a bare membership array returned with HTTP 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await expect(fetchProjectPipelineMembership('overdeck')).resolves.toBe(true);
  });

  it('preserves non-OK membership errors through readMembershipError', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'Pipeline membership snapshot is loading',
    }), { status: 503 }));

    await expect(fetchProjectPipelineMembership('overdeck'))
      .rejects.toThrow('Pipeline membership snapshot is loading');
  });

  it('rejects a typed unavailable POST refresh body returned with HTTP 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      status: 'unavailable',
      reason: 'repo_unavailable',
      message: 'Repository missing',
      projectKey: 'overdeck',
    }), { status: 200 }));

    await expect(refreshProjectPipelineMembership('overdeck'))
      .rejects.toThrow('Repository missing (repo_unavailable)');
  });
});

describe('groupProjects', () => {
  it('sorts project features by numeric issue id', () => {
    const projects = groupProjects([
      feature('PAN-2822', 'Overdeck'),
      feature('PAN-532', 'Overdeck'),
      feature('PAN-806', 'Overdeck'),
      feature('PAN-538', 'Overdeck'),
    ]);

    expect(projects[0].features.map((item) => item.issueId)).toEqual([
      'PAN-532',
      'PAN-538',
      'PAN-806',
      'PAN-2822',
    ]);
  });

  it('preserves project-name ordering', () => {
    const projects = groupProjects([
      feature('PAN-2', 'Zeta'),
      feature('PAN-1', 'Alpha'),
    ]);

    expect(projects.map((project) => project.name)).toEqual(['Alpha', 'Zeta']);
  });
});
