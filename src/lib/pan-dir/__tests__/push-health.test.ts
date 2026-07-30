import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  markPushEscalationDelivered,
  readPushHealth,
  RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD,
  recordReconcileFailure,
  recordReconcileSuccess,
} from '../push-health.js';

const ISSUE_ID = 'PUSH-1';

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

  function failure(reason: string, conflictedPaths: string[] = []) {
    return { issueId: ISSUE_ID, reason, conflictedPaths };
  }

  function temporaryHealthFiles(): string[] {
    if (!existsSync(dirname(healthPath))) return [];
    return readdirSync(dirname(healthPath)).filter((entry) => entry.startsWith('push-health-project.json.') && entry.endsWith('.tmp'));
  }

  it('persists failure increments and resets the streak on success', async () => {
    await recordReconcileFailure(project, failure('first failure', ['records/a.json']));
    await recordReconcileFailure(project, failure('second failure', ['records/b.json']));

    expect(readPushHealth(project)).toMatchObject({
      consecutiveReconcileFailures: 2,
      lastFailureReason: 'second failure',
      lastConflictedPaths: ['records/b.json'],
    });

    await recordReconcileSuccess(project);
    const health = readPushHealth(project);
    expect(health.consecutiveReconcileFailures).toBe(0);
    expect(health.lastSuccessAt).toBeDefined();
  });

  it('reports threshold crossing once and preserves the pending escalation until delivery', async () => {
    const crossings: boolean[] = [];
    for (let index = 0; index < RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD + 1; index += 1) {
      crossings.push((await recordReconcileFailure(project, failure(`failure ${index + 1}`))).crossedThreshold);
    }

    expect(crossings).toEqual([false, false, true, false]);
    const pending = readPushHealth(project).pendingEscalation;
    expect(pending).toMatchObject({ issueId: ISSUE_ID, failureCount: 3, reason: 'failure 3' });

    await recordReconcileSuccess(project);
    expect(readPushHealth(project).pendingEscalation?.id).toBe(pending?.id);
    await markPushEscalationDelivered(project, pending!.id);
    expect(readPushHealth(project).pendingEscalation).toBeUndefined();
  });

  it('serializes concurrent failure increments without losing writes or sharing temp files', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      recordReconcileFailure(project, failure(`concurrent failure ${index + 1}`, [`records/${index}.json`])),
    ));

    expect(readPushHealth(project).consecutiveReconcileFailures).toBe(20);
    expect(temporaryHealthFiles()).toEqual([]);
  });

  it('returns a zeroed default for missing, empty, invalid, or malformed files', () => {
    expect(readPushHealth(project)).toEqual({ consecutiveReconcileFailures: 0 });

    mkdirSync(join(process.env.OVERDECK_HOME!, 'push-health'), { recursive: true });
    for (const contents of ['', '{invalid', JSON.stringify({ consecutiveReconcileFailures: -3 })]) {
      writeFileSync(healthPath, contents);
      expect(readPushHealth(project)).toEqual({ consecutiveReconcileFailures: 0 });
    }
  });

  it('replaces the health file atomically and removes writer-unique temporary files', async () => {
    await recordReconcileFailure(project, failure('first failure', ['records/a.json']));
    const first = JSON.parse(readFileSync(healthPath, 'utf8')) as { consecutiveReconcileFailures: number };
    expect(first.consecutiveReconcileFailures).toBe(1);
    expect(temporaryHealthFiles()).toEqual([]);

    await recordReconcileFailure(project, failure('second failure', ['records/b.json']));
    const second = JSON.parse(readFileSync(healthPath, 'utf8')) as { consecutiveReconcileFailures: number };
    expect(second.consecutiveReconcileFailures).toBe(2);
    expect(temporaryHealthFiles()).toEqual([]);
  });
});
