import { describe, expect, it } from 'vitest';

import type { ResourceAllocatedIssue } from '../../../../../src/dashboard/server/services/resource-discovery.js';
import {
  groupResourceAllocatedIssuesByProject,
  resetResourceAllocatedIssuesCacheForTests,
} from '../../../../../src/dashboard/server/services/resource-discovery.js';

describe('resource-discovery grouping', () => {
  it('groups issues by project and sorts project names and issue ids', () => {
    const issues: ResourceAllocatedIssue[] = [
      {
        issueId: 'PAN-200',
        title: 'Second',
        projectName: 'panopticon-cli',
        branch: 'feature/pan-200',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        readyForMerge: false,
        resourceSources: ['workspace'],
        resourceDetails: {
          hasWorkspace: true,
          localBranchCount: 0,
          remoteBranchCount: 0,
          tmuxSessionCount: 0,
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
        },
      },
      {
        issueId: 'AAA-1',
        title: 'Other project',
        projectName: 'aaa-project',
        branch: 'feature/aaa-1',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        readyForMerge: false,
        resourceSources: ['branch'],
        resourceDetails: {
          hasWorkspace: false,
          localBranchCount: 1,
          remoteBranchCount: 0,
          tmuxSessionCount: 0,
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
        },
      },
      {
        issueId: 'PAN-100',
        title: 'First',
        projectName: 'panopticon-cli',
        branch: 'feature/pan-100',
        status: 'running',
        stateLabel: 'In Progress',
        agentStatus: 'active',
        hasPlanning: true,
        hasPrd: true,
        hasState: true,
        isShadow: false,
        readyForMerge: false,
        resourceSources: ['tmux', 'pr'],
        resourceDetails: {
          hasWorkspace: true,
          localBranchCount: 1,
          remoteBranchCount: 1,
          tmuxSessionCount: 1,
          prs: [
            {
              number: 12,
              title: 'PAN-100 PR',
              url: 'https://example.test/pr/12',
              state: 'OPEN',
              isDraft: false,
            },
          ],
          hasVbrief: true,
          hasBeads: true,
          dockerContainerCount: 1,
        },
      },
    ];

    const grouped = groupResourceAllocatedIssuesByProject(issues);

    expect(grouped.map((project) => project.name)).toEqual(['aaa-project', 'panopticon-cli']);
    expect(grouped[1]?.features.map((feature) => feature.issueId)).toEqual(['PAN-100', 'PAN-200']);
  });
});

describe('resource-discovery cache test hooks', () => {
  it('allows cache state to be reset between tests', () => {
    expect(() => resetResourceAllocatedIssuesCacheForTests()).not.toThrow();
  });
});
