/** The single locked read-modify-write door for per-issue records. */
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { emitActivityEntryOncePortable } from '../activity-logger.js';
import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync, STATE_BRANCH } from '../state-read-home.js';
import { STATE_BRANCH_PATHS } from '../state-plane.js';
import { flushAutoCommits } from './auto-commit.js';
import { withRecordFsLock } from './fs-lock.js';
import {
  markPushEscalationDelivered,
  recordReconcileFailure,
  recordReconcileSuccess,
  type PendingPushEscalation,
} from './push-health.js';
import { withStateGitLock } from './state-git-lock.js';
import {
  ensureIssueRecordSync,
  getIssueRecordPath,
  queueIssueRecordCommit,
  readIssueRecordSync,
  writeIssueRecordSync,
  getProjectConfigFromWorkspacePath,
  resolveProjectForIssue,
  type PanIssueRecord,
} from './record.js';

const execFileAsync = promisify(execFile);
const MAX_STATE_PUSH_RECONCILIATIONS = 3;
const DEFAULT_RECORD_DURABILITY_BUDGET_MS = 30_000;
const PENDING_ESCALATION_DELIVERY_TIMEOUT_MS = 10_000;

export class RecordDurabilityTimeoutError extends Error {
  constructor(issueId: string, budgetMs: number) {
    super(
      `Durability wait for ${issueId} state exceeded ${budgetMs}ms; releasing the record ` +
      `lock. The mutation remains in the local record and the flush continues in the ` +
      `background; callers with a fallback (e.g. the review-verdict fallback and drain) ` +
      `reconcile through it, other writers must retry the write.`,
    );
    this.name = 'RecordDurabilityTimeoutError';
  }
}

function recordDurabilityBudgetMs(): number {
  const parsed = Number(process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RECORD_DURABILITY_BUDGET_MS;
}

// Race `promise` against the shared deadline WITHOUT aborting it by default: a
// timing-out writer must not cancel peers' shared-gitRoot flushes (NFR-1). When
// the operation owns cancellable resources (reconcile/restore git subprocesses),
// `onTimeout` aborts them and awaits their settlement, so nothing the operation
// started can mutate the state worktree after the record lock is released.
// Cleanup is bounded by the abort path — it must never wait out another full
// git timeout under the lock. Once the deadline fires, the
// RecordDurabilityTimeoutError always wins the race.
async function withRecordDurabilityDeadline<T>(
  issueId: string,
  promise: Promise<T>,
  deadlineMs: number,
  budgetMs: number,
  onTimeout?: () => Promise<void>,
): Promise<T> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    await onTimeout?.().catch(() => undefined);
    throw new RecordDurabilityTimeoutError(issueId, budgetMs);
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timingOut = false;
    const timer = setTimeout(() => {
      timingOut = true;
      void (onTimeout?.() ?? Promise.resolve())
        .catch(() => undefined)
        .finally(() => {
          settled = true;
          reject(new RecordDurabilityTimeoutError(issueId, budgetMs));
        });
    }, remaining);
    timer.unref?.();
    promise.then(
      (value) => {
        if (settled || timingOut) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled || timingOut) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface UpdateIssueRecordOptions {
  writerId?: string;
  autoCommit?: boolean;
}

export function updateIssueRecordForWorkspace(
  workspacePath: string,
  issueId: string,
  mutator: IssueRecordMutator,
  options: UpdateIssueRecordOptions = {},
): Promise<PanIssueRecord> {
  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
  return updateIssueRecord(project, issueId, mutator, options);
}

export type IssueRecordMutator = (record: PanIssueRecord) => PanIssueRecord | void | Promise<PanIssueRecord | void>;

/**
 * Clear the terminal close-out marker so a reopened issue re-enters the pipeline (sync).
 * Ordinary status writes deliberately preserve closedOut (projectPipeline in records.ts),
 * so reopen needs this explicit inverse of markRecordPipelineClosedOutSync in record.ts
 * (MIN-850, 2026-07-24).
 */
export function clearRecordPipelineClosedOutSync(
  project: ProjectConfig,
  issueId: string,
  reopenedAt = new Date().toISOString(),
): void {
  const record = ensureIssueRecordSync(project, issueId);
  // PAN-3727 review: a merged-only record (mergeStatus='merged', no closedOut
  // marker) is ALSO record-terminal per isRecordPipelineTerminal — the guard
  // must not skip it, or reopening never reaches the mergeStatus clear below.
  if (!record.pipeline.closedOut && !record.pipeline.closedOutAt && record.pipeline.mergeStatus !== 'merged') return;
  record.pipeline.closedOut = undefined;
  record.pipeline.closedOutAt = undefined;
  record.pipeline.reopenedAt = reopenedAt;
  record.pipeline.updatedAt = reopenedAt;
  // PAN-3727: a stale mergeStatus='merged' left over from close-out makes the
  // reopened issue read as record-terminal to resolveParkedPopulation's
  // record-first terminality check, permanently hiding it from the parked
  // population. Reopen is the one place that must drop it.
  if (record.pipeline.mergeStatus === 'merged') record.pipeline.mergeStatus = undefined;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

export async function clearRecordPipelineClosedOut(
  project: ProjectConfig,
  issueId: string,
  options: { reopenedAt?: string; autoCommit?: boolean } = {},
): Promise<boolean> {
  let changed = false;
  const reopenedAt = options.reopenedAt ?? new Date().toISOString();
  await updateIssueRecord(project, issueId, (record) => {
    if (!record.pipeline.closedOut && !record.pipeline.closedOutAt && record.pipeline.mergeStatus !== 'merged') return;
    record.pipeline.closedOut = undefined;
    record.pipeline.closedOutAt = undefined;
    record.pipeline.reopenedAt = reopenedAt;
    record.pipeline.updatedAt = reopenedAt;
    if (record.pipeline.mergeStatus === 'merged') record.pipeline.mergeStatus = undefined;
    changed = true;
  }, { autoCommit: options.autoCommit });
  return changed;
}

interface GitFailure extends Error {
  stderr?: string;
  stdout?: string;
}

interface GitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

class StateMergeConflictError extends Error {
  constructor(message: string, readonly conflictedPaths: string[]) {
    super(message);
    this.name = 'StateMergeConflictError';
  }
}

async function git(gitRoot: string, args: string[], options: GitOptions = {}): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: gitRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, HUSKY: '0' },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return result.stdout.trim();
}

// Mutation steps between git subprocesses are synchronous and not cancellable —
// check the deadline abort explicitly so an aborted reconcile/restore never
// writes the record file or commits after the lock has been released.
function throwIfDurabilityAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Record durability operation aborted at the deadline');
  }
}

function gitFailureMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const failure = error as GitFailure;
    return failure.stderr?.trim() || failure.stdout?.trim() || failure.message;
  }
  return String(error);
}

function isRemoteRefRaceError(message: string): boolean {
  return /non-fast-forward|fetch first|stale info|cannot lock ref.*expected|failed to update ref/i.test(message);
}

function porcelainPaths(status: string): string[] {
  return status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line[2] === ' ' ? line.slice(3) : line[1] === ' ' ? line.slice(2) : line)
    .map((path) => path.includes(' -> ') ? path.split(' -> ').at(-1)! : path)
    .map((path) => path.replace(/\\/g, '/'));
}

async function adoptOrphanedStateWrites(gitRoot: string, signal?: AbortSignal): Promise<void> {
  const status = await git(gitRoot, ['status', '--porcelain=v1', '--untracked-files=all'], { signal });
  const paths = porcelainPaths(status);
  if (paths.length === 0) return;

  const unowned = paths.filter(
    (path) => !STATE_BRANCH_PATHS.some((prefix) => path.startsWith(prefix)),
  );
  if (unowned.length > 0) {
    throw new Error(`State reconcile blocked by unowned changes: ${unowned.join(', ')}`);
  }

  throwIfDurabilityAborted(signal);
  await git(gitRoot, ['add', '--', ...paths], { signal });
  throwIfDurabilityAborted(signal);
  await git(gitRoot, [
    'commit',
    '-m',
    'chore(state): adopt orphaned write before state reconcile (PAN-3296)',
    '--',
    ...paths,
  ], { signal });
  console.warn(`[record-update] adopted orphaned state write(s): ${paths.join(', ')}`);
}

async function abortRebase(gitRoot: string, options: GitOptions = {}): Promise<void> {
  try {
    // Bounded local cleanup: a deadline abort must not extend the lock hold by
    // another full git timeout.
    await git(gitRoot, ['rebase', '--abort'], { timeoutMs: 5_000, ...options });
  } catch {
    // The rebase may already have stopped or completed.
  }
}

async function abortMerge(gitRoot: string, options: GitOptions = {}): Promise<void> {
  try {
    await git(gitRoot, ['merge', '--abort'], { timeoutMs: 5_000, ...options });
  } catch {
    // The merge may already have stopped or completed.
  }
}

