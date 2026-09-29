/**
 * PAN-4383: the open operator decision is derived from the pipeline journal.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

const getAgentStateMock = vi.fn();
vi.mock('../../agents/agent-state-read.js', () => ({
  getAgentState: (id: string) => getAgentStateMock(id),
}));

const { appendPipelineEntry, readPipelineJournal } = await import('../pipeline-journal.js');
const {
  OPERATOR_DECISION_TOOL_ID_PREFIX,
  answerOperatorDecision,
  closeOpenDecisionOnOperatorMessage,
  deriveOpenOperatorDecision,
  isOperatorDecisionToolId,
  operatorDecisionAsPendingQuestion,
  readOpenOperatorDecision,
  requestOperatorDecision,
  withdrawOperatorDecision,
} = await import('../operator-decision.js');

let workspace: string;

const ask = (question = 'Rotate the leaked token?') =>
  requestOperatorDecision(workspace, {
    issueId: 'PAN-1',
    agentId: 'agent-pan-1',
    question,
    options: ['Yes', 'No'],
  });

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'operator-decision-'));
  getAgentStateMock.mockReset();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('deriveOpenOperatorDecision', () => {
  it('returns the requested decision with its questionId, question and options', () => {
    const requested = ask();
    const open = readOpenOperatorDecision(workspace);
    expect(open).toEqual(requested);
    expect(open?.questionId).toMatch(/^od-[0-9a-f]{8}$/);
    expect(open?.question).toBe('Rotate the leaked token?');
    expect(open?.options).toEqual(['Yes', 'No']);
    expect(readPipelineJournal(workspace)[0]).toMatchObject({
      type: 'operator.decision-requested',
      source: 'pan-ask',
      data: { agentId: 'agent-pan-1' },
    });
  });

  it('is closed by an answered entry with the same questionId', () => {
    const decision = ask();
    answerOperatorDecision(workspace, decision, 'Yes', 'dashboard-answer');
    expect(readOpenOperatorDecision(workspace)).toBeNull();
    expect(readPipelineJournal(workspace).at(-1)).toMatchObject({
      type: 'operator.decision-answered',
      source: 'dashboard-answer',
      data: { questionId: decision.questionId, answer: 'Yes', via: 'dashboard-answer' },
    });
  });

  it('is closed by a withdrawn entry with the same questionId', () => {
    withdrawOperatorDecision(workspace, ask());
    expect(readOpenOperatorDecision(workspace)).toBeNull();
  });

  it('is closed by a later verification.started entry', () => {
    ask();
    appendPipelineEntry(workspace, { type: 'verification.started', issueId: 'PAN-1', source: 'pan-done' });
    expect(readOpenOperatorDecision(workspace)).toBeNull();
  });

  it('returns the newer request when two are open', () => {
    const older = ask('first?');
    const newer = ask('second?');
    const open = readOpenOperatorDecision(workspace);
    expect(open?.questionId).toBe(newer.questionId);
    expect(open?.question).toBe('second?');
    // Answering the superseded one leaves the newer one open.
    answerOperatorDecision(workspace, older, 'Yes', 'pan-tell');
    expect(readOpenOperatorDecision(workspace)?.questionId).toBe(newer.questionId);
  });

  it('stays open when the answer names another questionId', () => {
    const decision = ask();
    answerOperatorDecision(workspace, { ...decision, questionId: 'od-other' }, 'Yes', 'pan-tell');
    expect(readOpenOperatorDecision(workspace)?.questionId).toBe(decision.questionId);
  });

  it('ignores requests with malformed data', () => {
    expect(deriveOpenOperatorDecision([
      { at: '2026-09-29T00:00:00Z', type: 'operator.decision-requested', issueId: 'PAN-1', data: { question: 'q', options: ['a'] } },
      { at: '2026-09-29T00:00:01Z', type: 'operator.decision-requested', issueId: 'PAN-1', data: { questionId: 'od-1', question: 'q', options: [1, 2] } },
      { at: '2026-09-29T00:00:02Z', type: 'operator.decision-requested', issueId: 'PAN-1' },
    ])).toBeNull();
  });

  it('truncates a long answer to 2000 characters', () => {
    answerOperatorDecision(workspace, ask(), 'x'.repeat(5000), 'pan-tell');
    expect((readPipelineJournal(workspace).at(-1)?.data?.answer as string).length).toBe(2000);
  });
});

describe('operatorDecisionAsPendingQuestion', () => {
  it('maps the decision to a pending AskUserQuestion shape', () => {
    const decision = { ...ask(), context: 'Push protection blocked the branch.' };
    const pending = operatorDecisionAsPendingQuestion(decision);
    expect(pending.toolId).toBe(`${OPERATOR_DECISION_TOOL_ID_PREFIX}${decision.questionId}`);
    expect(isOperatorDecisionToolId(pending.toolId)).toBe(true);
    expect(isOperatorDecisionToolId('toolu_123')).toBe(false);
    expect(pending.timestamp).toBe(decision.askedAt);
    expect(pending.questions).toEqual([{
      question: 'Rotate the leaked token?\n\nPush protection blocked the branch.',
      header: 'Decision',
      multiSelect: false,
      options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }],
    }]);
  });
});

describe('closeOpenDecisionOnOperatorMessage', () => {
  it('answers the open decision for the asking agent', () => {
    ask();
    getAgentStateMock.mockReturnValue({ workspace });
    expect(closeOpenDecisionOnOperatorMessage('AGENT-PAN-1', 'go ahead', 'pan-tell')).toBe(true);
    expect(readOpenOperatorDecision(workspace)).toBeNull();
  });

  it('returns false and appends nothing for another agent', () => {
    ask();
    getAgentStateMock.mockReturnValue({ workspace });
    const before = readPipelineJournal(workspace).length;
    expect(closeOpenDecisionOnOperatorMessage('agent-pan-2', 'go ahead', 'pan-tell')).toBe(false);
    expect(readPipelineJournal(workspace)).toHaveLength(before);
  });

  it('returns false when the agent state cannot be read', () => {
    ask();
    getAgentStateMock.mockImplementation(() => { throw new Error('boom'); });
    expect(closeOpenDecisionOnOperatorMessage('agent-pan-1', 'go ahead', 'pan-tell')).toBe(false);
    expect(readOpenOperatorDecision(workspace)).not.toBeNull();
  });
});
