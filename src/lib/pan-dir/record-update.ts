/** The single locked read-modify-write door for per-issue records. */
import { hostname } from 'node:os';
import { Effect } from 'effect';

import type { ProjectConfig } from '../projects.js';
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

export async function updateIssueRecord(
  project: ProjectConfig,
  issueId: string,
  mutator: IssueRecordMutator,
  options: UpdateIssueRecordOptions = {},
): Promise<PanIssueRecord> {
  const normalizedIssueId = issueId.toUpperCase();
  const recordPath = getIssueRecordPath(project, normalizedIssueId);
  const writerId = options.writerId ?? process.env.OVERDECK_AGENT_ID ?? `process-${process.pid}@${hostname()}`;
  let commitRoot: string | null = null;
  const record = await withRecordFsLock(project, normalizedIssueId, { writerId, recordPath }, async () => {
    const current = readIssueRecordSync(project, normalizedIssueId) ?? ensureIssueRecordSync(project, normalizedIssueId);
    const result = await mutator(current);
    const next = result ?? current;
    const path = writeIssueRecordSync(project, normalizedIssueId, next);
    if (options.autoCommit !== false) commitRoot = queueIssueRecordCommit(project, normalizedIssueId, path);
    return readIssueRecordSync(project, normalizedIssueId) ?? next;
  });

  if (commitRoot) {
    const flushed = await Effect.runPromise(flushAutoCommits(commitRoot));
    if (flushed.pushed === false) {
      throw new Error(`Failed to push ${normalizedIssueId} state: ${flushed.reason ?? 'unknown push failure'}`);
    }
    if (!flushed.committed && !['no diff', 'no pending'].includes(flushed.reason ?? '')) {
      throw new Error(`Failed to commit ${normalizedIssueId} state: ${flushed.reason ?? 'unknown commit failure'}`);
    }
  }

  return record;
}
