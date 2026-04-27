import { describe, expect, it } from 'vitest';

import type { ResourceAllocatedIssue } from '../../../../../src/dashboard/server/services/resource-discovery.js';
import {
  groupResourceAllocatedIssuesByProject,
  resetResourceAllocatedIssuesCacheForTests,
  sanitizeResourceAllocatedIssues,
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
        isRally: false,
        readyForMerge: false,
        resourceSources: ['workspace'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-200'],
          localBranchCount: 0,
          localBranchNames: [],
          remoteBranchCount: 0,
          remoteBranchNames: [],
          tmuxSessionCount: 0,
          tmuxSessionNames: [],
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
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
        isRally: true,
        childCount: 3,
        completedCount: 1,
        inProgressCount: 1,
        readyForMerge: false,
        resourceSources: ['branch'],
        resourceDetails: {
          hasWorkspace: false,
          workspacePaths: [],
          localBranchCount: 1,
          localBranchNames: ['feature/aaa-1'],
          remoteBranchCount: 0,
          remoteBranchNames: [],
          tmuxSessionCount: 0,
          tmuxSessionNames: [],
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
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
        isRally: false,
        readyForMerge: false,
        resourceSources: ['tmux', 'pr'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-100'],
          localBranchCount: 1,
          localBranchNames: ['feature/pan-100'],
          remoteBranchCount: 1,
          remoteBranchNames: ['origin/feature/pan-100'],
          tmuxSessionCount: 1,
          tmuxSessionNames: ['agent-pan-100'],
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
          dockerContainerNames: ['pan-100-db'],
        },
      },
    ];

    const grouped = groupResourceAllocatedIssuesByProject(issues);

    expect(grouped.map((project) => project.name)).toEqual(['aaa-project', 'panopticon-cli']);
    expect(grouped[1]?.features.map((feature) => feature.issueId)).toEqual(['PAN-100', 'PAN-200']);
  });
});

describe('resource-discovery sanitization', () => {
  it('strips concrete infrastructure identifiers from the public resource-allocated response', () => {
    const sanitized = sanitizeResourceAllocatedIssues([
      {
        issueId: 'PAN-300',
        title: 'Sanitized',
        projectName: 'panopticon-cli',
        branch: 'feature/pan-300',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        isRally: false,
        readyForMerge: false,
        resourceSources: ['workspace', 'branch', 'tmux', 'docker', 'pr'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-300'],
          localBranchCount: 1,
          localBranchNames: ['feature/pan-300'],
          remoteBranchCount: 1,
          remoteBranchNames: ['origin/feature/pan-300'],
          tmuxSessionCount: 1,
          tmuxSessionNames: ['agent-pan-300'],
          prs: [
            {
              number: 300,
              title: 'PAN-300 PR',
              url: 'https://example.test/pr/300',
              state: 'OPEN',
              isDraft: false,
            },
          ],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 1,
          dockerContainerNames: ['pan-300-db'],
        },
      },
    ]);

    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).workspacePaths).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).localBranchNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).remoteBranchNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).tmuxSessionNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).dockerContainerNames).toBeUndefined();
    expect(sanitized[0]?.resourceDetails.prs[0]).toEqual({
      number: 300,
      title: 'PAN-300 PR',
      state: 'OPEN',
      isDraft: false,
    });
    expect(sanitized[0]?.resourceDetails.localBranchCount).toBe(1);
    expect(sanitized[0]?.resourceDetails.tmuxSessionCount).toBe(1);
  });
});

describe('resource-discovery cache test hooks', () => {
  it('allows cache state to be reset between tests', () => {
    expect(() => resetResourceAllocatedIssuesCacheForTests()).not.toThrow();
  });
});