async function resolveMergeConflicts(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  gitRoot: string,
  recordPath: string,
  mergeError: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const relativeRecordPath = relative(gitRoot, recordPath).replace(/\\/g, '/');
  const conflicts = (await git(gitRoot, ['diff', '--name-only', '--diff-filter=U'], { signal }))
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
  if (conflicts.length === 0) throw new Error(gitFailureMessage(mergeError));

  try {
    const nonRecordConflicts = conflicts.filter((path) => !path.startsWith('records/'));
    if (nonRecordConflicts.length > 0) {
      throw new Error(`state merge conflicted outside records/: ${nonRecordConflicts.join(', ')}`);
    }

    for (const conflictPath of conflicts) {
      await git(gitRoot, ['checkout', '--theirs', '--', conflictPath], { signal });
      await git(gitRoot, ['add', '--', conflictPath], { signal });
    }

    throwIfDurabilityAborted(signal);
    if (conflicts.includes(relativeRecordPath)) {
      const remoteRecord = readIssueRecordSync(project, issueId);
      if (!remoteRecord) throw new Error(`Remote ${issueId} state record is unreadable`);
      const result = await mutator(remoteRecord);
      throwIfDurabilityAborted(signal);
      writeIssueRecordSync(project, issueId, result ?? remoteRecord);
      await git(gitRoot, ['add', '--', relativeRecordPath], { signal });
    }

    throwIfDurabilityAborted(signal);
    await git(gitRoot, ['-c', 'core.editor=true', 'commit', '--no-edit'], { signal });
  } catch (error) {
    if (error instanceof StateMergeConflictError) throw error;
    throw new StateMergeConflictError(gitFailureMessage(error), conflicts);
  }
}

async function restoreRetryableRecord(
  project: ProjectConfig,
  issueId: string,
  original: PanIssueRecord,
  recordPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const stateHome = resolveStateReadHomeSync(project);
  const gitRoot = stateHome.root;
  const relativeRecordPath = relative(gitRoot, recordPath).replace(/\\/g, '/');
  await abortRebase(gitRoot, { signal });
  await abortMerge(gitRoot, { signal });

  let restored = structuredClone(original);
  const branch = stateHome.migrated
    ? STATE_BRANCH
    : await git(gitRoot, ['branch', '--show-current'], { signal });

  try {
    await git(gitRoot, ['fetch', 'origin', branch], { signal });
    restored = JSON.parse(
      await git(gitRoot, ['show', `origin/${branch}:${relativeRecordPath}`], { signal }),
    ) as PanIssueRecord;
  } catch (fetchError) {
    // An abort at the durability deadline must NOT be swallowed here — the
    // pre-mutation snapshot write below would then run after lock release.
    throwIfDurabilityAborted(signal);
    // Network and remote-read failures must not prevent local retryability. The
    // pre-mutation snapshot is still safer than leaving terminal local state.
    void fetchError;
  }

  throwIfDurabilityAborted(signal);
  writeIssueRecordSync(project, issueId, restored);
  await git(gitRoot, ['add', '--', relativeRecordPath], { signal });

  try {
    await git(gitRoot, ['diff', '--cached', '--quiet', '--', relativeRecordPath], { signal });
    return;
  } catch (diffError) {
    throwIfDurabilityAborted(signal);
    void diffError;
    // A staged diff needs a compensating commit so HEAD, not only the worktree,
    // is retryable. The failed mutation remains auditable in local history.
  }

  await git(gitRoot, [
    'commit',
    '-m',
    `chore(records): restore ${issueId} after failed state push`,
    '--',
    relativeRecordPath,
  ], { signal });
}

async function deliverPendingEscalation(
  project: ProjectConfig,
  escalation: PendingPushEscalation | undefined,
): Promise<void> {
  if (!escalation) return;
  const outcome = await emitActivityEntryOncePortable({
    id: escalation.id,
    source: 'state-door',
    level: 'error',
    issueId: escalation.issueId,
    message: `State pushes for ${project.name} have failed ${escalation.failureCount} times in a row and automatic reconciliation cannot resolve them.`,
    details: `Conflicted paths: ${escalation.conflictedPaths.join(', ') || 'unknown'}. The overdeck-state branch is diverging from origin; run "pan doctor" to see ahead/behind counts, then resolve the conflicted files manually (git merge origin/overdeck-state in the state worktree). Until resolved, durable state written on this machine does not reach other machines.`,
  });
  if (outcome === 'appended' || outcome === 'duplicate') {
    await markPushEscalationDelivered(project, escalation.id);
  } else {
    console.warn(`[pan-dir/records] State reconcile escalation ${escalation.id} remains pending after activity delivery returned ${outcome}`);
  }
}

