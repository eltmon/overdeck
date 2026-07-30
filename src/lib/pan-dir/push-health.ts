import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';

export const RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD = 3;

export interface PushHealth {
  consecutiveReconcileFailures: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastConflictedPaths?: string[];
  lastSuccessAt?: string;
}

interface ReconcileFailure {
  reason: string;
  conflictedPaths: string[];
}

function defaultPushHealth(): PushHealth {
  return { consecutiveReconcileFailures: 0 };
}

function pushHealthPath(project: ProjectConfig): string {
  const stateWorktreeName = basename(resolveStateReadHomeSync(project).root);
  return join(getOverdeckHome(), 'push-health', `${stateWorktreeName}.json`);
}

function normalizePushHealth(value: unknown): PushHealth {
  if (!value || typeof value !== 'object') return defaultPushHealth();
  const candidate = value as Record<string, unknown>;
  const consecutiveReconcileFailures = Number.isInteger(candidate.consecutiveReconcileFailures)
    && Number(candidate.consecutiveReconcileFailures) >= 0
    ? Number(candidate.consecutiveReconcileFailures)
    : 0;
  const health: PushHealth = { consecutiveReconcileFailures };
  if (typeof candidate.lastFailureAt === 'string') health.lastFailureAt = candidate.lastFailureAt;
  if (typeof candidate.lastFailureReason === 'string') health.lastFailureReason = candidate.lastFailureReason;
  if (Array.isArray(candidate.lastConflictedPaths)) {
    health.lastConflictedPaths = candidate.lastConflictedPaths.filter((path): path is string => typeof path === 'string');
  }
  if (typeof candidate.lastSuccessAt === 'string') health.lastSuccessAt = candidate.lastSuccessAt;
  return health;
}

export function readPushHealth(project: ProjectConfig): PushHealth {
  try {
    return normalizePushHealth(JSON.parse(readFileSync(pushHealthPath(project), 'utf8')));
  } catch {
    return defaultPushHealth();
  }
}

function writePushHealth(project: ProjectConfig, health: PushHealth): void {
  const path = pushHealthPath(project);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(health, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

export function recordReconcileFailure(
  project: ProjectConfig,
  failure: ReconcileFailure,
): { health: PushHealth; crossedThreshold: boolean } {
  const previous = readPushHealth(project);
  const health: PushHealth = {
    ...previous,
    consecutiveReconcileFailures: previous.consecutiveReconcileFailures + 1,
    lastFailureAt: new Date().toISOString(),
    lastFailureReason: failure.reason,
    lastConflictedPaths: [...failure.conflictedPaths],
  };
  writePushHealth(project, health);
  return {
    health,
    crossedThreshold: health.consecutiveReconcileFailures === RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD,
  };
}

export function recordReconcileSuccess(project: ProjectConfig): void {
  writePushHealth(project, {
    ...readPushHealth(project),
    consecutiveReconcileFailures: 0,
    lastSuccessAt: new Date().toISOString(),
  });
}
