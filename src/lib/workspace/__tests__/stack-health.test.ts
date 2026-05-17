import { afterEach, describe, expect, it } from 'vitest';

import {
  recordDockerContainerLifecycleSnapshot,
  resetCachedDockerContainerLifecycleSnapshotForTests,
} from '../../docker-stats.js';
import type { ProjectConfig } from '../../projects.js';
import {
  evaluateWorkspaceStackHealth,
  getWorkspaceStackHealth,
  inferIssueIdFromStackContainerName,
  recordWorkspaceStackHealthTransition,
  resetWorkspaceStackHealthTransitionsForTests,
  type DockerContainerLifecycle,
} from '../stack-health.js';

const dockerProject: ProjectConfig = {
  name: 'Panopticon',
  path: '/repo',
  workspace: {
    docker: { compose_template: 'infra/.devcontainer-template' },
  },
};

const now = new Date('2026-05-16T23:00:00.000Z');

afterEach(() => {
  resetCachedDockerContainerLifecycleSnapshotForTests();
});

function container(overrides: Partial<DockerContainerLifecycle>): DockerContainerLifecycle {
  return {
    id: 'abc123',
    name: 'panopticon-feature-pan-1140-server-1',
    status: 'Up 10 seconds',
    state: 'running',
    createdAt: '2026-05-16T22:59:00.000Z',
    ...overrides,
  };
}

describe('evaluateWorkspaceStackHealth', () => {
  it('keeps a recently Created container healthy before the threshold', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        status: 'Created',
        state: 'created',
        createdAt: '2026-05-16T22:58:30.001Z',
      }),
    ], { now, stuckCreatedThresholdMs: 120_000 });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('marks a Created container unhealthy at the threshold', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        status: 'Created',
        state: 'created',
        createdAt: '2026-05-16T22:58:00.000Z',
      }),
    ], { now, stuckCreatedThresholdMs: 120_000 });

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('stuck Created');
  });

  it('marks an exited non-zero container unhealthy', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        name: 'panopticon-feature-pan-1140-init-1',
        status: 'Exited (127) 2 minutes ago',
        state: 'exited',
      }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('init exited non-zero (127)');
  });

  it('keeps Up containers healthy', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({ status: 'Up 2 minutes', state: 'running' }),
    ], { now });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('marks a Docker workspace unhealthy when no stack containers are observed', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons).toEqual(['No Docker containers found for workspace stack pan-1140']);
  });

  it('does not match overlapping issue IDs by substring', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        name: 'panopticon-feature-pan-11400-init-1',
        status: 'Exited (1) 3 minutes ago',
        state: 'exited',
      }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons).toEqual(['No Docker containers found for workspace stack pan-1140']);
  });

  it('infers issue IDs from workspace stack container names', () => {
    expect(inferIssueIdFromStackContainerName('panopticon-feature-pan-1140-init-1')).toBe('PAN-1140');
    expect(inferIssueIdFromStackContainerName('panopticon-feature-pan-11400-init-1')).toBe('PAN-11400');
  });

  it('uses the cached Docker lifecycle snapshot when containers are omitted', async () => {
    recordDockerContainerLifecycleSnapshot([
      container({
        name: 'panopticon-feature-pan-1140-init-1',
        status: 'Exited (1) 3 minutes ago',
        state: 'exited',
      }),
    ], '2026-05-16T23:01:00.000Z');

    const health = await getWorkspaceStackHealth('PAN-1140', { projectConfig: dockerProject });

    expect(health).toEqual({
      healthy: false,
      reasons: ['panopticon-feature-pan-1140-init-1 init exited non-zero (1)'],
      lastObserved: '2026-05-16T23:01:00.000Z',
    });
  });

  it('emits only on healthy to unhealthy transitions', () => {
    resetWorkspaceStackHealthTransitionsForTests();

    expect(recordWorkspaceStackHealthTransition('PAN-1140', { healthy: true, reasons: [], lastObserved: now.toISOString() })).toBe(false);
    expect(recordWorkspaceStackHealthTransition('PAN-1140', { healthy: false, reasons: ['broken'], lastObserved: now.toISOString() })).toBe(true);
    expect(recordWorkspaceStackHealthTransition('PAN-1140', { healthy: false, reasons: ['still broken'], lastObserved: now.toISOString() })).toBe(false);
    expect(recordWorkspaceStackHealthTransition('PAN-1140', { healthy: true, reasons: [], lastObserved: now.toISOString() })).toBe(false);
    expect(recordWorkspaceStackHealthTransition('PAN-1140', { healthy: false, reasons: ['broken again'], lastObserved: now.toISOString() })).toBe(true);
  });
});
