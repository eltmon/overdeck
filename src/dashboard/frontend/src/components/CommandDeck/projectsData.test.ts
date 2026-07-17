import { describe, expect, it } from 'vitest';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import { groupProjects } from './projectsData';

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
