import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  INITIAL_READ_MODEL_STATE,
  type AgentSnapshot,
  type AgentStatus,
  type DomainEvent,
} from '@overdeck/contracts';
import { projectPendingInput } from '../read-model.js';

const pendingAskUserQuestion = {
  toolUseId: 'toolu-pan-3055',
  askedAt: '2026-06-29T09:02:55.023Z',
  questions: [{
    question: 'Which scope should this issue use?',
    header: 'Scope',
    multiSelect: false,
    options: [
      { label: 'Residual only', description: 'Keep only the remaining Kimi-native work.' },
      { label: 'Original scope', description: 'Retain the original issue scope.' },
    ],
  }],
};

describe('pending-input event projection', () => {
  it('clears a planted AskUserQuestion when the reap event is applied', () => {
    const agentId = 'agent-pan-3055';
    const agent: AgentSnapshot = { id: agentId, issueId: 'PAN-3055', status: 'running' };
    const initialState = {
      ...INITIAL_READ_MODEL_STATE,
      agentsById: { [agentId]: agent },
    };

    const planted = applyEvent(initialState, {
      type: 'agent.enrichment_changed',
      sequence: 1,
      timestamp: '2026-06-29T09:02:55.023Z',
      payload: {
        agentId,
        hasPendingQuestion: true,
        pendingQuestionCount: 1,
        pendingInputCount: 1,
        pendingInputKinds: ['askUserQuestion'],
        pendingAskUserQuestion,
      },
    } as DomainEvent);
    expect(planted.agentsById[agentId].pendingAskUserQuestion).toEqual(pendingAskUserQuestion);

    const reaped = applyEvent(planted, {
      type: 'agent.enrichment_changed',
      sequence: 2,
      timestamp: '2026-07-25T12:20:00.000Z',
      payload: {
        agentId,
        hasPendingQuestion: false,
        pendingQuestionCount: 0,
        pendingQuestionPrompt: undefined,
        pendingQuestionReason: undefined,
        pendingInputCount: 0,
        pendingInputKinds: [],
        pendingAskUserQuestion: undefined,
        pendingProposedPlan: undefined,
      },
    } as DomainEvent);

    expect(reaped.agentsById[agentId]).toMatchObject({
      hasPendingQuestion: false,
      pendingQuestionCount: 0,
      pendingInputCount: 0,
      pendingInputKinds: [],
    });
    expect(reaped.agentsById[agentId].pendingAskUserQuestion).toBeUndefined();
    expect(reaped.agentsById[agentId].pendingProposedPlan).toBeUndefined();
  });
});

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
      pendingAskUserQuestion,
    };
    expect(projectPendingInput('running', withQuestion)).toEqual(withQuestion);
    expect(projectPendingInput('stopped', withQuestion).pendingAskUserQuestion).toBeUndefined();
  });

  it('surfaces no pending fields when bootstrapping a long-stopped agent with stale question data', () => {
    const stalePending = {
      hasPendingQuestion: true,
      pendingQuestionCount: 1,
      pendingQuestionPrompt: 'Which scope should this issue use?',
      pendingQuestionReason: 'Planning is blocked',
      pendingInputCount: 1,
      pendingInputKinds: ['askUserQuestion'] as readonly string[],
      pendingAskUserQuestion,
    };

    expect(projectPendingInput('stopped', stalePending)).toEqual({
      hasPendingQuestion: undefined,
      pendingQuestionCount: undefined,
      pendingQuestionPrompt: undefined,
      pendingQuestionReason: undefined,
      pendingInputCount: undefined,
      pendingInputKinds: undefined,
      pendingAskUserQuestion: undefined,
    });
  });
});
