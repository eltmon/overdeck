/**
 * PAN-3917 W1: the lifecycle-io continue adapters write to the plan home's
 * continue file, `<planHome>/.pan/continues/<ISSUE>.xbrief.json`.
 *
 * AC1 — appendContinueSessionEntryForIssue / appendFeedbackEntryForIssue
 *        persist to that file.
 * AC2 — clearFeedbackForIssue empties its feedback list.
 * AC3 — readContinueStateForIssue surfaces what those adapters wrote, and
 *        returns null when the issue has no continue file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendContinueSessionEntryForIssue,
  appendFeedbackEntryForIssue,
  clearFeedbackForIssue,
  readContinueStateForIssue,
} from '../../../../src/lib/xbrief/lifecycle-io.js';

const ISSUE = 'PAN-1919';

describe('lifecycle-io continue adapters → .pan/continues', () => {
  let projectRoot: string;

  const continuePath = (): string => join(projectRoot, '.pan', 'continues', `${ISSUE}.xbrief.json`);

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-lifecycle-io-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('AC1: appendContinueSessionEntryForIssue persists to the continue file', () => {
    appendContinueSessionEntryForIssue(projectRoot, ISSUE, { reason: 'resume', note: 'test entry' });

    expect(existsSync(continuePath())).toBe(true);
    const state = JSON.parse(readFileSync(continuePath(), 'utf8'));
    expect(state.sessionHistory).toHaveLength(1);
    expect(state.sessionHistory[0].reason).toBe('resume');
    expect(state.sessionHistory[0].note).toBe('test entry');
    expect(state.sessionHistory[0].timestamp).toBeDefined();
  });

  it('AC1: appendFeedbackEntryForIssue persists to the continue file', () => {
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'CHANGES_REQUESTED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: '## Issues found\n- Fix X',
    });

    const state = readContinueStateForIssue(projectRoot, ISSUE)!;
    expect(state.feedback).toHaveLength(1);
    expect(state.feedback![0].specialist).toBe('review-agent');
    expect(state.feedback![0].outcome).toBe('CHANGES_REQUESTED');
  });

  it('does not append feedback identical to the last entry', () => {
    const entry = {
      seq: 1,
      specialist: 'review-agent' as const,
      outcome: 'CHANGES_REQUESTED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: '## Issues found\n- Fix X',
    };
    appendFeedbackEntryForIssue(projectRoot, ISSUE, entry);
    appendFeedbackEntryForIssue(projectRoot, ISSUE, entry);

    expect(readContinueStateForIssue(projectRoot, ISSUE)?.feedback).toEqual([entry]);
  });

  it('AC2: clearFeedbackForIssue empties the feedback list', () => {
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1, specialist: 'test-agent', outcome: 'FAILED',
      timestamp: '2026-06-21T00:00:00.000Z', markdownBody: 'failures',
    });
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 2, specialist: 'review-agent', outcome: 'APPROVED',
      timestamp: '2026-06-21T01:00:00.000Z', markdownBody: 'lgtm',
    });

    clearFeedbackForIssue(projectRoot, ISSUE);

    expect(readContinueStateForIssue(projectRoot, ISSUE)?.feedback).toEqual([]);
  });

  it('AC3: readContinueStateForIssue returns what the adapters wrote', () => {
    appendContinueSessionEntryForIssue(projectRoot, ISSUE, { reason: 'resume', note: 'init' });
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1, specialist: 'review-agent', outcome: 'APPROVED',
      timestamp: '2026-06-21T00:00:00.000Z', markdownBody: 'all good',
    });

    const state = readContinueStateForIssue(projectRoot, ISSUE);
    expect(state).not.toBeNull();
    expect(state?.issueId).toBe(ISSUE);
    expect(state?.feedback).toHaveLength(1);
    expect(state?.feedback![0].specialist).toBe('review-agent');
    expect(state?.sessionHistory).toHaveLength(1);
    expect(state?.sessionHistory![0].reason).toBe('resume');
  });

  it('AC3: readContinueStateForIssue returns null when no continue file exists', () => {
    expect(readContinueStateForIssue(projectRoot, 'PAN-MISSING')).toBeNull();
  });
});
