/** Canonical bounded enumeration facet of the issue-record read door. */
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import { RECORD_DIRNAME, type PanIssueRecord } from './record.js';

async function readIssueRecordDirectory(
  recordsDir: string,
  records: Map<string, PanIssueRecord>,
): Promise<void> {
  const entries = await fsp.readdir(recordsDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      try {
        const record = JSON.parse(await fsp.readFile(join(recordsDir, entry.name), 'utf-8')) as PanIssueRecord;
        if (record.issueId) records.set(record.issueId.toUpperCase(), record);
      } catch (error) {
        console.warn(
          `[record] Preserving unreadable issue record ${join(recordsDir, entry.name)} during enumeration: `
          + `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }));
}

export async function listIssueRecords(project: ProjectConfig): Promise<PanIssueRecord[]> {
  const stateHome = resolveStateReadHomeSync(project);
  const records = new Map<string, PanIssueRecord>();
  if (stateHome.migrated) {
    await readIssueRecordDirectory(join(stateHome.root, RECORD_DIRNAME), records);
    return [...records.values()];
  }

  await readIssueRecordDirectory(join(project.path, '.pan', RECORD_DIRNAME), records);
  const workspacesDir = join(project.path, 'workspaces');
  const workspaces = await fsp.readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(workspaces
    .filter((entry) => entry.isDirectory())
    .map((entry) => readIssueRecordDirectory(
      join(workspacesDir, entry.name, '.pan', RECORD_DIRNAME),
      records,
    )));
  return [...records.values()];
}
