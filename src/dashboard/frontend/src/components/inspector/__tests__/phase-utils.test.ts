import { describe, it, expect } from 'vitest';
import {
  getProjectKey,
  getSpecialistSessionName,
  detectPhase,
  getActiveSession,
} from '../phase-utils';
import type { ReviewStatus } from '../types';

/** Build a minimal ReviewStatus for tests — only set the fields under test */
function rs(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'pan-509',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: '2026-01-01T00:00:00Z',
    readyForMerge: false,
    ...overrides,
  };
}

// ─── getProjectKey ─────────────────────────────────────────────────────────────

describe('getProjectKey', () => {
  it('extracts lowercase prefix from standard issue IDs', () => {
    expect(getProjectKey('pan-509')).toBe('pan');
    expect(getProjectKey('min-123')).toBe('min');
  });

  it('lowercases uppercase prefixes', () => {
    expect(getProjectKey('PAN-509')).toBe('pan');
    expect(getProjectKey('MIN-1')).toBe('min');
  });
});

// ─── getSpecialistSessionName ─────────────────────────────────────────────────

describe('getSpecialistSessionName', () => {
  it('builds specialist session name matching server convention', () => {
    expect(getSpecialistSessionName('pan', 'review-agent')).toBe('specialist-pan-review-agent');
    expect(getSpecialistSessionName('min', 'test-agent')).toBe('specialist-min-test-agent');
    expect(getSpecialistSessionName('pan', 'merge-agent')).toBe('specialist-pan-merge-agent');
  });
});

// ─── detectPhase ──────────────────────────────────────────────────────────────

describe('detectPhase', () => {
  it('returns idle when reviewStatus is undefined', () => {
    expect(detectPhase(undefined)).toBe('idle');
  });

  it('returns idle when no status fields are active', () => {
    expect(detectPhase(rs())).toBe('idle');
  });

  it('returns verification when verificationStatus is running', () => {
    expect(detectPhase(rs({ verificationStatus: 'running' }))).toBe('verification');
  });

  it('returns reviewing when reviewStatus is reviewing', () => {
    expect(detectPhase(rs({ reviewStatus: 'reviewing' }))).toBe('reviewing');
  });

  it('returns testing when testStatus is testing', () => {
    expect(detectPhase(rs({ testStatus: 'testing' }))).toBe('testing');
  });

  it('returns merging when mergeStatus is merging', () => {
    expect(detectPhase(rs({ mergeStatus: 'merging' }))).toBe('merging');
  });

  it('verification takes priority over review', () => {
    expect(detectPhase(rs({ verificationStatus: 'running', reviewStatus: 'reviewing' }))).toBe('verification');
  });
});

// ─── getActiveSession ─────────────────────────────────────────────────────────

describe('getActiveSession', () => {
  it('returns null when idle and no agentId', () => {
    expect(getActiveSession('pan-509', undefined, rs())).toBeNull();
  });

  it('returns agent session when idle with agentId', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', rs());
    expect(result).toEqual({
      sessionName: 'agent-pan-509',
      label: 'Agent',
      phase: 'working',
    });
  });

  it('returns agent session when reviewStatus is undefined', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', undefined);
    expect(result).toEqual({
      sessionName: 'agent-pan-509',
      label: 'Agent',
      phase: 'working',
    });
  });

  it('returns agent session for verification phase (output goes to agent terminal)', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', rs({ verificationStatus: 'running' }));
    expect(result).toEqual({
      sessionName: 'agent-pan-509',
      label: 'Verification',
      phase: 'verification',
    });
  });

  it('returns null for verification phase when no agentId', () => {
    expect(getActiveSession('pan-509', undefined, rs({ verificationStatus: 'running' }))).toBeNull();
  });

  it('returns review specialist session when reviewing', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', rs({ reviewStatus: 'reviewing' }));
    expect(result).toEqual({
      sessionName: 'specialist-pan-review-agent',
      label: 'Review',
      phase: 'reviewing',
    });
  });

  it('returns test specialist session when testing', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', rs({ testStatus: 'testing' }));
    expect(result).toEqual({
      sessionName: 'specialist-pan-test-agent',
      label: 'Test',
      phase: 'testing',
    });
  });

  it('returns merge specialist session when merging', () => {
    const result = getActiveSession('pan-509', 'agent-pan-509', rs({ mergeStatus: 'merging' }));
    expect(result).toEqual({
      sessionName: 'specialist-pan-merge-agent',
      label: 'Merge',
      phase: 'merging',
    });
  });

  it('derives project key from issue ID for session names', () => {
    const result = getActiveSession('min-123', 'agent-min-123', rs({ reviewStatus: 'reviewing' }));
    expect(result?.sessionName).toBe('specialist-min-review-agent');
  });
});
