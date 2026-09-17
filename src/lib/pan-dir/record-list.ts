/** Canonical bounded enumeration facet of the issue-record read door. */
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import { RECORD_DIRNAME, type PanIssueRecord } from './record.js';

/**
 * Concurrency ceiling for record reads. An unbounded `Promise.all` over every
 * `.json` in a records directory opens one file handle per record; a project
 * with hundreds of issues (panopticon-cli has 750+) can exhaust descriptors and
 * starve the event loop on the dashboard's own request path.
 */
export const RECORD_ENUMERATION_CONCURRENCY = 8;
/** Workspace directories scanned per project in the legacy layout. */
export const RECORD_ENUMERATION_MAX_WORKSPACES = 200;

/**
 * A directory that could not be listed, or a record file that could not be read
 * or parsed. Callers that need to distinguish "nothing happened" from "we could
 * not look" consume these through {@link listIssueRecordsDetailed}; swallowing
 * them silently makes an unreadable store indistinguishable from an empty one.
 */
export interface RecordEnumerationFailure {
  kind: 'readdir' | 'record';
  path: string;
  message: string;
}

async function mapBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

async function readIssueRecordDirectory(
  recordsDir: string,
  records: Map<string, PanIssueRecord>,
  failures: RecordEnumerationFailure[],
): Promise<void> {
  let entries: { isFile(): boolean; name: string }[] = [];
  try {
    entries = await fsp.readdir(recordsDir, { withFileTypes: true }) as never;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // A records directory that does not exist is a normal shape (a project with
    // no records yet), not a failure. Anything else — EACCES, EIO, ENOTDIR — is
    // a real inability to read and must reach the caller.
    if (code !== 'ENOENT') {
      failures.push({
        kind: 'readdir',
        path: recordsDir,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  await mapBounded(files, RECORD_ENUMERATION_CONCURRENCY, async (entry) => {
    const path = join(recordsDir, entry.name);
    try {
      const record = JSON.parse(await fsp.readFile(path, 'utf-8')) as PanIssueRecord;
      if (record.issueId) records.set(record.issueId.toUpperCase(), record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ kind: 'record', path, message });
      console.warn(
        `[record] Preserving unreadable issue record ${path} during enumeration: ${message}`,
      );
    }
  });
}

/**
 * Enumerate a project's issue records AND report what could not be read.
 *
 * Prefer this over {@link listIssueRecords} whenever an empty result would be
 * reported to a human or a model: the array-only form cannot distinguish an
 * empty store from an unreadable one.
 */
export async function listIssueRecordsDetailed(
  project: ProjectConfig,
): Promise<{ records: PanIssueRecord[]; failures: RecordEnumerationFailure[] }> {
  const stateHome = resolveStateReadHomeSync(project);
  const records = new Map<string, PanIssueRecord>();
  const failures: RecordEnumerationFailure[] = [];
  if (stateHome.migrated) {
    await readIssueRecordDirectory(join(stateHome.root, RECORD_DIRNAME), records, failures);
    return { records: [...records.values()], failures };
  }

  await readIssueRecordDirectory(join(project.path, '.pan', RECORD_DIRNAME), records, failures);
  const workspacesDir = join(project.path, 'workspaces');
  let workspaces: { isDirectory(): boolean; name: string }[] = [];
  try {
    workspaces = await fsp.readdir(workspacesDir, { withFileTypes: true }) as never;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      failures.push({
        kind: 'readdir',
        path: workspacesDir,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const dirs = workspaces
    .filter((entry) => entry.isDirectory())
    .slice(0, RECORD_ENUMERATION_MAX_WORKSPACES);
  await mapBounded(dirs, RECORD_ENUMERATION_CONCURRENCY, (entry) => readIssueRecordDirectory(
    join(workspacesDir, entry.name, '.pan', RECORD_DIRNAME),
    records,
    failures,
  ));
  return { records: [...records.values()], failures };
}

/**
 * Array-only enumeration, preserved for callers that only need the records.
 * Delegates to {@link listIssueRecordsDetailed} so both forms share one
 * traversal and one concurrency bound.
 */
export async function listIssueRecords(project: ProjectConfig): Promise<PanIssueRecord[]> {
  return (await listIssueRecordsDetailed(project)).records;
}
