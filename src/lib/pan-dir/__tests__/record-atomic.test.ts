/**
 * PAN-2372 WI-1 / FR-1 / FR-2: atomic + verified record writes with corrupt-sidecar preservation.
 *
 * The record writers must not truncate a record in place on a mid-write crash
 * (tmp + rename), must read-back verify the renamed file parses, and must
 * preserve a non-empty unparseable existing file as a `.corrupt-<ts>` sidecar
 * rather than silently overwriting it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ProjectConfig } from '../../projects.js';
import {
  getIssueRecordPathForWorkspace,
  readIssueRecordForWorkspaceSync,
  readIssueRecordSync,
  writeIssueRecordForWorkspaceSync,
  writeIssueRecordSync,
  type PanIssueRecord,
} from '../record.js';

const ISSUE_ID = 'PAN-2372';
const NON_RESOLVING_ISSUE_ID = 'ATOMIC-1'; // No project matches → forces legacy project-path resolution.

function makeRecord(issueId: string, statusOverrides: Record<string, string> = {}): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    statusOverrides,
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  } as PanIssueRecord;
}

describe('PAN-2372 atomic + verified record writes', () => {
  let root: string;
  let workspacePath: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-record-atomic-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    workspacePath = join(root, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a normal write and leaves no .tmp residue', () => {
    const recordPath = writeIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID, makeRecord(ISSUE_ID, { 'item-1': 'completed' }));

    const readBack = readIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID);
    expect(readBack?.statusOverrides).toEqual({ 'item-1': 'completed' });
    expect(readBack?.schemaVersion).toBe(2);

    // No temp files left in the records directory after a successful atomic write.
    const residue = readdirSync(dirname(recordPath)).filter((name) => name.endsWith('.tmp'));
    expect(residue).toEqual([]);
  });

  it('renames a non-empty unparseable existing record to a .corrupt-<ts> sidecar, warns, and writes a fresh parseable record', () => {
    const recordPath = getIssueRecordPathForWorkspace(workspacePath, ISSUE_ID);
    mkdirSync(dirname(recordPath), { recursive: true });
    const garbage = '{ "issueId": "PAN-2372", "statusOverrides": { "lost": "COMMITTED WORK" },'; // truncated → JSON.parse fails
    writeFileSync(recordPath, garbage);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID, makeRecord(ISSUE_ID, { 'item-1': 'completed' }));

    // The corrupt bytes were preserved verbatim in a sidecar, not destroyed.
    const sidecars = readdirSync(dirname(recordPath)).filter((name) => /\.corrupt-\d+$/.test(name));
    expect(sidecars).toHaveLength(1);
    expect(readFileSync(join(dirname(recordPath), sidecars[0]), 'utf-8')).toBe(garbage);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Preserved corrupt record'));

    // The live record path now holds a fresh, parseable record.
    const readBack = readIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID);
    expect(readBack?.statusOverrides).toEqual({ 'item-1': 'completed' });
    warnSpy.mockRestore();
  });

  it('treats an empty existing file as a normal fresh write (no sidecar)', () => {
    const recordPath = getIssueRecordPathForWorkspace(workspacePath, ISSUE_ID);
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, ''); // empty file = fresh-write state, not corruption

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID, makeRecord(ISSUE_ID));

    const sidecars = readdirSync(dirname(recordPath)).filter((name) => /\.corrupt-\d+$/.test(name));
    expect(sidecars).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Preserved corrupt record'));
    expect(readIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID)?.issueId).toBe(ISSUE_ID);
    warnSpy.mockRestore();
  });

  it('the project-scoped writer (writeIssueRecordSync) shares the same atomic write path', () => {
    const project: ProjectConfig = { name: 'Atomic', path: join(root, 'project') };
    mkdirSync(project.path, { recursive: true });

    const recordPath = writeIssueRecordSync(project, NON_RESOLVING_ISSUE_ID, makeRecord(NON_RESOLVING_ISSUE_ID, { 'a': 'done' }));
    const readBack = readIssueRecordSync(project, NON_RESOLVING_ISSUE_ID);
    expect(readBack?.statusOverrides).toEqual({ 'a': 'done' });

    // Same atomic-write guarantee: no .tmp residue.
    const residue = readdirSync(dirname(recordPath)).filter((name) => name.endsWith('.tmp'));
    expect(residue).toEqual([]);
  });
});
