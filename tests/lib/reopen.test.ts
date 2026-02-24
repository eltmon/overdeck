/**
 * Tests for src/lib/reopen.ts — reopenWorkspaceState()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pan-reopen-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Path for the isolated review-status.json in each test */
function statusFilePath() {
  return join(tempDir, 'review-status.json');
}

/** Write a review-status.json to tempDir */
function writeReviewStatus(data: Record<string, unknown>) {
  writeFileSync(statusFilePath(), JSON.stringify(data, null, 2));
}

/** Read the review-status.json from tempDir */
function readReviewStatus(): Record<string, unknown> {
  const path = statusFilePath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Create a minimal workspace with a .planning/STATE.md */
function createWorkspace(content?: string): string {
  const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-ws-'));
  const planningDir = join(wsDir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(
    join(planningDir, 'STATE.md'),
    content ?? '# PAN-999\n\n**STATUS: Implementation complete**\n\nSome previous content.\n'
  );
  return wsDir;
}

describe('reopenWorkspaceState', () => {
  it('resets review/test/merge to pending', async () => {
    writeReviewStatus({
      'PAN-999': {
        issueId: 'PAN-999',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'merged',
        readyForMerge: false,
        updatedAt: '2024-01-01T00:00:00Z',
        history: [],
      },
    });

    const wsDir = createWorkspace();

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    const result = reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    expect(result.specialistStatesReset).toBe(true);
    expect(result.previousReviewStatus).toBe('passed');
    expect(result.previousTestStatus).toBe('passed');
    expect(result.previousMergeStatus).toBe('merged');

    const statuses = readReviewStatus() as Record<string, Record<string, unknown>>;
    expect(statuses['PAN-999'].reviewStatus).toBe('pending');
    expect(statuses['PAN-999'].testStatus).toBe('pending');
    expect(statuses['PAN-999'].mergeStatus).toBe('pending');
    expect(statuses['PAN-999'].readyForMerge).toBe(false);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('creates initial pending status when no prior status exists', async () => {
    // No pre-existing status file
    const wsDir = createWorkspace();

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    const result = reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    expect(result.specialistStatesReset).toBe(true);
    // No prior status — previousReviewStatus is null
    expect(result.previousReviewStatus).toBeNull();
    expect(result.previousTestStatus).toBeNull();

    const statuses = readReviewStatus() as Record<string, Record<string, unknown>>;
    expect(statuses['PAN-999'].reviewStatus).toBe('pending');
    expect(statuses['PAN-999'].testStatus).toBe('pending');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('appends Reopened section to STATE.md', async () => {
    const wsDir = createWorkspace('# PAN-999\n\n**STATUS: Implementation complete**\n\nSome work.\n');

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    const result = reopenWorkspaceState('PAN-999', wsDir, {
      reason: 'Post-merge regression',
      statusFilePath: statusFilePath(),
    });

    expect(result.stateMdUpdated).toBe(true);

    const content = readFileSync(join(wsDir, '.planning', 'STATE.md'), 'utf-8');
    expect(content).toContain('## Reopened —');
    expect(content).toContain('Post-merge regression');
    expect(content).toContain('**Previous status:** Implementation complete');
    expect(content).toContain('Specialist states reset to pending');
    // Original content preserved (append-only)
    expect(content).toContain('**STATUS: Implementation complete**');
    expect(content).toContain('Some work.');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('appends tracker context to STATE.md when provided', async () => {
    const wsDir = createWorkspace();

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    reopenWorkspaceState('PAN-999', wsDir, {
      trackerContext: '## Tracker Status\n\nUser requested fix for login bug.',
      statusFilePath: statusFilePath(),
    });

    const content = readFileSync(join(wsDir, '.planning', 'STATE.md'), 'utf-8');
    expect(content).toContain('Tracker context at reopen:');
    expect(content).toContain('User requested fix for login bug.');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('does not modify STATE.md if it does not exist', async () => {
    // Workspace with .planning dir but no STATE.md
    const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-nows-'));
    mkdirSync(join(wsDir, '.planning'), { recursive: true });

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    const result = reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    expect(result.stateMdUpdated).toBe(false);
    expect(existsSync(join(wsDir, '.planning', 'STATE.md'))).toBe(false);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('preserves prUrl in status after reset', async () => {
    writeReviewStatus({
      'PAN-999': {
        issueId: 'PAN-999',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        prUrl: 'https://github.com/org/repo/pull/42',
        updatedAt: '2024-01-01T00:00:00Z',
        history: [],
      },
    });

    const wsDir = createWorkspace();
    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    const statuses = readReviewStatus() as Record<string, Record<string, unknown>>;
    expect(statuses['PAN-999'].prUrl).toBe('https://github.com/org/repo/pull/42');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('adds reopen entry to history', async () => {
    writeReviewStatus({
      'PAN-999': {
        issueId: 'PAN-999',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        updatedAt: '2024-01-01T00:00:00Z',
        history: [{ type: 'review', status: 'passed', timestamp: '2024-01-01T00:00:00Z' }],
      },
    });

    const wsDir = createWorkspace();
    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    reopenWorkspaceState('PAN-999', wsDir, { reason: 'Bug found', statusFilePath: statusFilePath() });

    const statuses = readReviewStatus() as Record<string, Record<string, unknown>>;
    const history = statuses['PAN-999'].history as Array<Record<string, unknown>>;
    // Should have original entry + new reopen entry
    expect(history.length).toBeGreaterThanOrEqual(2);
    const reopenEntry = history.find((h) => (h.notes as string)?.includes('Bug found'));
    expect(reopenEntry).toBeDefined();

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('resets autoRequeueCount to 0', async () => {
    writeReviewStatus({
      'PAN-999': {
        issueId: 'PAN-999',
        reviewStatus: 'failed',
        testStatus: 'failed',
        readyForMerge: false,
        autoRequeueCount: 3,
        updatedAt: '2024-01-01T00:00:00Z',
        history: [],
      },
    });

    const wsDir = createWorkspace();
    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    const statuses = readReviewStatus() as Record<string, Record<string, unknown>>;
    expect(statuses['PAN-999'].autoRequeueCount).toBe(0);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('returns empty queueItemsRemoved when no queue items exist', async () => {
    const wsDir = createWorkspace();

    const { reopenWorkspaceState } = await import('../../src/lib/reopen.js');
    const result = reopenWorkspaceState('PAN-999', wsDir, { statusFilePath: statusFilePath() });

    expect(result.queueItemsRemoved).toEqual({});

    rmSync(wsDir, { recursive: true, force: true });
  });
});
