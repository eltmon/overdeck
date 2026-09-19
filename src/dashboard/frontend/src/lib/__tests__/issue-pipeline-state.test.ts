import { describe, expect, it } from 'vitest';
import { derivePipelineState, hasLivePane, isPaneLive } from '../issuePipelineState';
import type { BackendPane, DerivedIssueState, DerivedIssueStateName } from '../../types';

const derived = (state: DerivedIssueStateName, over: Partial<DerivedIssueState> = {}): DerivedIssueState => ({
  issueId: 'PAN-1',
  state,
  ...over,
});

const pane = (role: BackendPane['role'], state: BackendPane['state']): BackendPane => ({
  id: `pane-${role}`,
  issue: 'PAN-1',
  role,
  harness: 'claude-code',
  model: 'claude-opus-5',
  state,
});

describe('isPaneLive / hasLivePane', () => {
  it('counts idle, working and blocked panes as live', () => {
    expect(isPaneLive(pane('work', 'idle'))).toBe(true);
    expect(isPaneLive(pane('work', 'working'))).toBe(true);
    expect(isPaneLive(pane('work', 'blocked'))).toBe(true);
    expect(isPaneLive(pane('work', 'done'))).toBe(false);
    expect(isPaneLive(pane('work', 'exited'))).toBe(false);
    expect(isPaneLive(pane('work', 'unknown'))).toBe(false);
  });

  it('matches by role', () => {
    const panes = [pane('plan', 'working'), pane('work', 'exited')];
    expect(hasLivePane(panes, 'plan')).toBe(true);
    expect(hasLivePane(panes, 'work')).toBe(false);
    expect(hasLivePane(undefined, 'work')).toBe(false);
  });
});

describe('derivePipelineState (PAN-3917)', () => {
  it('planned + a live plan pane → planning_active; without one → awaiting work', () => {
    expect(derivePipelineState({ derived: derived('planned'), panes: [pane('plan', 'working')] })).toBe('planning_active');
    expect(derivePipelineState({ derived: derived('planned'), panes: [pane('plan', 'exited')] })).toBe('planning_done_awaiting_work');
    expect(derivePipelineState({ derived: derived('planned') })).toBe('planning_done_awaiting_work');
  });

  it('working + a live work pane → running; without one → idle', () => {
    expect(derivePipelineState({ derived: derived('working'), panes: [pane('work', 'working')] })).toBe('in_progress_work_running');
    expect(derivePipelineState({ derived: derived('working'), panes: [pane('work', 'exited')] })).toBe('in_progress_work_idle');
  });

  it('reads the review states off the derived state and the PR review state', () => {
    expect(derivePipelineState({ derived: derived('in-review') })).toBe('in_review_reviewers_running');
    expect(derivePipelineState({
      derived: derived('in-review', { pr: { url: 'u', number: 1, reviewState: 'approved', checks: 'pending', mergeable: true } }),
    })).toBe('in_review_approved');
    expect(derivePipelineState({ derived: derived('changes-requested') })).toBe('in_review_changes_requested');
  });

  it('maps the terminal states', () => {
    expect(derivePipelineState({ derived: derived('ready') })).toBe('ready_to_merge');
    expect(derivePipelineState({ derived: derived('merged') })).toBe('merged');
    expect(derivePipelineState({ derived: derived('closed') })).toBe('done');
    expect(derivePipelineState({ derived: derived('backlog') })).toBe('generic');
    expect(derivePipelineState({})).toBe('generic');
  });

  it('only the tracker separates canceled from done', () => {
    expect(derivePipelineState({ derived: derived('closed'), issueCanonicalState: 'canceled' })).toBe('canceled');
  });
});
