import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import { STATE_BRANCH } from '../../state-read-home.js';
import type { PanIssueRecord } from '../record.js';
import { updateIssueRecord } from '../record-update.js';

const ISSUE_ID = 'DURABLE-1';
const OTHER_ISSUE_ID = 'OTHER-1';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function record(issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    statusOverrides: {},
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  } as PanIssueRecord;
}

function recordPath(root: string, issueId: string): string {
  return join(root, 'records', `${issueId.toLowerCase()}.json`);
}

function writeRecord(root: string, value: PanIssueRecord): void {
  writeFileSync(recordPath(root, value.issueId), JSON.stringify(value, null, 2));
}

function readRecord(root: string, issueId: string): PanIssueRecord {
  return JSON.parse(readFileSync(recordPath(root, issueId), 'utf8')) as PanIssueRecord;
}

function readRecordAtRef(root: string, ref: string, issueId: string): PanIssueRecord {
  return JSON.parse(git(root, 'show', `${ref}:records/${issueId.toLowerCase()}.json`)) as PanIssueRecord;
}

describe('record push-race merge reconciliation (PAN-3291)', () => {
  let sandbox: string;
  let stateRoot: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'pan-record-reconcile-'));
    process.env.OVERDECK_HOME = join(sandbox, 'home');
    stateRoot = join(process.env.OVERDECK_HOME, 'state', 'reconcile');
    remote = join(sandbox, 'origin.git');
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(remote, { recursive: true });
    project = { name: 'Reconcile', path: stateRoot };

    git(stateRoot, 'init', '-q');
    git(stateRoot, 'config', 'user.email', 'test@overdeck.local');
    git(stateRoot, 'config', 'user.name', 'Overdeck Test');
    git(stateRoot, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(stateRoot, 'remote', 'add', 'origin', remote);

    mkdirSync(join(stateRoot, 'records'), { recursive: true });
    mkdirSync(join(stateRoot, 'specs'), { recursive: true });
    writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
      sourceMainSha: '0'.repeat(40),
      stateBranchSha: '0'.repeat(40),
      completedAt: '2026-07-30T00:00:00.000Z',
      version: 1,
    }, null, 2));
    writeRecord(stateRoot, record(ISSUE_ID));
    writeRecord(stateRoot, record(OTHER_ISSUE_ID));
    writeRecord(stateRoot, record('SPARE-1'));
    writeFileSync(join(stateRoot, 'specs', 'shared.json'), JSON.stringify({ value: 'shared' }, null, 2));
    git(stateRoot, 'add', '.');
    git(stateRoot, 'commit', '-q', '-m', 'seed state branch');
    git(stateRoot, 'branch', '-M', STATE_BRANCH);
    git(stateRoot, 'push', '-q', '-u', 'origin', STATE_BRANCH);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(sandbox, { recursive: true, force: true });
  });

  function cloneState(name: string): string {
    const clone = join(sandbox, name);
    git(stateRoot, 'clone', '-q', '-b', STATE_BRANCH, remote, clone);
    git(clone, 'config', 'user.email', `${name}@overdeck.local`);
    git(clone, 'config', 'user.name', name);
    git(clone, 'config', 'commit.gpgsign', 'false');
    return clone;
  }

  it('replays the active record mutation on the origin side of a two-writer conflict', async () => {
    const other = cloneState('remote-writer');
    const remoteRecord = readRecord(other, ISSUE_ID);
    remoteRecord.decisions = [{ id: 'D1', summary: 'remote decision', recordedAt: '2026-07-30T00:01:00.000Z' }];
    writeRecord(other, remoteRecord);
    git(other, 'add', `records/${ISSUE_ID.toLowerCase()}.json`);
    git(other, 'commit', '-q', '-m', 'remote record update');
    git(other, 'push', '-q', 'origin', STATE_BRANCH);

    await updateIssueRecord(project, ISSUE_ID, (current) => {
      current.statusOverrides = { 'wi-1': 'completed' };
    });

    const durable = readRecordAtRef(stateRoot, `origin/${STATE_BRANCH}`, ISSUE_ID);
    expect(durable.decisions).toEqual(remoteRecord.decisions);
    expect(durable.statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(readRecord(stateRoot, ISSUE_ID)).toEqual(durable);
    expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(git(stateRoot, 'rev-parse', `origin/${STATE_BRANCH}`));
    expect(git(stateRoot, 'log', `origin/${STATE_BRANCH}`, '--format=%s')).not.toContain(`restore ${ISSUE_ID}`);
  });

  it('converges a multi-commit local stack with a poisoned intermediate record commit', async () => {
    const other = cloneState('poison-remote-writer');

    const spare = readRecord(stateRoot, 'SPARE-1');
    spare.decisions = [{ id: 'D1', summary: 'first local commit', recordedAt: '2026-07-30T00:01:00.000Z' }];
    writeRecord(stateRoot, spare);
    git(stateRoot, 'add', 'records/spare-1.json');
    git(stateRoot, 'commit', '-q', '-m', 'first local state commit');

    const localOther = readRecord(stateRoot, OTHER_ISSUE_ID);
    localOther.decisions = [{ id: 'D1', summary: 'poisoned local mirror', recordedAt: '2026-07-30T00:02:00.000Z' }];
    writeRecord(stateRoot, localOther);
    git(stateRoot, 'add', `records/${OTHER_ISSUE_ID.toLowerCase()}.json`);
    git(stateRoot, 'commit', '-q', '-m', `chore(records): restore ${OTHER_ISSUE_ID} after failed state push`);

    spare.decisions?.push({ id: 'D2', summary: 'third local commit', recordedAt: '2026-07-30T00:03:00.000Z' });
    writeRecord(stateRoot, spare);
    git(stateRoot, 'add', 'records/spare-1.json');
    git(stateRoot, 'commit', '-q', '-m', 'third local state commit');

    const originOther = readRecord(other, OTHER_ISSUE_ID);
    originOther.decisions = [{ id: 'D1', summary: 'origin mirror wins', recordedAt: '2026-07-30T00:04:00.000Z' }];
    writeRecord(other, originOther);
    git(other, 'add', `records/${OTHER_ISSUE_ID.toLowerCase()}.json`);
    git(other, 'commit', '-q', '-m', 'origin conflicting mirror update');
    git(other, 'push', '-q', 'origin', STATE_BRANCH);

    await updateIssueRecord(project, ISSUE_ID, (current) => {
      current.statusOverrides = { 'wi-1': 'completed' };
    });

    expect(git(stateRoot, 'rev-list', '--left-right', '--count', `${STATE_BRANCH}...origin/${STATE_BRANCH}`))
      .toBe('0\t0');
    expect(readRecordAtRef(stateRoot, `origin/${STATE_BRANCH}`, ISSUE_ID).statusOverrides)
      .toEqual({ 'wi-1': 'completed' });
    expect(readRecordAtRef(stateRoot, `origin/${STATE_BRANCH}`, OTHER_ISSUE_ID).decisions)
      .toEqual(originOther.decisions);
    const subjects = git(stateRoot, 'log', `origin/${STATE_BRANCH}`, '--format=%s');
    expect(subjects.match(new RegExp(`restore ${OTHER_ISSUE_ID}`, 'g'))).toHaveLength(1);
    expect(subjects).not.toContain(`restore ${ISSUE_ID}`);
  });

  it('rejects a non-record conflict, aborts the merge, and permits a later resolved write', async () => {
    const other = cloneState('spec-remote-writer');
    const specPath = join(stateRoot, 'specs', 'shared.json');
    const otherSpecPath = join(other, 'specs', 'shared.json');

    writeFileSync(specPath, JSON.stringify({ value: 'local' }, null, 2));
    git(stateRoot, 'add', 'specs/shared.json');
    git(stateRoot, 'commit', '-q', '-m', 'local spec update');
    writeFileSync(otherSpecPath, JSON.stringify({ value: 'origin' }, null, 2));
    git(other, 'add', 'specs/shared.json');
    git(other, 'commit', '-q', '-m', 'origin spec update');
    git(other, 'push', '-q', 'origin', STATE_BRANCH);

    await expect(updateIssueRecord(project, ISSUE_ID, (current) => {
      current.statusOverrides = { 'wi-1': 'completed' };
    })).rejects.toThrow('specs/shared.json');

    expect(existsSync(join(stateRoot, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(stateRoot, 'status', '--porcelain')).toBe('');

    git(stateRoot, 'fetch', '-q', 'origin', STATE_BRANCH);
    expect(() => git(stateRoot, 'merge', `origin/${STATE_BRANCH}`)).toThrow();
    git(stateRoot, 'checkout', '--theirs', '--', 'specs/shared.json');
    git(stateRoot, 'add', 'specs/shared.json');
    git(stateRoot, 'commit', '-q', '--no-edit');

    await updateIssueRecord(project, ISSUE_ID, (current) => {
      current.statusOverrides = { 'wi-2': 'completed' };
    });
    expect(readRecordAtRef(stateRoot, `origin/${STATE_BRANCH}`, ISSUE_ID).statusOverrides)
      .toEqual({ 'wi-2': 'completed' });
  });

  it('rejects a delete-modify record conflict and leaves no merge in progress', async () => {
    const other = cloneState('delete-remote-writer');
    const localOther = readRecord(stateRoot, OTHER_ISSUE_ID);
    localOther.decisions = [{ id: 'D1', summary: 'local modification', recordedAt: '2026-07-30T00:01:00.000Z' }];
    writeRecord(stateRoot, localOther);
    git(stateRoot, 'add', `records/${OTHER_ISSUE_ID.toLowerCase()}.json`);
    git(stateRoot, 'commit', '-q', '-m', 'local record modification');

    git(other, 'rm', '-q', `records/${OTHER_ISSUE_ID.toLowerCase()}.json`);
    git(other, 'commit', '-q', '-m', 'origin record deletion');
    git(other, 'push', '-q', 'origin', STATE_BRANCH);

    await expect(updateIssueRecord(project, ISSUE_ID, (current) => {
      current.statusOverrides = { 'wi-1': 'completed' };
    })).rejects.toThrow(`records/${OTHER_ISSUE_ID.toLowerCase()}.json`);

    expect(existsSync(join(stateRoot, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(stateRoot, 'status', '--porcelain')).toBe('');
  });
});
