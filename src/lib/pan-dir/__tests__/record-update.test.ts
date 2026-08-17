import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import type { PanIssueRecord } from '../record.js';
import { updateIssueRecord, clearRecordPipelineClosedOutSync, clearRecordPipelineClosedOut } from '../record-update.js';

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

  it('aborts an in-progress merge before restoring retryable state', async () => {
    const other = mkdtempSync(join(tmpdir(), 'pan-record-update-merge-other-'));
    const otherRecordPath = join(root, '.pan', 'records', 'other-1.json');
    const targetRecordPath = join(root, '.pan', 'records', 'durable-1.json');

    try {
      writeFileSync(otherRecordPath, JSON.stringify({ issueId: 'OTHER-1', summary: 'shared' }, null, 2));
      git(root, 'add', '.pan/records/other-1.json');
      git(root, 'commit', '-q', '-m', 'seed second record');
      git(root, 'push', '-q', 'origin', 'main');

      git(root, 'clone', '-q', '-b', 'main', remote, other);
      git(other, 'config', 'user.email', 'remote@overdeck.local');
      git(other, 'config', 'user.name', 'Remote Writer');
      git(other, 'config', 'commit.gpgsign', 'false');

      writeFileSync(otherRecordPath, JSON.stringify({ issueId: 'OTHER-1', summary: 'local' }, null, 2));
      git(root, 'add', '.pan/records/other-1.json');
      git(root, 'commit', '-q', '-m', 'local second record update');

      const remoteOtherRecordPath = join(other, '.pan', 'records', 'other-1.json');
      writeFileSync(remoteOtherRecordPath, JSON.stringify({ issueId: 'OTHER-1', summary: 'remote' }, null, 2));
      git(other, 'add', '.pan/records/other-1.json');
      git(other, 'commit', '-q', '-m', 'remote second record update');
      git(other, 'push', '-q', 'origin', 'main');

      git(root, 'fetch', '-q', 'origin', 'main');
      expect(() => git(root, 'merge', 'origin/main')).toThrow();
      expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(true);

      await expect(updateIssueRecord(project, ISSUE_ID, (record) => {
        record.statusOverrides = { 'wi-1': 'completed' };
      })).rejects.toThrow();

      expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false);
      expect(git(root, 'status', '--porcelain')).toBe('');
      const restored = JSON.parse(readFileSync(targetRecordPath, 'utf8')) as PanIssueRecord;
      expect(restored.statusOverrides).toEqual({});
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('restores retryable state when a remote-ref race survives reconciliation', async () => {
    const stateRoot = join(process.env.OVERDECK_HOME!, 'state', basename(root));
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

    const rejectFlag = join(remote, 'reject-state-push');
    const preReceiveHook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(preReceiveHook, `#!/bin/sh\nif [ -f '${rejectFlag}' ]; then\n  echo "error: cannot lock ref 'refs/heads/overdeck-state': is at ${'a'.repeat(40)} but expected ${'b'.repeat(40)}" >&2\n  exit 1\nfi\n`);
    chmodSync(preReceiveHook, 0o755);
    writeFileSync(rejectFlag, 'reject');

    const completeTask = (record: PanIssueRecord): void => {
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-1': 'completed' };
    };
    const migratedProject = { ...project, path: stateRoot };

    await expect(updateIssueRecord(migratedProject, ISSUE_ID, completeTask))
      .rejects.toThrow('after 3 reconciliation attempts');

    const localAfterFailure = JSON.parse(readFileSync(join(stateRoot, 'records', 'durable-1.json'), 'utf8')) as PanIssueRecord;
    const headAfterFailure = JSON.parse(git(stateRoot, 'show', 'HEAD:records/durable-1.json')) as PanIssueRecord;
    const remoteAfterFailure = JSON.parse(git(stateRoot, 'show', 'origin/overdeck-state:records/durable-1.json')) as PanIssueRecord;
    expect(localAfterFailure.statusOverrides).toEqual({});
    expect(headAfterFailure.statusOverrides).toEqual({});
    expect(remoteAfterFailure.statusOverrides).toEqual({});
    expect(git(stateRoot, 'status', '--porcelain')).toBe('');

    unlinkSync(rejectFlag);
    await updateIssueRecord(migratedProject, ISSUE_ID, completeTask);

    const durable = JSON.parse(git(stateRoot, 'show', 'origin/overdeck-state:records/durable-1.json')) as PanIssueRecord;
    expect(durable.statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(JSON.parse(readFileSync(join(stateRoot, 'records', 'durable-1.json'), 'utf8'))).toEqual(durable);
    expect(JSON.parse(git(stateRoot, 'show', 'HEAD:records/durable-1.json'))).toEqual(durable);
    expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(git(stateRoot, 'rev-parse', 'origin/overdeck-state'));
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

describe('clearRecordPipelineClosedOut drops stale mergeStatus (PAN-3727)', () => {
  const ISSUE = 'REOPEN-1';
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  function seedClosedOutRecord(): void {
    const record = {
      issueId: ISSUE,
      schemaVersion: 2,
      statusOverrides: {},
      pipeline: {
        issueId: ISSUE,
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: new Date().toISOString(),
        closedOut: true,
        closedOutAt: '2026-08-06T00:00:00.000Z',
        mergeStatus: 'merged',
      },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
    } as unknown as PanIssueRecord;
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'reopen-1.json'), JSON.stringify(record));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed closed-out record');
    git(root, 'push', '-q', 'origin', 'main');
  }

  function seedMergedOnlyRecord(): void {
    const record = {
      issueId: ISSUE,
      schemaVersion: 2,
      statusOverrides: {},
      pipeline: {
        issueId: ISSUE,
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        updatedAt: new Date().toISOString(),
        mergeStatus: 'merged',
      },
      closeOut: null,
    } as unknown as PanIssueRecord;
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'reopen-1.json'), JSON.stringify(record));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed merged-only record');
    git(root, 'push', '-q', 'origin', 'main');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-record-reopen-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-record-reopen-origin-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    project = { name: 'Reopen', path: root };

    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'commit', '-q', '--allow-empty', '-m', 'seed root');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('clearRecordPipelineClosedOutSync clears closedOut, stamps reopenedAt, and drops mergeStatus', () => {
    seedClosedOutRecord();

    clearRecordPipelineClosedOutSync(project, ISSUE, '2026-08-14T00:00:00.000Z');

    const persisted = JSON.parse(readFileSync(join(root, '.pan', 'records', 'reopen-1.json'), 'utf8')) as PanIssueRecord;
    expect(persisted.pipeline.closedOut).toBeUndefined();
    expect(persisted.pipeline.closedOutAt).toBeUndefined();
    expect(persisted.pipeline.reopenedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(persisted.pipeline.mergeStatus).toBeUndefined();
  });

  it('clearRecordPipelineClosedOut (async) clears closedOut and drops mergeStatus', async () => {
    seedClosedOutRecord();

    const changed = await clearRecordPipelineClosedOut(project, ISSUE, { reopenedAt: '2026-08-14T00:00:00.000Z' });

    expect(changed).toBe(true);
    const persisted = JSON.parse(readFileSync(join(root, '.pan', 'records', 'reopen-1.json'), 'utf8')) as PanIssueRecord;
    expect(persisted.pipeline.closedOut).toBeUndefined();
    expect(persisted.pipeline.mergeStatus).toBeUndefined();
  });

  it('clearRecordPipelineClosedOutSync also clears a merged-only record with no close-out marker (review finding)', () => {
    seedMergedOnlyRecord();

    clearRecordPipelineClosedOutSync(project, ISSUE, '2026-08-14T00:00:00.000Z');

    const persisted = JSON.parse(readFileSync(join(root, '.pan', 'records', 'reopen-1.json'), 'utf8')) as PanIssueRecord;
    expect(persisted.pipeline.mergeStatus).toBeUndefined();
    expect(persisted.pipeline.reopenedAt).toBe('2026-08-14T00:00:00.000Z');
  });

  it('clearRecordPipelineClosedOut (async) also clears a merged-only record with no close-out marker (review finding)', async () => {
    seedMergedOnlyRecord();

    const changed = await clearRecordPipelineClosedOut(project, ISSUE, { reopenedAt: '2026-08-14T00:00:00.000Z' });

    expect(changed).toBe(true);
    const persisted = JSON.parse(readFileSync(join(root, '.pan', 'records', 'reopen-1.json'), 'utf8')) as PanIssueRecord;
    expect(persisted.pipeline.mergeStatus).toBeUndefined();
    expect(persisted.pipeline.reopenedAt).toBe('2026-08-14T00:00:00.000Z');
  });
});
