/**
 * PAN-4438 — the untracked workspace waiver store, the head-scoped reader, and
 * the grant function both doors (CLI, dashboard) call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mocks = vi.hoisted(() => ({
  getIssueWorkspacePath: vi.fn(),
  loadWorkspaceMetadata: vi.fn(),
  snapshotWorkspaceHeads: vi.fn(),
}));

vi.mock('../../../../src/lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: mocks.getIssueWorkspacePath,
}));

vi.mock('../../../../src/lib/remote/workspace-metadata.js', () => ({
  loadWorkspaceMetadata: mocks.loadWorkspaceMetadata,
}));

vi.mock('../../../../src/lib/git-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/git-utils.js')>();
  return { ...actual, snapshotWorkspaceHeads: mocks.snapshotWorkspaceHeads };
});

import {
  grantTestSkipWaiver,
  readTestSkipWaiver,
  resolveActiveTestSkipWaiver,
  testSkipWaiverPath,
  waiverCoversHead,
  writeTestSkipWaiver,
} from '../../../../src/lib/cloister/test-skip-waiver.js';
import { writeContinueState } from '../../../../src/lib/xbrief/continue-state.js';

let workspacePath: string;

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), 'test-skip-waiver-'));
  mocks.loadWorkspaceMetadata.mockReturnValue(null);
  mocks.getIssueWorkspacePath.mockReturnValue(workspacePath);
  mocks.snapshotWorkspaceHeads.mockResolvedValue('abc123');
});

afterEach(() => {
  vi.clearAllMocks();
  if (existsSync(workspacePath)) rmSync(workspacePath, { recursive: true, force: true });
});

describe('writeTestSkipWaiver / readTestSkipWaiver (PAN-4438)', () => {
  it('round-trips a waiver through the untracked store', () => {
    writeTestSkipWaiver(workspacePath, { sha: 'abc123', reason: 'covered elsewhere', at: '2026-09-30T00:00:00.000Z', by: 'operator' });

    const waiver = readTestSkipWaiver(workspacePath);

    expect(waiver).toEqual({ sha: 'abc123', reason: 'covered elsewhere', at: '2026-09-30T00:00:00.000Z', by: 'operator' });
  });

  it('returns null when no waiver file exists', () => {
    expect(readTestSkipWaiver(workspacePath)).toBeNull();
  });

  it('returns null for a malformed waiver file', () => {
    mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
    writeFileSync(testSkipWaiverPath(workspacePath), 'not json');

    expect(readTestSkipWaiver(workspacePath)).toBeNull();
  });

  it('returns null for a waiver file missing a required string field', () => {
    mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
    writeFileSync(testSkipWaiverPath(workspacePath), JSON.stringify({ sha: 'abc123' }));

    expect(readTestSkipWaiver(workspacePath)).toBeNull();
  });
});

describe('resolveActiveTestSkipWaiver (PAN-4438)', () => {
  it('returns the stored waiver when its sha matches the given head', () => {
    writeTestSkipWaiver(workspacePath, { sha: 'abc123', reason: 'covered elsewhere', at: '2026-09-30T00:00:00.000Z' });

    const waiver = resolveActiveTestSkipWaiver(workspacePath, 'abc123');

    expect(waiver?.sha).toBe('abc123');
  });

  it('returns null when the stored waiver is pinned to a different head', () => {
    writeTestSkipWaiver(workspacePath, { sha: 'abc123', reason: 'covered elsewhere', at: '2026-09-30T00:00:00.000Z' });

    expect(resolveActiveTestSkipWaiver(workspacePath, 'def456')).toBeNull();
  });

  it('returns null for an undefined head', () => {
    writeTestSkipWaiver(workspacePath, { sha: 'abc123', reason: 'covered elsewhere', at: '2026-09-30T00:00:00.000Z' });

    expect(resolveActiveTestSkipWaiver(workspacePath, undefined)).toBeNull();
  });

  it('is not honored by a D-test-removal-waived decision in the workspace continue file (PAN-4225 deadlock removed)', () => {
    writeContinueState(workspacePath, 'PAN-4242', {
      version: '1',
      issueId: 'PAN-4242',
      created: '2026-09-30T00:00:00.000Z',
      updated: '2026-09-30T00:00:00.000Z',
      gitState: {},
      decisions: [{ id: 'D-test-removal-waived:abc123', summary: 'covered elsewhere', recordedAt: '2026-09-30T00:00:00.000Z' }],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
    });

    expect(resolveActiveTestSkipWaiver(workspacePath, 'abc123')).toBeNull();
  });
});

describe('grantTestSkipWaiver (PAN-4438)', () => {
  const now = () => new Date('2026-09-30T12:00:00.000Z');

  it('refuses an empty reason and writes nothing', async () => {
    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: '   ', by: 'operator', now });

    expect(result).toEqual({ ok: false, code: 'empty-reason', message: expect.any(String) });
    expect(existsSync(testSkipWaiverPath(workspacePath))).toBe(false);
  });

  it('refuses a remote workspace and writes nothing', async () => {
    mocks.loadWorkspaceMetadata.mockReturnValue({ location: 'remote' });

    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: 'ok', by: 'operator', now });

    expect(result).toEqual({ ok: false, code: 'remote-workspace', message: expect.any(String) });
    expect(existsSync(testSkipWaiverPath(workspacePath))).toBe(false);
  });

  it('refuses a missing workspace and writes nothing', async () => {
    mocks.getIssueWorkspacePath.mockReturnValue(null);

    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: 'ok', by: 'operator', now });

    expect(result).toEqual({ ok: false, code: 'no-workspace', message: expect.any(String) });
    expect(existsSync(testSkipWaiverPath(workspacePath))).toBe(false);
  });

  it('refuses an unreadable head and writes nothing', async () => {
    mocks.snapshotWorkspaceHeads.mockResolvedValue(undefined);

    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: 'ok', by: 'operator', now });

    expect(result).toEqual({ ok: false, code: 'no-head', message: expect.any(String) });
    expect(existsSync(testSkipWaiverPath(workspacePath))).toBe(false);
  });

  it('refuses a head that moved since the dashboard caller last saw it, and writes nothing', async () => {
    mocks.snapshotWorkspaceHeads.mockResolvedValue('abc123');

    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: 'ok', by: 'dashboard', expectedHead: 'stale-sha', now });

    expect(result).toEqual({ ok: false, code: 'head-moved', message: expect.any(String) });
    expect(existsSync(testSkipWaiverPath(workspacePath))).toBe(false);
  });

  it('grants and persists a waiver pinned to the snapshotted anchor on success', async () => {
    mocks.snapshotWorkspaceHeads.mockResolvedValue('abc123');

    const result = await grantTestSkipWaiver({ issueId: 'PAN-4438', reason: 'operator approved', by: 'operator', now });

    expect(result).toEqual({
      ok: true,
      waiver: { sha: 'abc123', reason: 'operator approved', at: '2026-09-30T12:00:00.000Z', by: 'operator' },
      workspacePath,
    });
    expect(readTestSkipWaiver(workspacePath)).toEqual({ sha: 'abc123', reason: 'operator approved', at: '2026-09-30T12:00:00.000Z', by: 'operator' });
  });
});

describe('waiverCoversHead (PAN-3906, unchanged)', () => {
  it('matches only the exact pinned head', () => {
    expect(waiverCoversHead({ sha: 'abc123', reason: 'r', at: 'now' }, 'abc123')).toBe(true);
    expect(waiverCoversHead({ sha: 'abc123', reason: 'r', at: 'now' }, 'def456')).toBe(false);
  });
});
