import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import type { ProjectConfig } from '../../projects.js';
import { writeIssueRecordSync, type PanIssueRecord } from '../record.js';
import { updateIssueRecord } from '../record-update.js';
import { flushAutoCommits } from '../auto-commit.js';

const ISSUE_ID = 'DURABLE-1';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('updateIssueRecord durability', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-record-update-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-record-update-origin-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    project = { name: 'Durability', path: root };

    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(root, 'remote', 'add', 'origin', remote);

    const record = {
      issueId: ISSUE_ID,
      schemaVersion: 2,
      statusOverrides: {},
      pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: new Date().toISOString() },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
    } as PanIssueRecord;
    writeIssueRecordSync(project, ISSUE_ID, record);
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');
    await Effect.runPromise(flushAutoCommits(root));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('does not resolve until the record commit is present on origin', async () => {
    await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });

    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(git(root, 'rev-parse', 'origin/main'));
    expect(git(root, 'log', '-1', '--format=%s')).toBe(`chore(records): update ${ISSUE_ID} per-issue record`);
  });
});
