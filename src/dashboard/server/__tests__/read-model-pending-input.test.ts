import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@panctl/contracts';
import { projectPendingInput } from '../read-model.js';

// PAN-1591 — a non-running agent cannot be awaiting interactive input. The
// bootstrap projection must strip a stale cached hasPendingQuestion so a stopped
// agent doesn't surface a phantom "Waiting on your input" row.
describe('projectPendingInput', () => {
  const flagged = {
    hasPendingQuestion: true,
    pendingQuestionCount: 0,
    pendingQuestionPrompt: 'Agent is waiting for human input',
    pendingQuestionReason: 'other' as const,
    pendingInputCount: 0,
    pendingInputKinds: [] as readonly string[],
    pendingAskUserQuestion: undefined,
  };

  it('passes pending-input through for running/starting agents', () => {
    for (const status of ['running', 'starting'] as AgentStatus[]) {
      expect(projectPendingInput(status, flagged)).toEqual(flagged);
    }
  });

  it('clears every pending-input field for non-running agents', () => {
    for (const status of ['stopped', 'error', 'unknown'] as AgentStatus[]) {
      expect(projectPendingInput(status, flagged)).toEqual({
        hasPendingQuestion: undefined,
        pendingQuestionCount: undefined,
        pendingQuestionPrompt: undefined,
        pendingQuestionReason: undefined,
        pendingInputCount: undefined,
        pendingInputKinds: undefined,
        pendingAskUserQuestion: undefined,
      });
    }
  });

  it('preserves a genuine pending AskUserQuestion while the agent is running', () => {
    const withQuestion = {
      ...flagged,
      pendingQuestionCount: 1,
      pendingInputCount: 1,
      pendingInputKinds: ['askUserQuestion'] as readonly string[],
      pendingAskUserQuestion: { toolUseId: 't1', askedAt: '2026-06-02T00:00:00Z', questions: [] },
    };
    expect(projectPendingInput('running', withQuestion)).toEqual(withQuestion);
    expect(projectPendingInput('stopped', withQuestion).pendingAskUserQuestion).toBeUndefined();
  });
});
