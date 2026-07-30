import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  readPushHealth,
  RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD,
  recordReconcileFailure,
  recordReconcileSuccess,
} from '../push-health.js';

describe('state push reconcile health', () => {
  let sandbox: string;
  let project: ProjectConfig;
  let healthPath: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'pan-push-health-'));
    process.env.OVERDECK_HOME = join(sandbox, 'home');
    const stateRoot = join(process.env.OVERDECK_HOME, 'state', 'push-health-project');
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
      sourceMainSha: '0'.repeat(40),
      stateBranchSha: '0'.repeat(40),
      completedAt: '2026-07-30T00:00:00.000Z',
      version: 1,
    }));
    project = { name: 'Push Health', path: stateRoot };
    healthPath = join(process.env.OVERDECK_HOME, 'push-health', 'push-health-project.json');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('persists failure increments and resets the streak on success', () => {
    recordReconcileFailure(project, { reason: 'first failure', conflictedPaths: ['records/a.json'] });
    recordReconcileFailure(project, { reason: 'second failure', conflictedPaths: ['records/b.json'] });

    expect(readPushHealth(project)).toMatchObject({
      consecutiveReconcileFailures: 2,
      lastFailureReason: 'second failure',
      lastConflictedPaths: ['records/b.json'],
    });

    recordReconcileSuccess(project);
    const health = readPushHealth(project);
    expect(health.consecutiveReconcileFailures).toBe(0);
    expect(health.lastSuccessAt).toBeDefined();
  });

  it('reports threshold crossing exactly when the streak reaches three', () => {
    const crossings = Array.from({ length: RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD + 1 }, (_, index) =>
      recordReconcileFailure(project, { reason: `failure ${index + 1}`, conflictedPaths: [] }).crossedThreshold,
    );

    expect(crossings).toEqual([false, false, true, false]);
    expect(readPushHealth(project).consecutiveReconcileFailures).toBe(4);
  });

  it('returns a zeroed default for missing, empty, invalid, or malformed files', () => {
    expect(readPushHealth(project)).toEqual({ consecutiveReconcileFailures: 0 });

    mkdirSync(join(process.env.OVERDECK_HOME!, 'push-health'), { recursive: true });
    for (const contents of ['', '{invalid', JSON.stringify({ consecutiveReconcileFailures: -3 })]) {
      writeFileSync(healthPath, contents);
      expect(readPushHealth(project)).toEqual({ consecutiveReconcileFailures: 0 });
    }
  });

  it('replaces the health file atomically and leaves no temporary file after sequential writes', () => {
    recordReconcileFailure(project, { reason: 'first failure', conflictedPaths: ['records/a.json'] });
    const first = JSON.parse(readFileSync(healthPath, 'utf8')) as { consecutiveReconcileFailures: number };
    expect(first.consecutiveReconcileFailures).toBe(1);
    expect(existsSync(`${healthPath}.tmp`)).toBe(false);

    recordReconcileFailure(project, { reason: 'second failure', conflictedPaths: ['records/b.json'] });
    const second = JSON.parse(readFileSync(healthPath, 'utf8')) as { consecutiveReconcileFailures: number };
    expect(second.consecutiveReconcileFailures).toBe(2);
    expect(existsSync(`${healthPath}.tmp`)).toBe(false);
  });
});
