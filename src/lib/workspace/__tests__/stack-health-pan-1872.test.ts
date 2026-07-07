/**
 * PAN-1872 regression test: workspace stack health functions must not crash when
 * issueId is undefined. This defends against `Cannot read properties of undefined
 * (reading 'toLowerCase')` during pan start recovery from a sync-main conflict.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateWorkspaceStackHealth,
  type DockerContainerLifecycle,
} from '../stack-health.js';
import type { ProjectConfig } from '../../projects.js';

const dockerProject: ProjectConfig = {
  name: 'Overdeck',
  path: '/repo',
  workspace: {
    docker: { compose_template: 'infra/.devcontainer-template' },
  },
};

function container(overrides: Partial<DockerContainerLifecycle> = {}): DockerContainerLifecycle {
  return {
    id: 'abc123',
    name: 'overdeck-feature-pan-1872-server-1',
    status: 'Up 10 seconds',
    state: 'running',
    createdAt: '2026-07-07T15:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateWorkspaceStackHealth PAN-1872 guards', () => {
  it('does not crash when issueId is undefined and stack is expected', () => {
    // Exercises normalizeIssue(issueId) on the empty-stack path.
    const health = evaluateWorkspaceStackHealth(undefined as any, dockerProject, []);

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('No Docker containers found for workspace stack');
  });

  it('does not crash when issueId is null and stack is expected', () => {
    const health = evaluateWorkspaceStackHealth(null as any, dockerProject, []);

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('No Docker containers found for workspace stack');
  });

  it('does not crash when filtering containers with an undefined issueId', () => {
    // Exercises normalizeIssue(issueId) inside isStackContainer.
    // With no issueId the filter cannot match any container, so the stack is
    // reported missing — but it must not throw.
    const health = evaluateWorkspaceStackHealth(undefined as any, dockerProject, [
      container({ name: 'overdeck-feature-pan-1872-server-1' }),
    ]);

    expect(health.reasons[0]).toContain('No Docker containers found for workspace stack');
  });
});
