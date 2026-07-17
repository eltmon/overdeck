import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import type { PanIssueRecord } from '../record.js';
import { updateIssueRecord } from '../record-update.js';

const ISSUE_ID = 'DURABLE-1';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('updateIssueRecord durability', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
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
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'durable-1.json'), JSON.stringify(record));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');
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

  it('replays the concrete record mutation after a concurrent overdeck-state advance', async () => {
    const stateRoot = join(process.env.OVERDECK_HOME!, 'state', basename(root));
    const other = mkdtempSync(join(tmpdir(), 'pan-record-update-other-'));
    mkdirSync(join(stateRoot, 'records'), { recursive: true });
    git(stateRoot, 'init', '-q');
    git(stateRoot, 'config', 'user.email', 'test@overdeck.local');
    git(stateRoot, 'config', 'user.name', 'Overdeck Test');
    git(stateRoot, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
      sourceMainSha: '0'.repeat(40),
      stateBranchSha: '0'.repeat(40),
      completedAt: '2026-07-17T00:00:00.000Z',
      version: 1,
    }));
    writeFileSync(join(stateRoot, 'records', 'durable-1.json'), JSON.stringify({
      issueId: ISSUE_ID,
      schemaVersion: 2,
      statusOverrides: {},
      pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-07-17T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
    } satisfies PanIssueRecord, null, 2));
    git(stateRoot, 'add', '.');
    git(stateRoot, 'commit', '-q', '-m', 'seed state branch');
    git(stateRoot, 'branch', '-M', 'overdeck-state');
    git(stateRoot, 'remote', 'add', 'origin', remote);
    git(stateRoot, 'push', '-q', '-u', 'origin', 'overdeck-state');

    try {
      git(root, 'clone', '-q', '-b', 'overdeck-state', remote, other);
      git(other, 'config', 'user.email', 'remote@overdeck.local');
      git(other, 'config', 'user.name', 'Remote Writer');
      git(other, 'config', 'commit.gpgsign', 'false');
      const remotePath = join(other, 'records', 'durable-1.json');
      const remoteRecord = JSON.parse(readFileSync(remotePath, 'utf8')) as PanIssueRecord;
      remoteRecord.decisions = [{ id: 'D1', summary: 'preserve concurrent state', recordedAt: '2026-07-17T00:01:00.000Z' }];
      writeFileSync(remotePath, JSON.stringify(remoteRecord, null, 2));
      git(other, 'add', 'records/durable-1.json');
      git(other, 'commit', '-q', '-m', 'concurrent record update');
      git(other, 'push', '-q', 'origin', 'overdeck-state');

      await updateIssueRecord({ ...project, path: stateRoot }, ISSUE_ID, (record) => {
        record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-1': 'completed' };
      });

      const durable = JSON.parse(git(stateRoot, 'show', 'origin/overdeck-state:records/durable-1.json')) as PanIssueRecord;
      expect(durable.statusOverrides).toEqual({ 'wi-1': 'completed' });
      expect(durable.decisions).toEqual([{ id: 'D1', summary: 'preserve concurrent state', recordedAt: '2026-07-17T00:01:00.000Z' }]);
      expect(JSON.parse(readFileSync(join(stateRoot, 'records', 'durable-1.json'), 'utf8'))).toEqual(durable);
      expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(git(stateRoot, 'rev-parse', 'origin/overdeck-state'));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
