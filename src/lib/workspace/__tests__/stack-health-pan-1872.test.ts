/**
 * PAN-1872 regression test: workspace stack health functions must not crash when
 * issueId is undefined. This defends against `Cannot read properties of undefined
 * (reading 'toLowerCase')` during pan start recovery from a sync-main conflict.
 */
import { describe, expect, it } from 'vitest';

import { evaluateWorkspaceStackHealth } from '../stack-health.js';
import type { ProjectConfig } from '../../projects.js';

const dockerProject: ProjectConfig = {
  name: 'Overdeck',
  path: '/repo',
  workspace: {
    docker: { compose_template: 'infra/.devcontainer-template' },
  },
};

describe('evaluateWorkspaceStackHealth PAN-1872 guards', () => {
  it('does not crash when issueId is undefined', () => {
    const health = evaluateWorkspaceStackHealth(undefined as any, dockerProject, [], {
      stackExpected: false,
    });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('does not crash when issueId is null', () => {
    const health = evaluateWorkspaceStackHealth(null as any, dockerProject, [], {
      stackExpected: false,
    });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });
});
