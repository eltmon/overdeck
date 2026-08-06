import { describe, expect, it } from 'vitest';
import { derivePipelineState, type PipelineStateInput } from '../issuePipelineState';

function makeInput(overrides: Partial<PipelineStateInput> = {}): PipelineStateInput {
  return {
    hasPlan: false,
    hasTasks: false,
    ...overrides,
  };
}

describe('derivePipelineState — plan-agent states (PAN-3338)', () => {
  it('stopped plan agent + hasPlan + canonical planned → planning_done_awaiting_work', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'stopped', role: 'plan' },
      hasPlan: true,
      issueCanonicalState: 'planned',
    }));
    expect(result).toBe('planning_done_awaiting_work');
  });

  it('stopped plan agent + hasPlan + canonical todo → planning_done_awaiting_work', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'stopped', role: 'plan' },
      hasPlan: true,
      issueCanonicalState: 'todo',
    }));
    expect(result).toBe('planning_done_awaiting_work');
  });

  it('stopped plan agent + hasPlan + canonical backlog → planning_done_awaiting_work', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'stopped', role: 'plan' },
      hasPlan: true,
      issueCanonicalState: 'backlog',
    }));
    expect(result).toBe('planning_done_awaiting_work');
  });

  it('running plan agent + hasPlan (replan in flight) → planning_active, not downgraded', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'running', role: 'plan' },
      hasPlan: true,
      issueCanonicalState: 'todo',
    }));
    expect(result).toBe('planning_active');
  });

  it('running plan agent + no plan (mid-planning) → planning_active', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'running', role: 'plan' },
      hasPlan: false,
      issueCanonicalState: 'todo',
    }));
    expect(result).toBe('planning_active');
  });

  it('stopped plan agent + no plan + canonical todo → not planning_done_awaiting_work', () => {
    const result = derivePipelineState(makeInput({
      agent: { status: 'stopped', role: 'plan' },
      hasPlan: false,
      issueCanonicalState: 'todo',
    }));
    expect(result).not.toBe('planning_done_awaiting_work');
  });
});
