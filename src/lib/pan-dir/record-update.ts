/** The single locked read-modify-write door for per-issue records. */
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync, STATE_BRANCH } from '../state-read-home.js';
import { flushAutoCommits } from './auto-commit.js';
import { withRecordFsLock } from './fs-lock.js';
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

interface GitFailure extends Error {
  stderr?: string;
  stdout?: string;
}

async function git(gitRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: gitRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, HUSKY: '0' },
  });
  return result.stdout.trim();
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

async function abortRebase(gitRoot: string): Promise<void> {
  try {
    await git(gitRoot, ['rebase', '--abort']);
  } catch {
    // The rebase may already have stopped or completed.
  }
}

async function replayConflictedRecord(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  gitRoot: string,
  recordPath: string,
): Promise<void> {
  const relativeRecordPath = relative(gitRoot, recordPath).replace(/\\/g, '/');
  const conflicts = (await git(gitRoot, ['diff', '--name-only', '--diff-filter=U']))
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
  if (conflicts.length !== 1 || conflicts[0] !== relativeRecordPath) {
    throw new Error(`state rebase conflicted outside ${relativeRecordPath}: ${conflicts.join(', ') || 'unknown conflict'}`);
  }

  // Replace Git's conflict markers with the valid remote record before entering
  // the verified write door; otherwise it would preserve the markers as a
  // corrupt-record sidecar instead of resolving this known Git conflict.
  await git(gitRoot, [
    'restore',
    `--source=origin/${STATE_BRANCH}`,
    '--worktree',
    '--',
    relativeRecordPath,
  ]);
  const remoteRecord = readIssueRecordSync(project, issueId);
  if (!remoteRecord) throw new Error(`Remote ${issueId} state record is unreadable`);
  const result = await mutator(remoteRecord);
  writeIssueRecordSync(project, issueId, result ?? remoteRecord);
  await git(gitRoot, ['add', '--', relativeRecordPath]);
  await git(gitRoot, ['-c', 'core.editor=true', 'rebase', '--continue']);
}

async function restoreRetryableRecord(
  project: ProjectConfig,
  issueId: string,
  original: PanIssueRecord,
  recordPath: string,
): Promise<void> {
  const stateHome = resolveStateReadHomeSync(project);
  const gitRoot = stateHome.root;
  const relativeRecordPath = relative(gitRoot, recordPath).replace(/\\/g, '/');
  await abortRebase(gitRoot);

  let restored = structuredClone(original);
  const branch = stateHome.migrated
    ? STATE_BRANCH
    : await git(gitRoot, ['branch', '--show-current']);

  try {
    await git(gitRoot, ['fetch', 'origin', branch]);
    restored = JSON.parse(
      await git(gitRoot, ['show', `origin/${branch}:${relativeRecordPath}`]),
    ) as PanIssueRecord;
  } catch {
    // Network and remote-read failures must not prevent local retryability. The
    // pre-mutation snapshot is still safer than leaving terminal local state.
  }

  writeIssueRecordSync(project, issueId, restored);
  await git(gitRoot, ['add', '--', relativeRecordPath]);

  try {
    await git(gitRoot, ['diff', '--cached', '--quiet', '--', relativeRecordPath]);
    return;
  } catch {
    // A staged diff needs a compensating commit so HEAD, not only the worktree,
    // is retryable. The failed mutation remains auditable in local history.
  }

  await git(gitRoot, [
    'commit',
    '-m',
    `chore(records): restore ${issueId} after failed state push`,
    '--',
    relativeRecordPath,
  ]);
}

async function reconcileStatePush(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  recordPath: string,
): Promise<PanIssueRecord> {
  const gitRoot = resolveStateReadHomeSync(project).root;

  for (let attempt = 0; attempt < MAX_STATE_PUSH_RECONCILIATIONS; attempt += 1) {
    await git(gitRoot, ['fetch', 'origin', STATE_BRANCH]);
    try {
      await git(gitRoot, ['rebase', `origin/${STATE_BRANCH}`]);
    } catch (error) {
      try {
        await replayConflictedRecord(project, issueId, mutator, gitRoot, recordPath);
      } catch (replayError) {
        await abortRebase(gitRoot);
        throw new Error(
          `Failed to reconcile ${issueId} state after push race: ${gitFailureMessage(replayError)}`,
          { cause: error },
        );
      }
    }

    try {
      await git(gitRoot, ['push', 'origin', STATE_BRANCH]);
      const record = readIssueRecordSync(project, issueId);
      if (!record) throw new Error(`Reconciled ${issueId} state record is unreadable`);
      return record;
    } catch (error) {
      const message = gitFailureMessage(error);
      if (!isRemoteRefRaceError(message)) {
        throw new Error(`Failed to push reconciled ${issueId} state: ${message}`, { cause: error });
      }
    }
  }

  throw new Error(`Failed to push ${issueId} state after ${MAX_STATE_PUSH_RECONCILIATIONS} reconciliation attempts`);
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
  return withRecordFsLock(project, normalizedIssueId, { writerId, recordPath }, async () => {
    const current = readIssueRecordSync(project, normalizedIssueId) ?? ensureIssueRecordSync(project, normalizedIssueId);
    const original = structuredClone(current);
    const result = await mutator(current);
    const next = result ?? current;
    const path = writeIssueRecordSync(project, normalizedIssueId, next);
    if (options.autoCommit === false) {
      return readIssueRecordSync(project, normalizedIssueId) ?? next;
    }

    try {
      const commitRoot = queueIssueRecordCommit(project, normalizedIssueId, path);
      // Start and await the explicit flush while the issue lock is held. No second
      // writer may observe the local terminal state before its durability outcome
      // is known, and the queue's zero-delay timer cannot consume this batch first.
      const flushed = await Effect.runPromise(flushAutoCommits(commitRoot));
      if (flushed.pushed === false) {
        const stateHome = resolveStateReadHomeSync(project);
        if (stateHome.migrated && isRemoteRefRaceError(flushed.reason ?? '')) {
          return await reconcileStatePush(project, normalizedIssueId, mutator, path);
        }
        throw new Error(`Failed to push ${normalizedIssueId} state: ${flushed.reason ?? 'unknown push failure'}`);
      }
      if (!flushed.committed && !['no diff', 'no pending'].includes(flushed.reason ?? '')) {
        throw new Error(`Failed to commit ${normalizedIssueId} state: ${flushed.reason ?? 'unknown commit failure'}`);
      }

      return readIssueRecordSync(project, normalizedIssueId) ?? next;
    } catch (error) {
      try {
        await restoreRetryableRecord(project, normalizedIssueId, original, path);
      } catch (restoreError) {
        throw new Error(
          `Failed to persist ${normalizedIssueId} state and restore retryability: ${gitFailureMessage(restoreError)}`,
          { cause: error },
        );
      }
      throw error;
    }
  });
}