async function attemptPendingEscalationDelivery(
  project: ProjectConfig,
  escalation: PendingPushEscalation | undefined,
): Promise<void> {
  if (!escalation) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const delivered = deliverPendingEscalation(project, escalation).then(() => true);
    const settled = await Promise.race([
      delivered,
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), PENDING_ESCALATION_DELIVERY_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (!settled) {
      console.warn(`[pan-dir/records] State reconcile escalation ${escalation.id} remains pending after activity delivery timed out`);
    }
  } catch (deliveryError) {
    console.warn(`[pan-dir/records] State reconcile escalation ${escalation.id} remains pending after activity delivery failed: ${gitFailureMessage(deliveryError)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordReconcileFailureHealth(
  project: ProjectConfig,
  issueId: string,
  error: unknown,
  conflictedPaths: string[],
): Promise<PendingPushEscalation | undefined> {
  try {
    const reason = gitFailureMessage(error);
    const { health } = await recordReconcileFailure(project, { issueId, reason, conflictedPaths });
    return health.pendingEscalation;
  } catch (healthError) {
    console.warn(`[pan-dir/records] Failed to record reconcile health for ${issueId}: ${gitFailureMessage(healthError)}`);
    return undefined;
  }
}

async function reconcileStatePush(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  recordPath: string,
  signal?: AbortSignal,
  onPendingEscalation?: (escalation: PendingPushEscalation | undefined) => void,
): Promise<PanIssueRecord> {
  const gitRoot = resolveStateReadHomeSync(project).root;
  let conflictedPaths: string[] = [];

  try {
    await abortMerge(gitRoot, { signal });
    await abortRebase(gitRoot, { signal });

    for (let attempt = 0; attempt < MAX_STATE_PUSH_RECONCILIATIONS; attempt += 1) {
      throwIfDurabilityAborted(signal);
      await git(gitRoot, ['fetch', 'origin', STATE_BRANCH], { signal });
      await adoptOrphanedStateWrites(gitRoot, signal);
      try {
        await git(gitRoot, ['merge', '--no-edit', `origin/${STATE_BRANCH}`], { signal });
      } catch (error) {
        throwIfDurabilityAborted(signal);
        try {
          await resolveMergeConflicts(project, issueId, mutator, gitRoot, recordPath, error, signal);
        } catch (resolveError) {
          if (resolveError instanceof StateMergeConflictError) {
            conflictedPaths = resolveError.conflictedPaths;
          }
          await abortMerge(gitRoot, { signal });
          await abortRebase(gitRoot, { signal });
          throw new Error(
            `Failed to reconcile ${issueId} state after push race: ${gitFailureMessage(resolveError)}`,
            { cause: error },
          );
        }
      }

      try {
        await git(gitRoot, ['push', 'origin', STATE_BRANCH], { signal });
        const record = readIssueRecordSync(project, issueId);
        if (!record) throw new Error(`Reconciled ${issueId} state record is unreadable`);
        try {
          const health = await recordReconcileSuccess(project);
          onPendingEscalation?.(health.pendingEscalation);
        } catch (healthError) {
          console.warn(`[pan-dir/records] Failed to reset reconcile health for ${issueId}: ${gitFailureMessage(healthError)}`);
        }
        return record;
      } catch (error) {
        throwIfDurabilityAborted(signal);
        const message = gitFailureMessage(error);
        if (!isRemoteRefRaceError(message)) {
          throw new Error(`Failed to push reconciled ${issueId} state: ${message}`, { cause: error });
        }
      }
    }

    throw new Error(`Failed to push ${issueId} state after ${MAX_STATE_PUSH_RECONCILIATIONS} reconciliation attempts`);
  } catch (error) {
    onPendingEscalation?.(await recordReconcileFailureHealth(project, issueId, error, conflictedPaths));
    throw error;
  }
}

export async function updateIssueRecord(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  options: UpdateIssueRecordOptions = {},
): Promise<PanIssueRecord> {
  const normalizedIssueId = issueId.toUpperCase();
  const recordPath = getIssueRecordPath(project, normalizedIssueId);
  const writerId = options.writerId ?? process.env.OVERDECK_AGENT_ID ?? `process-${process.pid}@${hostname()}`;
  let pendingEscalation: PendingPushEscalation | undefined;
  try {
    const record = await withRecordFsLock(project, normalizedIssueId, { writerId, recordPath }, async () => {
      const operation = async (): Promise<PanIssueRecord> => {
        const current = readIssueRecordSync(project, normalizedIssueId) ?? ensureIssueRecordSync(project, normalizedIssueId);
        const original = structuredClone(current);
        const result = await mutator(current);
        const next = result ?? current;
        const path = writeIssueRecordSync(project, normalizedIssueId, next);
        if (options.autoCommit === false) {
          return readIssueRecordSync(project, normalizedIssueId) ?? next;
        }

        const budgetMs = recordDurabilityBudgetMs();
        const deadlineMs = Date.now() + budgetMs;
        try {
          const commitRoot = queueIssueRecordCommit(project, normalizedIssueId, path);
          // Start and await the explicit flush while the issue lock is held. No second
          // writer may observe the local terminal state before its durability outcome
          // is known, and the queue's zero-delay timer cannot consume this batch first.
          // The wait is bounded (PAN-2989): a stalled push must not starve peer writers
          // for minutes — on timeout the lock releases and the flush continues in the
          // background.
          const flushed = await withRecordDurabilityDeadline(
            normalizedIssueId,
            Effect.runPromise(flushAutoCommits(commitRoot)),
            deadlineMs,
            budgetMs,
          );
          if (flushed.pushed === false) {
            const stateHome = resolveStateReadHomeSync(project);
            if (stateHome.migrated && isRemoteRefRaceError(flushed.reason ?? '')) {
              const reconcileAbort = new AbortController();
              const reconcilePromise = reconcileStatePush(
                project,
                normalizedIssueId,
                mutator,
                path,
                reconcileAbort.signal,
                (escalation) => {
                  pendingEscalation = escalation;
                },
              );
              return await withRecordDurabilityDeadline(
                normalizedIssueId,
                reconcilePromise,
                deadlineMs,
                budgetMs,
                async () => {
                  // Stop the reconcile's git subprocesses and wait for them to die —
                  // nothing it started may rebase/push/write after the lock releases.
                  reconcileAbort.abort();
                  await reconcilePromise.catch(() => undefined);
                  // Leave the worktree out of a mid-reconcile state; bounded local
                  // cleanup, not another full git timeout under the lock.
                  const gitRoot = resolveStateReadHomeSync(project).root;
                  await abortRebase(gitRoot);
                  await abortMerge(gitRoot);
                },
              );
            }
            throw new Error(`Failed to push ${normalizedIssueId} state: ${flushed.reason ?? 'unknown push failure'}`);
          }
          if (!flushed.committed && !['no diff', 'no pending'].includes(flushed.reason ?? '')) {
            throw new Error(`Failed to commit ${normalizedIssueId} state: ${flushed.reason ?? 'unknown commit failure'}`);
          }

          return readIssueRecordSync(project, normalizedIssueId) ?? next;
        } catch (error) {
          // Never restore on a durability timeout (PAN-2989): the background flush may
          // still land the commit, so rewinding to the pre-mutation snapshot would race it.
          if (error instanceof RecordDurabilityTimeoutError) throw error;
          try {
            const restoreAbort = new AbortController();
            const restorePromise = restoreRetryableRecord(project, normalizedIssueId, original, path, restoreAbort.signal);
            await withRecordDurabilityDeadline(
              normalizedIssueId,
              restorePromise,
              deadlineMs,
              budgetMs,
              async () => {
                // Same post-release guarantee as the reconcile path: kill the
                // restore's git subprocesses and await their settlement so the
                // pre-mutation snapshot can never overwrite a newer writer.
                restoreAbort.abort();
                await restorePromise.catch(() => undefined);
              },
            );
          } catch (restoreError) {
            if (restoreError instanceof RecordDurabilityTimeoutError) throw restoreError;
            throw new Error(
              `Failed to persist ${normalizedIssueId} state and restore retryability: ${gitFailureMessage(restoreError)}`,
              { cause: error },
            );
          }
          throw error;
        }
      };

      const stateHome = resolveStateReadHomeSync(project);
      return stateHome.migrated
        ? withStateGitLock(stateHome.root, writerId, recordPath, operation)
        : operation();
    });
    await attemptPendingEscalationDelivery(project, pendingEscalation);
    return record;
  } catch (error) {
    await attemptPendingEscalationDelivery(project, pendingEscalation);
    throw error;
  }
}
