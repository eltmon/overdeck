/**
 * PAN-4383: answering a `pan ask` decision from the dashboard delivers the
 * answer and closes the decision in the journal only on a confirmed delivery.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deliverAgentMessage: vi.fn(),
  getAgentState: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

vi.mock('../../../../lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));
vi.mock('../../../../lib/agents.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
  deliverAgentPermissionDecision: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getAgentState: mocks.getAgentState,
}));
vi.mock('../agents/shared.js', () => ({
  constantTimeTokenEqual: vi.fn(),
  getAgentPendingQuestions: mocks.getAgentPendingQuestions,
  readJsonBody: vi.fn(),
}));

const { handlePostAgentAnswerQuestion } = await import('../agents/permissions.js');
const { readPipelineJournal } = await import('../../../../lib/cloister/pipeline-journal.js');
const {
  operatorDecisionAsPendingQuestion,
  readOpenOperatorDecision,
  requestOperatorDecision,
} = await import('../../../../lib/cloister/operator-decision.js');

const agentId = 'agent-pan-7';
let workspace: string;

function ask() {
  const decision = requestOperatorDecision(workspace, {
    issueId: 'PAN-7',
    agentId,
    question: 'Rotate the leaked token?',
    options: ['Yes', 'No'],
  });
  mocks.getAgentPendingQuestions.mockResolvedValue([operatorDecisionAsPendingQuestion(decision)]);
  return decision;
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace = mkdtempSync(join(tmpdir(), 'answer-operator-decision-'));
  mocks.getAgentState.mockReturnValue({ id: agentId, workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('handlePostAgentAnswerQuestion for an operator decision', () => {
  it('delivers the answer and appends operator.decision-answered on ok delivery', async () => {
    const decision = ask();
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'tmux' });

    const result = await handlePostAgentAnswerQuestion(agentId, {
      answers: ['Yes'],
      toolUseId: `operator-decision:${decision.questionId}`,
    });

    expect(result.status).toBeUndefined();
    expect(result.body).toMatchObject({ success: true, agentId });
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      agentId,
      `Operator answered your decision request (${decision.questionId}):\n\nQ: Rotate the leaked token?\nA: Yes`,
      'operator-decision-answer',
    );
    expect(readPipelineJournal(workspace).at(-1)).toMatchObject({
      type: 'operator.decision-answered',
      source: 'dashboard-answer',
      data: { questionId: decision.questionId, answer: 'Yes' },
    });
    expect(readOpenOperatorDecision(workspace)).toBeNull();
  });

  it('returns 502 and appends nothing when delivery fails', async () => {
    const decision = ask();
    mocks.deliverAgentMessage.mockResolvedValue({ ok: false, path: 'tmux', failure: 'pane gone' });

    const result = await handlePostAgentAnswerQuestion(agentId, {
      answers: ['Yes'],
      toolUseId: `operator-decision:${decision.questionId}`,
    });

    expect(result).toEqual({ body: { error: 'pane gone', code: 'delivery-failed' }, status: 502 });
    expect(readPipelineJournal(workspace)).toHaveLength(1);
    expect(readOpenOperatorDecision(workspace)?.questionId).toBe(decision.questionId);
  });

  it('returns 409 for a decision that is no longer pending', async () => {
    mocks.getAgentPendingQuestions.mockResolvedValue([]);

    const result = await handlePostAgentAnswerQuestion(agentId, {
      answers: ['Yes'],
      toolUseId: 'operator-decision:od-stale000',
    });

    expect(result).toEqual({
      body: { error: 'This decision was already answered or withdrawn', code: 'decision-closed' },
      status: 409,
    });
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });
});
