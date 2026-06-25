/**
 * PAN-1919: lifecycle-io continue adapters rerouted to the per-issue record.
 *
 * Verifies ACs:
 * AC1 — appendContinueSessionEntryForIssue / appendFeedbackEntryForIssue
 *        persist to the per-issue record (not .pan/continues/).
 * AC2 — clearFeedbackForIssue empties record.feedback;
 *        readContinueStateForIssue surfaces the record's continue-view.
 * AC3 — readContinueStateForIssue returns the record's continue-view fields.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

import {
  appendContinueSessionEntryForIssue,
  appendFeedbackEntryForIssue,
  clearFeedbackForIssue,
  readContinueStateForIssue,
} from '../../../../src/lib/vbrief/lifecycle-io.js';
import { readIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';

describe('PAN-1919: lifecycle-io continue adapters → per-issue record', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-lifecycle-io-test-'));
    mkdirSync(join(projectRoot, '.pan', 'records'), { recursive: true });
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('AC1: appendContinueSessionEntryForIssue persists to record.sessionHistory, not .pan/continues/', () => {
    appendContinueSessionEntryForIssue(projectRoot, 'PAN-1919', {
      reason: 'resume',
      note: 'test entry',
    });

    const record = readIssueRecordSync({ name: 'test', path: projectRoot }, 'PAN-1919');
    expect(record?.sessionHistory).toHaveLength(1);
    expect(record?.sessionHistory![0].reason).toBe('resume');
    expect(record?.sessionHistory![0].note).toBe('test entry');
    expect(record?.sessionHistory![0].timestamp).toBeDefined();

    // Must NOT write .pan/continues/
    expect(existsSync(join(projectRoot, '.pan', 'continues', 'pan-1919.vbrief.json'))).toBe(false);
  });

  it('AC1: appendFeedbackEntryForIssue persists to record.feedback, not .pan/continues/', () => {
    appendFeedbackEntryForIssue(projectRoot, 'PAN-1919', {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'CHANGES_REQUESTED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: '## Issues found\n- Fix X',
    });

    const record = readIssueRecordSync({ name: 'test', path: projectRoot }, 'PAN-1919');
    expect(record?.feedback).toHaveLength(1);
    expect(record?.feedback![0].specialist).toBe('review-agent');
    expect(record?.feedback![0].outcome).toBe('CHANGES_REQUESTED');

    expect(existsSync(join(projectRoot, '.pan', 'continues', 'pan-1919.vbrief.json'))).toBe(false);
  });

  it('AC2: clearFeedbackForIssue empties record.feedback', () => {
    appendFeedbackEntryForIssue(projectRoot, 'PAN-1919', {
      seq: 1,
      specialist: 'test-agent',
      outcome: 'FAILED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: 'failures',
    });
    appendFeedbackEntryForIssue(projectRoot, 'PAN-1919', {
      seq: 2,
      specialist: 'review-agent',
      outcome: 'APPROVED',
      timestamp: '2026-06-21T01:00:00.000Z',
      markdownBody: 'lgtm',
    });

    clearFeedbackForIssue(projectRoot, 'PAN-1919');

    const record = readIssueRecordSync({ name: 'test', path: projectRoot }, 'PAN-1919');
    expect(record?.feedback).toEqual([]);
  });

  it('AC3: readContinueStateForIssue returns the record continue-view', () => {
    appendContinueSessionEntryForIssue(projectRoot, 'PAN-1919', { reason: 'resume', note: 'init' });
    appendFeedbackEntryForIssue(projectRoot, 'PAN-1919', {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'APPROVED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: 'all good',
    });

    const state = readContinueStateForIssue(projectRoot, 'PAN-1919');
    expect(state).not.toBeNull();
    expect(state?.feedback).toHaveLength(1);
    expect(state?.feedback![0].specialist).toBe('review-agent');
    expect(state?.sessionHistory).toHaveLength(1);
    expect(state?.sessionHistory![0].reason).toBe('resume');
  });

  it('AC3: readContinueStateForIssue returns null when no record exists', () => {
    const state = readContinueStateForIssue(projectRoot, 'PAN-MISSING');
    expect(state).toBeNull();
  });
});
