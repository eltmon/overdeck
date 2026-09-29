/**
 * PAN-4225 WI-1: the lifecycle-io continue adapters route through the issue's
 * base workspace plan home (`<project>/workspaces/feature-<issue>`), never
 * the primary checkout, and skip (return false, write nothing) once that
 * workspace is gone. Readers check the workspace copy first, then fall back
 * to the primary.
 *
 * AC1 — appendContinueSessionEntryForIssue / appendFeedbackEntryForIssue
 *        persist to the workspace's continue file and return true.
 * AC2 — clearFeedbackForIssue empties its feedback list.
 * AC3 — readContinueStateForIssue surfaces what those adapters wrote, and
 *        returns null when the issue has no continue file anywhere.
 * AC4 — no base workspace: every writer returns false and creates no file.
 * AC5 — readContinueStateForIssue prefers the workspace copy over the
 *        primary checkout's, and falls back to the primary once the
 *        workspace copy is gone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendContinueSessionEntryForIssue,
  appendFeedbackEntryForIssue,
  clearFeedbackForIssue,
  readContinueStateForIssue,
} from '../../../../src/lib/xbrief/lifecycle-io.js';
import { writeContinueState } from '../../../../src/lib/xbrief/continue-state.js';
import type { ContinueState } from '../../../../src/lib/xbrief/continue-state.js';

const ISSUE = 'PAN-1919';

describe('lifecycle-io continue adapters → .pan/continues (PAN-4225)', () => {
  let projectRoot: string;

  const workspaceDir = (): string => join(projectRoot, 'workspaces', 'feature-pan-1919');
  const continuePath = (root: string): string => join(root, '.pan', 'continues', `${ISSUE}.xbrief.json`);

  function seedContinueState(root: string, overrides: Partial<ContinueState> = {}): void {
    const now = new Date().toISOString();
    writeContinueState(root, ISSUE, {
      version: '1',
      issueId: ISSUE,
      created: now,
      updated: now,
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
      ...overrides,
    });
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-lifecycle-io-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('AC1: appendContinueSessionEntryForIssue persists to the workspace continue file', () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const wrote = appendContinueSessionEntryForIssue(projectRoot, ISSUE, { reason: 'resume', note: 'test entry' });

    expect(wrote).toBe(true);
    expect(existsSync(continuePath(workspaceDir()))).toBe(true);
    expect(existsSync(join(projectRoot, '.pan'))).toBe(false);
    const state = JSON.parse(readFileSync(continuePath(workspaceDir()), 'utf8'));
    expect(state.sessionHistory).toHaveLength(1);
    expect(state.sessionHistory[0].reason).toBe('resume');
    expect(state.sessionHistory[0].note).toBe('test entry');
    expect(state.sessionHistory[0].timestamp).toBeDefined();
  });

  it('AC1: appendFeedbackEntryForIssue persists to the workspace continue file', () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const wrote = appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'CHANGES_REQUESTED',
      timestamp: '2026-06-21T00:00:00.000Z',
      markdownBody: '## Issues found\n- Fix X',
    });

    expect(wrote).toBe(true);
    const state = readContinueStateForIssue(projectRoot, ISSUE)!;
    expect(state.feedback).toHaveLength(1);
    expect(state.feedback![0].specialist).toBe('review-agent');
    expect(state.feedback![0].outcome).toBe('CHANGES_REQUESTED');
  });

  it('does not append feedback identical to the last entry', () => {
    mkdirSync(workspaceDir(), { recursive: true });
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
    mkdirSync(workspaceDir(), { recursive: true });
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1, specialist: 'test-agent', outcome: 'FAILED',
      timestamp: '2026-06-21T00:00:00.000Z', markdownBody: 'failures',
    });
    appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 2, specialist: 'review-agent', outcome: 'APPROVED',
      timestamp: '2026-06-21T01:00:00.000Z', markdownBody: 'lgtm',
    });

    const cleared = clearFeedbackForIssue(projectRoot, ISSUE);

    expect(cleared).toBe(true);
    expect(readContinueStateForIssue(projectRoot, ISSUE)?.feedback).toEqual([]);
  });

  it('AC3: readContinueStateForIssue returns what the adapters wrote', () => {
    mkdirSync(workspaceDir(), { recursive: true });
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

  it('AC3: readContinueStateForIssue returns null when no continue file exists anywhere', () => {
    mkdirSync(workspaceDir(), { recursive: true });
    expect(readContinueStateForIssue(projectRoot, 'PAN-MISSING')).toBeNull();
  });

  it('AC4: with no base workspace, every writer returns false and creates no file', () => {
    expect(appendContinueSessionEntryForIssue(projectRoot, ISSUE, { reason: 'resume' })).toBe(false);
    expect(appendFeedbackEntryForIssue(projectRoot, ISSUE, {
      seq: 1, specialist: 'review-agent', outcome: 'APPROVED',
      timestamp: '2026-06-21T00:00:00.000Z', markdownBody: 'x',
    })).toBe(false);
    expect(clearFeedbackForIssue(projectRoot, ISSUE)).toBe(false);

    expect(existsSync(workspaceDir())).toBe(false);
    expect(existsSync(join(projectRoot, '.pan'))).toBe(false);
  });

  it('AC5: read prefers the workspace copy over the primary, then falls back once it is gone', () => {
    mkdirSync(workspaceDir(), { recursive: true });
    seedContinueState(workspaceDir(), { resumePoint: { description: 'workspace copy' } });
    seedContinueState(projectRoot, { resumePoint: { description: 'primary copy' } });

    expect(readContinueStateForIssue(projectRoot, ISSUE)?.resumePoint?.description).toBe('workspace copy');

    rmSync(continuePath(workspaceDir()));

    expect(readContinueStateForIssue(projectRoot, ISSUE)?.resumePoint?.description).toBe('primary copy');
  });
});
