import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { derivePipelinePhase, type PipelinePhaseInput, usePipelinePhase } from './usePipelinePhase';
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
      const input = makeInput({
        reviewStatus: makeReviewStatus({
          reviewStatus: 'reviewing',
          reviewCoordinatorSessionName: 'review-coordinator-pan-509-1234567890',
        }),
      });
      const { phase, activeSession } = derivePipelinePhase(input);
      expect(phase).toBe('reviewing');
      expect(activeSession).toBe('review-coordinator-pan-509-1234567890');
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
      const input = makeInput({
        reviewStatus: makeReviewStatus({
          reviewStatus: 'reviewing',
          reviewCoordinatorSessionName: 'review-coordinator-pan-509-1234567890',
        }),
      });
      const dead = new Set(['review-coordinator-pan-509-1234567890']);
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

  describe('monorepo merge fallback', () => {
    it('uses work agent session when mergeStatus is merging and work agent is healthy', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }),
      });
      const { phase, activeSession, availableTerminals } = derivePipelinePhase(input);
      expect(phase).toBe('merging');
      expect(activeSession).toBe('agent-abc');
      const mergeTab = availableTerminals.find(t => t.id === 'merging');
      expect(mergeTab?.sessionName).toBe('agent-abc');
    });

    it('prefers the first active swarm slot over an earlier standby slot during merge', () => {
      const input = makeInput({
        agent: makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped', agentPhase: 'review-response' }),
        workAgents: [
          makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped', agentPhase: 'review-response' }),
          makeAgent({ id: 'agent-pan-509-2', issueId: 'PAN-509', status: 'healthy' }),
        ],
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }),
      });
      const { activeSession, availableTerminals } = derivePipelinePhase(input);
      expect(activeSession).toBe('agent-pan-509-2');
      expect(availableTerminals.find(t => t.id === 'merging')?.sessionName).toBe('agent-pan-509-2');
    });

    it('uses merge-agent session when work agent is stopped (polyrepo)', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'stopped' }),
        reviewStatus: makeReviewStatus({ mergeStatus: 'merging' }),
      });
      const { activeSession, availableTerminals } = derivePipelinePhase(input);
      expect(activeSession).toBe('specialist-panopticon-pan-509-merge-agent');
      const mergeTab = availableTerminals.find(t => t.id === 'merging');
      expect(mergeTab?.sessionName).toBe('specialist-panopticon-pan-509-merge-agent');
    });
  });

  describe('review tab disabled when review is complete', () => {
    it('disables review tab when reviewStatus is passed', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({ reviewStatus: 'passed' }),
      });
      const { availableTerminals } = derivePipelinePhase(input);
      const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
      expect(reviewTab?.disabled).toBe(true);
      expect(reviewTab?.isRunning).toBe(false);
    });

    it('disables review tab when reviewStatus is failed', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'failed' }),
      });
      const { availableTerminals } = derivePipelinePhase(input);
      const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
      expect(reviewTab?.disabled).toBe(true);
      expect(reviewTab?.isRunning).toBe(false);
    });

    it('disables review tab when reviewStatus is blocked', () => {
      const input = makeInput({
        agent: makeAgent({ status: 'healthy' }),
        reviewStatus: makeReviewStatus({ reviewStatus: 'blocked' }),
      });
      const { availableTerminals } = derivePipelinePhase(input);
      const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
      expect(reviewTab?.disabled).toBe(true);
      expect(reviewTab?.isRunning).toBe(false);
    });

    it('disables parallel review tabs when reviewStatus is passed', () => {
      const input = makeInput({
        reviewStatus: makeReviewStatus({
          reviewStatus: 'passed',
          reviewSessionNames: ['review-pan-509-1234567890-sme', 'review-pan-509-1234567890-security'],
        }),
      });
      const { availableTerminals } = derivePipelinePhase(input);
      const smeTab = availableTerminals.find(t => t.id === 'reviewing-sme');
      const secTab = availableTerminals.find(t => t.id === 'reviewing-security');
      expect(smeTab?.disabled).toBe(true);
      expect(secTab?.disabled).toBe(true);
      expect(smeTab?.isRunning).toBe(false);
      expect(secTab?.isRunning).toBe(false);
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

  it('renders one work tab per swarm slot when multiple work agents share an issue', () => {
    const input = makeInput({
      agent: makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509' }),
      workAgents: [
        makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509' }),
        makeAgent({ id: 'agent-pan-509-2', issueId: 'PAN-509' }),
      ],
    });

    const { phase, activeSession, availableTerminals } = derivePipelinePhase(input);
    expect(phase).toBe('working');
    expect(activeSession).toBe('agent-pan-509-1');
    expect(availableTerminals.filter((tab) => tab.id.startsWith('working')).map((tab) => ({
      id: tab.id,
      label: tab.label,
      sessionName: tab.sessionName,
      isActive: tab.isActive,
    }))).toEqual([
      {
        id: 'working',
        label: 'Slot 1',
        sessionName: 'agent-pan-509-1',
        isActive: true,
      },
      {
        id: 'working-agent-pan-509-2',
        label: 'Slot 2',
        sessionName: 'agent-pan-509-2',
        isActive: false,
      },
    ]);
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

  it('marks Review tab as active when phase is reviewing and coordinator exists', () => {
    const input = makeInput({
      reviewStatus: makeReviewStatus({
        reviewStatus: 'reviewing',
        reviewCoordinatorSessionName: 'review-coordinator-pan-509-1234567890',
      }),
    });
    const { availableTerminals } = derivePipelinePhase(input);
    const reviewTab = availableTerminals.find(t => t.id === 'reviewing');
    expect(reviewTab?.isActive).toBe(true);
  });

  it('includes coordinator Review tab plus per-reviewer tabs during parallel review', () => {
    const input = makeInput({
      reviewStatus: makeReviewStatus({
        reviewStatus: 'reviewing',
        reviewCoordinatorSessionName: 'review-coordinator-pan-509-1234567890',
        reviewSessionNames: [
          'review-pan-509-1234567891-correctness',
          'review-pan-509-1234567891-security',
          'review-pan-509-1234567891-performance',
          'review-pan-509-1234567891-requirements',
        ],
      }),
    });
    const { activeSession, availableTerminals } = derivePipelinePhase(input);
    expect(activeSession).toBe('review-coordinator-pan-509-1234567890');
    expect(availableTerminals.find(t => t.id === 'reviewing')?.sessionName).toBe('review-coordinator-pan-509-1234567890');
    expect(availableTerminals.find(t => t.id === 'reviewing-correctness')).toBeTruthy();
    expect(availableTerminals.find(t => t.id === 'reviewing-security')).toBeTruthy();
    expect(availableTerminals.find(t => t.id === 'reviewing-performance')).toBeTruthy();
    expect(availableTerminals.find(t => t.id === 'reviewing-requirements')).toBeTruthy();
  });

  it('marks Work tab as active when phase is working', () => {
    const input = makeInput({ agent: makeAgent({ status: 'healthy' }) });
    const { availableTerminals } = derivePipelinePhase(input);
    const workTab = availableTerminals.find(t => t.id === 'working');
    expect(workTab?.isActive).toBe(true);
  });

  it('follows the first active swarm slot when an earlier slot is only standby-attachable', () => {
    const input = makeInput({
      agent: makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped', agentPhase: 'review-response' }),
      workAgents: [
        makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped', agentPhase: 'review-response' }),
        makeAgent({ id: 'agent-pan-509-2', issueId: 'PAN-509', status: 'healthy' }),
      ],
    });

    const { phase, activeSession, availableTerminals } = derivePipelinePhase(input);
    expect(phase).toBe('working');
    expect(activeSession).toBe('agent-pan-509-2');
    expect(availableTerminals.find((tab) => tab.sessionName === 'agent-pan-509-2')?.isActive).toBe(true);
  });

  it('enters standby when a later swarm slot is waiting for review feedback', () => {
    const input = makeInput({
      agent: makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped' }),
      workAgents: [
        makeAgent({ id: 'agent-pan-509-1', issueId: 'PAN-509', status: 'stopped' }),
        makeAgent({ id: 'agent-pan-509-2', issueId: 'PAN-509', status: 'stopped', agentPhase: 'review-response' }),
      ],
    });

    const { phase, activeSession, availableTerminals } = derivePipelinePhase(input);
    expect(phase).toBe('standby');
    expect(activeSession).toBe('agent-pan-509-2');
    expect(availableTerminals.find((tab) => tab.sessionName === 'agent-pan-509-2')?.isActive).toBe(true);
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

  it('marks done sub-reviewers as disabled with no spinner', () => {
    const input = makeInput({
      reviewStatus: makeReviewStatus({
        reviewStatus: 'reviewing',
        reviewSessionNames: ['review-pan-509-123-correctness', 'review-pan-509-123-performance'],
        reviewSubStatuses: { correctness: 'done', performance: 'running' },
      }),
    });
    const { availableTerminals } = derivePipelinePhase(input);
    const correctnessTab = availableTerminals.find(t => t.id === 'reviewing-correctness');
    const performanceTab = availableTerminals.find(t => t.id === 'reviewing-performance');
    expect(correctnessTab?.disabled).toBe(true);
    expect(correctnessTab?.isRunning).toBe(false);
    expect(performanceTab?.disabled).toBe(false);
    expect(performanceTab?.isRunning).toBe(true);
  });
});

describe('usePipelinePhase hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('recomputes when agentPhase changes without a status change', async () => {
    const initialInput = makeInput({
      agent: makeAgent({ status: 'stopped', agentPhase: 'implementation' }),
      workAgents: [makeAgent({ status: 'stopped', agentPhase: 'implementation' })],
    });

    const { result, rerender } = renderHook(
      ({ input }) => usePipelinePhase(input),
      { initialProps: { input: initialInput } },
    );

    expect(result.current.phase).toBe('planning');
    expect(result.current.activeSession).toBeNull();

    rerender({
      input: makeInput({
        agent: makeAgent({ status: 'stopped', agentPhase: 'review-response' }),
        workAgents: [makeAgent({ status: 'stopped', agentPhase: 'review-response' })],
      }),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.phase).toBe('standby');
    expect(result.current.activeSession).toBe('agent-abc');
  });
});
