import { describe, it, expect } from 'vitest';
import { derivePipelinePhase, type PipelinePhaseInput } from './usePipelinePhase';
import type { Agent } from '../../types';
import type { ReviewStatus } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-abc',
    issueId: 'pan-509',
    runtime: 'node',
    model: 'claude-sonnet-4-6',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function makeReviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'pan-509',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PipelinePhaseInput> = {}): PipelinePhaseInput {
  return {
    issueId: 'pan-509',
    projectKey: 'panopticon',
    ...overrides,
  };
}

// ─── Phase precedence tests ────────────────────────────────────────────────────

describe('derivePipelinePhase precedence table', () => {
  // Precedence: merging → testing → reviewing → review-feedback → working → planning → merged

  describe('merging phase', () => {
    it('returns merging when mergeStatus === queued', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'queued' }) });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('merging');
      expect(activeSession).toBe('specialist-panopticon-pan-509-merge-agent');
    });

    it('returns merging when mergeStatus === merging', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('merging');
    });

    it('returns merging when mergeStatus === verifying', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'verifying' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('merging');
    });

    it('merging takes precedence over testing', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging', testStatus: 'testing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('merging');
    });

    it('uses specialist session name with project key', () => {
      const input = makeInput({
        projectKey: 'my-project',
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }),
      });
      const { activeSession } = derivePipelinePhase(input);
      expect(activeSession).toBe('specialist-my-project-pan-509-merge-agent');
    });

    it('falls back to global session name when no project key', () => {
      const input = makeInput({
        projectKey: undefined,
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }),
      });
      const { activeSession } = derivePipelinePhase(input);
      expect(activeSession).toBe('specialist-merge-agent');
    });

    it('returns null activeSession when merging session is dead', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }) });
      const dead = new Set(['specialist-panopticon-pan-509-merge-agent']);
      const { activeSession } = derivePipelinePhase(input, dead);
      expect(activeSession).toBeNull();
    });
  });

  describe('merged phase', () => {
    it('returns merged when mergeStatus === merged', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'merged' }) });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('merged');
      expect(activeSession).toBeNull();
    });

    it('merged takes precedence over testing', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({ mergeStatus: 'merged', testStatus: 'testing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('merged');
    });

    it('merged takes precedence over reviewing', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({ mergeStatus: 'merged', reviewStatus: 'reviewing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('merged');
    });
  });

  describe('testing phase', () => {
    it('returns testing when testStatus === testing', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ testStatus: 'testing' }) });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('testing');
      expect(activeSession).toBe('specialist-panopticon-pan-509-test-agent');
    });

    it('does NOT return testing when testStatus !== testing', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ testStatus: 'passed' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('testing');
    });

    it('testing takes precedence over reviewing', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({ testStatus: 'testing', reviewStatus: 'reviewing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('testing');
    });

    it('returns null activeSession when test session is dead', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ testStatus: 'testing' }) });
      const dead = new Set(['specialist-panopticon-pan-509-test-agent']);
      const { activeSession } = derivePipelinePhase(input, dead);
      expect(activeSession).toBeNull();
    });
  });

  describe('reviewing phase', () => {
    it('returns reviewing when reviewStatus === reviewing', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'reviewing' }) });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('reviewing');
      expect(activeSession).toBe('specialist-panopticon-pan-509-review-agent');
    });

    it('does NOT return reviewing when reviewStatus !== reviewing', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'passed' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('reviewing');
    });

    it('reviewing takes precedence over working', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'reviewing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('reviewing');
    });

    it('returns null activeSession when review session is dead', () => {
      const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'reviewing' }) });
      const dead = new Set(['specialist-panopticon-pan-509-review-agent']);
      const { activeSession } = derivePipelinePhase(input, dead);
      expect(activeSession).toBeNull();
    });
  });

  describe('review-feedback phase', () => {
    it('returns review-feedback when review failed and agent is running', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'failed' }),
      });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('review-feedback');
      expect(activeSession).toBe('agent-abc');
    });

    it('returns review-feedback when review failed and agent is starting', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'starting' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'failed' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('review-feedback');
    });

    it('does NOT return review-feedback when review failed but agent is stopped', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'stopped' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'failed' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('review-feedback');
    });

    it('review-feedback takes precedence over plain working', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'failed' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('review-feedback');
    });

    it('returns review-feedback when review is blocked (backend writes blocked on rejection)', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'blocked' }),
      });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('review-feedback');
      expect(activeSession).toBe('agent-abc');
    });

    it('returns review-feedback when review blocked and agent is starting', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'starting' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'blocked' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('review-feedback');
    });

    it('does NOT return review-feedback when review blocked but agent is stopped', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'stopped' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'blocked' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('review-feedback');
    });
  });

  describe('working phase', () => {
    it('returns working when agent is healthy and no specialist active', () => {
      const input = makeInput({ agent: makeAgent({ status: 'healthy' }) });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('working');
      expect(activeSession).toBe('agent-abc');
    });

    it('returns working when agent is starting and no specialist active', () => {
      const input = makeInput({ agent: makeAgent({ status: 'starting' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('working');
    });

    it('does NOT return working for stopped agent', () => {
      const input = makeInput({ agent: makeAgent({ status: 'stopped' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('working');
    });

    it('does NOT return working when reviewing is active', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'reviewing' }),
      });
      const { phase } = derivePipelinePhase(input);
      expect(phase).not.toBe('working');
    });
  });

  describe('planning / idle phase', () => {
    it('returns planning when no agent and no specialist active', () => {
      const input = makeInput();
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('planning');
      expect(activeSession).toBeNull();
    });

    it('returns planning when agent is stopped', () => {
      const input = makeInput({ agent: makeAgent({ status: 'stopped' }) });
      const { phase } = derivePipelinePhase(input);
      expect(phase).toBe('planning');
    });
  });
});

// ─── availableTerminals tests ──────────────────────────────────────────────────

describe('derivePipelinePhase availableTerminals', () => {
  it('includes Work tab when agent exists', () => {
    const input = makeInput({ agent: makeAgent() });
    const { availableTerminals } = derivePipelinePhase(input);
    const workTab = availableTerminals.find(t => t.id === 'working');
    expect(workTab).toBeTruthy();
    expect(workTab?.sessionName).toBe('agent-abc');
  });

  it('does NOT include Work tab when no agent', () => {
    const input = makeInput();
    const { availableTerminals } = derivePipelinePhase(input);
    expect(availableTerminals.find(t => t.id === 'working')).toBeUndefined();
  });

  it('includes Review tab when reviewStatus is not pending', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'passed' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    expect(availableTerminals.find(t => t.id === 'reviewing')).toBeTruthy();
  });

  it('does NOT include Review tab when reviewStatus === pending', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'pending' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    expect(availableTerminals.find(t => t.id === 'reviewing')).toBeUndefined();
  });

  it('includes Test tab when testStatus is not pending', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ testStatus: 'passed' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    expect(availableTerminals.find(t => t.id === 'testing')).toBeTruthy();
  });

  it('includes Merge tab when mergeStatus is not pending', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ mergeStatus: 'merged' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    expect(availableTerminals.find(t => t.id === 'merging')).toBeTruthy();
  });

  it('marks Review tab as active when phase is reviewing', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'reviewing' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
    expect(reviewTab?.isActive).toBe(true);
  });

  it('marks Work tab as active when phase is working', () => {
    const input = makeInput({ agent: makeAgent({ status: 'healthy' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    const workTab = availableTerminals.find(t => t.id === 'working');
    expect(workTab?.isActive).toBe(true);
  });

  it('marks dead sessions as disabled', () => {
    const input = makeInput({ reviewStatus: makeReviewStatus({ reviewStatus: 'passed' }) });
    const dead = new Set(['specialist-panopticon-pan-509-review-agent']);
    const { availableTerminals } = derivePipelinePhase(input, dead);
    const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
    expect(reviewTab?.disabled).toBe(true);
  });

  it('does NOT include tabs whose sessions are undefined (no reviewStatus)', () => {
    const input = makeInput({ agent: makeAgent() });
    const { availableTerminals } = derivePipelinePhase(input);
    // No specialist tabs when reviewStatus is absent
    expect(availableTerminals.filter(t => t.id !== 'working')).toHaveLength(0);
  });
});
