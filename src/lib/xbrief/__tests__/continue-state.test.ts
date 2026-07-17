/**
 * continue-state.ts — types-only module after PAN-1919.
 *
 * All fs-I/O functions (writeContinueStateSync, readContinueStateSync,
 * appendSessionEntrySync, continueFilename, continueFilePath) were retired in
 * PAN-1919 and now live in src/lib/pan-dir/record.ts. This file verifies that
 * the type exports still compile and have the expected shape.
 */

import { describe, it, expect } from 'vitest';
import type {
  ContinueState,
  ContinueFeedbackEntry,
  ContinueSessionEntry,
  ContinueDecision,
  ContinueHazard,
  ContinueResumePoint,
  ContinueTasksMapping,
  ContinueGitState,
  ContinueSessionReason,
} from '../continue-state.js';
import { CONTINUE_FILENAME_SUFFIX } from '../continue-state.js';

describe('ContinueState type exports (types-only module)', () => {
  it('CONTINUE_FILENAME_SUFFIX is a string constant', () => {
    expect(typeof CONTINUE_FILENAME_SUFFIX).toBe('string');
    expect(CONTINUE_FILENAME_SUFFIX).toBe('.vbrief.json');
  });

  it('ContinueState shape is structurally valid at compile time', () => {
    const now = '2026-05-03T00:00:00.000Z';
    const gitState: ContinueGitState = { branch: 'feature/pan-946', sha: 'abc123', dirty: false };
    const decision: ContinueDecision = { id: 'D1', summary: 'Use record', recordedAt: now };
    const hazard: ContinueHazard = { id: 'H1', summary: 'Watch out', mitigation: 'be careful' };
    const resumePoint: ContinueResumePoint = { description: 'Resume at task-2', taskId: 'task-2' };
    const tasksMapping: ContinueTasksMapping = { 'item-1': ['task-1'] };
    const sessionEntry: ContinueSessionEntry = { timestamp: now, reason: 'start' as ContinueSessionReason };
    const feedbackEntry: ContinueFeedbackEntry = {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'approved',
      timestamp: now,
      markdownBody: 'LGTM',
    };
    const state: ContinueState = {
      version: '1',
      issueId: 'PAN-946',
      created: now,
      updated: now,
      gitState,
      decisions: [decision],
      hazards: [hazard],
      resumePoint,
      tasksMapping,
      sessionHistory: [sessionEntry],
      feedback: [feedbackEntry],
    };
    expect(state.issueId).toBe('PAN-946');
    expect(state.decisions[0].id).toBe('D1');
    expect(state.feedback?.[0].specialist).toBe('review-agent');
  });

  it('ContinueSessionReason covers expected values', () => {
    const reasons: ContinueSessionReason[] = [
      'planning', 'start', 'end', 'resume', 'crash-recovery', 'feedback', 'manual',
    ];
    expect(reasons).toHaveLength(7);
  });
});
