import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import { acquireRecordLock, releaseRecordLock } from './fs-lock.js';
import { STATE_GIT_LOCK_RETRY_DELAYS_MS } from './state-git-lock.js';

export const RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD = 3;

export interface PendingPushEscalation {
  id: string;
  issueId: string;
  failureCount: number;
  reason: string;
  conflictedPaths: string[];
  createdAt: string;
}

export interface PushHealth {
  consecutiveReconcileFailures: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastConflictedPaths?: string[];
  lastSuccessAt?: string;
  pendingEscalation?: PendingPushEscalation;
}

interface ReconcileFailure {
  issueId: string;
  reason: string;
  conflictedPaths: string[];
}

const processQueues = new Map<string, Promise<void>>();
let temporaryFileSequence = 0;

function defaultPushHealth(): PushHealth {
  return { consecutiveReconcileFailures: 0 };
}

function pushHealthPath(project: ProjectConfig): string {
  const stateWorktreeName = basename(resolveStateReadHomeSync(project).root);
  return join(getOverdeckHome(), 'push-health', `${stateWorktreeName}.json`);
}

function normalizePendingEscalation(value: unknown): PendingPushEscalation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.issueId !== 'string'
    || !Number.isInteger(candidate.failureCount)
    || Number(candidate.failureCount) < RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD
    || typeof candidate.reason !== 'string'
    || !Array.isArray(candidate.conflictedPaths)
    || typeof candidate.createdAt !== 'string'
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    issueId: candidate.issueId,
    failureCount: Number(candidate.failureCount),
    reason: candidate.reason,
    conflictedPaths: candidate.conflictedPaths.filter((path): path is string => typeof path === 'string'),
    createdAt: candidate.createdAt,
  };
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
  const pendingEscalation = normalizePendingEscalation(candidate.pendingEscalation);
  if (pendingEscalation) health.pendingEscalation = pendingEscalation;
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
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${temporaryFileSequence++}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(health, null, 2)}\n`);
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function withPushHealthLock<T>(project: ProjectConfig, operation: () => T): Promise<T> {
  const path = pushHealthPath(project);
  const key = resolve(path);
  const prior = processQueues.get(key) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });
  const tail = prior.catch(() => undefined).then(() => gate);
  processQueues.set(key, tail);

  await prior.catch(() => undefined);
  const lockPath = `${path}.lock`;
  try {
    await acquireRecordLock(lockPath, {
      writerId: `push-health:${process.pid}`,
      recordPath: path,
      retryDelaysMs: STATE_GIT_LOCK_RETRY_DELAYS_MS,
    });
    try {
      return operation();
    } finally {
      await releaseRecordLock(lockPath);
    }
  } finally {
    releaseQueue();
    if (processQueues.get(key) === tail) processQueues.delete(key);
  }
}

export async function recordReconcileFailure(
  project: ProjectConfig,
  failure: ReconcileFailure,
): Promise<{ health: PushHealth; crossedThreshold: boolean }> {
  return withPushHealthLock(project, () => {
    const previous = readPushHealth(project);
    const consecutiveReconcileFailures = previous.consecutiveReconcileFailures + 1;
    const lastFailureAt = new Date().toISOString();
    const pendingEscalation = previous.pendingEscalation
      ?? (consecutiveReconcileFailures === RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD
        ? {
            id: randomUUID(),
            issueId: failure.issueId,
            failureCount: consecutiveReconcileFailures,
            reason: failure.reason,
            conflictedPaths: [...failure.conflictedPaths],
            createdAt: lastFailureAt,
          }
        : undefined);
    const health: PushHealth = {
      ...previous,
      consecutiveReconcileFailures,
      lastFailureAt,
      lastFailureReason: failure.reason,
      lastConflictedPaths: [...failure.conflictedPaths],
      ...(pendingEscalation ? { pendingEscalation } : {}),
    };
    writePushHealth(project, health);
    return {
      health,
      crossedThreshold: consecutiveReconcileFailures === RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD,
    };
  });
}

export async function recordReconcileSuccess(project: ProjectConfig): Promise<PushHealth> {
  return withPushHealthLock(project, () => {
    const health: PushHealth = {
      ...readPushHealth(project),
      consecutiveReconcileFailures: 0,
      lastSuccessAt: new Date().toISOString(),
    };
    writePushHealth(project, health);
    return health;
  });
}

export async function markPushEscalationDelivered(project: ProjectConfig, escalationId: string): Promise<void> {
  await withPushHealthLock(project, () => {
    const current = readPushHealth(project);
    if (current.pendingEscalation?.id !== escalationId) return;
    const { pendingEscalation: _delivered, ...health } = current;
    writePushHealth(project, health);
  });
}
