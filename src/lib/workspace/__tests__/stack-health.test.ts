import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import {
  recordDockerContainerLifecycleSnapshot,
  resetCachedDockerContainerLifecycleSnapshotForTests,
} from '../../docker-stats.js';
import type { ProjectConfig } from '../../projects.js';
import {
  evaluateWorkspaceStackHealth,
  getWorkspaceStackHealth as getWorkspaceStackHealthProgram,
  inferIssueIdFromStackContainerName,
  recordWorkspaceStackHealthTransition,
  resetWorkspaceStackHealthTransitionsForTests,
  type DockerContainerLifecycle,
} from '../stack-health.js';

// Wrap the Effect-returning getWorkspaceStackHealth for legacy await-style tests.
const getWorkspaceStackHealth: typeof getWorkspaceStackHealthProgram extends (...a: infer A) => infer R
  ? R extends Effect.Effect<infer V, infer E> ? (...a: A) => Promise<V> : never : never =
  ((...args: Parameters<typeof getWorkspaceStackHealthProgram>) =>
    Effect.runPromise(getWorkspaceStackHealthProgram(...args))) as any;

const dockerProject: ProjectConfig = {
  name: 'Overdeck',
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
    name: 'overdeck-feature-pan-1140-server-1',
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
        name: 'overdeck-feature-pan-1140-init-1',
        status: 'Exited (127) 2 minutes ago',
        state: 'exited',
      }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('init exited non-zero (127)');
  });

  it('keeps init containers healthy when they exit zero', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        name: 'overdeck-feature-pan-1140-init-1',
        status: 'Exited (0) 2 minutes ago',
        state: 'exited',
      }),
      container({ status: 'Up 2 minutes', state: 'running' }),
    ], { now });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('keeps successful one-shot test containers from breaking the UAT stack', () => {
    const health = evaluateWorkspaceStackHealth('MIN-831', dockerProject, [
      container({
        name: 'myn-feature-min-831-test-unit-1',
        status: 'Exited (0) 2 minutes ago',
        state: 'exited',
      }),
      container({
        name: 'myn-feature-min-831-api-1',
        status: 'Up 2 minutes',
        state: 'running',
      }),
    ], { now });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('marks service containers unhealthy when they exit zero', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        name: 'overdeck-feature-pan-1140-server-1',
        status: 'Exited (0) 2 minutes ago',
        state: 'exited',
      }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons).toEqual(['overdeck-feature-pan-1140-server-1 service exited (0)']);
  });

  it('ignores same-issue corpses from a previous compose project when the canonical project is known', () => {
    // MIN-865 2026-07-21: a live myn-feature-min-865 stack sat next to 3-day-old
    // overdeck-feature-min-865-* corpses (exit 255); token-only matching called
    // the stack unhealthy and blocked every agent start.
    const health = evaluateWorkspaceStackHealth('MIN-865', dockerProject, [
      container({ name: 'myn-feature-min-865-api-1', status: 'Up 2 minutes', state: 'running', composeProject: 'myn-feature-min-865' }),
      container({ name: 'myn-feature-min-865-postgres-1', status: 'Up 2 minutes (healthy)', state: 'running', composeProject: 'myn-feature-min-865' }),
      container({ name: 'overdeck-feature-min-865-api-1', status: 'Exited (255) 3 days ago', state: 'exited', composeProject: 'overdeck-feature-min-865' }),
      container({ name: 'overdeck-feature-min-865-postgres-1', status: 'Exited (255) 3 days ago', state: 'exited', composeProject: 'overdeck-feature-min-865' }),
    ], { now, composeProjectName: 'myn-feature-min-865' });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('still counts foreign-project containers when the canonical project is unknown (legacy fallback)', () => {
    const health = evaluateWorkspaceStackHealth('MIN-865', dockerProject, [
      container({ name: 'overdeck-feature-min-865-api-1', status: 'Exited (255) 3 days ago', state: 'exited', composeProject: 'overdeck-feature-min-865' }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('overdeck-feature-min-865-api-1 service exited (255)');
  });

  it('counts same-issue containers without a compose-project label by name token', () => {
    const health = evaluateWorkspaceStackHealth('MIN-865', dockerProject, [
      container({ name: 'myn-feature-min-865-api-1', status: 'Exited (1) 2 minutes ago', state: 'exited' }),
    ], { now, composeProjectName: 'myn-feature-min-865' });

    expect(health.healthy).toBe(false);
    expect(health.reasons[0]).toContain('myn-feature-min-865-api-1 service exited (1)');
  });

  it('keeps Up containers healthy', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({ status: 'Up 2 minutes', state: 'running' }),
    ], { now });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('marks a Docker workspace unhealthy when no expected stack containers are observed', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [], { now, stackExpected: true });

    expect(health.healthy).toBe(false);
    expect(health.reasons).toEqual(['No Docker containers found for workspace stack pan-1140']);
  });

  it('allows a Docker workspace before its stack has been created', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [], { now, stackExpected: false });

    expect(health.healthy).toBe(true);
    expect(health.reasons).toEqual([]);
  });

  it('does not match overlapping issue IDs by substring', () => {
    const health = evaluateWorkspaceStackHealth('PAN-1140', dockerProject, [
      container({
        name: 'overdeck-feature-pan-11400-init-1',
        status: 'Exited (1) 3 minutes ago',
        state: 'exited',
      }),
    ], { now });

    expect(health.healthy).toBe(false);
    expect(health.reasons).toEqual(['No Docker containers found for workspace stack pan-1140']);
  });

  it('infers issue IDs from workspace stack container names', () => {
    expect(inferIssueIdFromStackContainerName('overdeck-feature-pan-1140-init-1')).toBe('PAN-1140');
    expect(inferIssueIdFromStackContainerName('overdeck-feature-pan-11400-init-1')).toBe('PAN-11400');
  });

  it('uses the cached Docker lifecycle snapshot when containers are omitted', async () => {
    recordDockerContainerLifecycleSnapshot([
      container({
        name: 'overdeck-feature-pan-1140-init-1',
        status: 'Exited (1) 3 minutes ago',
        state: 'exited',
      }),
    ], '2026-05-16T23:01:00.000Z');

    const health = await getWorkspaceStackHealth('PAN-1140', { projectConfig: dockerProject });

    expect(health).toEqual({
      healthy: false,
      reasons: ['overdeck-feature-pan-1140-init-1 init exited non-zero (1)'],
      lastObserved: '2026-05-16T23:01:00.000Z',
    });
  });

  it('allows a missing stack when the workspace has not rendered devcontainer state', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pan-stack-health-'));
    try {
      const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1140');
      mkdirSync(workspacePath, { recursive: true });

      const health = await getWorkspaceStackHealth('PAN-1140', {
        projectConfig: { ...dockerProject, path: projectRoot },
        containers: [],
        now,
      });

      expect(health).toEqual({
        healthy: true,
        reasons: [],
        lastObserved: now.toISOString(),
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('marks a missing stack unhealthy after devcontainer state exists', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pan-stack-health-'));
    try {
      mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-1140', '.devcontainer'), { recursive: true });

      const health = await getWorkspaceStackHealth('PAN-1140', {
        projectConfig: { ...dockerProject, path: projectRoot },
        containers: [],
        now,
      });

      expect(health).toEqual({
        healthy: false,
        reasons: ['No Docker containers found for workspace stack pan-1140'],
        lastObserved: now.toISOString(),
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
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
