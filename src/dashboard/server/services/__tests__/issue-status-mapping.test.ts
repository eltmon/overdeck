import { describe, expect, it } from 'vitest';
import {
  displayStatusForCanonical,
  getCanonicalStatus,
  mapRallyStateToCanonical,
  shouldRefreshPlanningStateForIssue,
} from '../issue-status-mapping.js';

describe('issue-status-mapping', () => {
  it('maps raw statuses to canonical states', () => {
    expect(getCanonicalStatus('In Review')).toBe('in_review');
    expect(getCanonicalStatus('Custom', 'started')).toBe('in_progress');
    expect(getCanonicalStatus(undefined)).toBe('backlog');
  });

  it('refreshes planning state only for open issues', () => {
    expect(shouldRefreshPlanningStateForIssue({ status: 'Todo' })).toBe(true);
    expect(shouldRefreshPlanningStateForIssue({ status: 'Done' })).toBe(false);
    expect(shouldRefreshPlanningStateForIssue({ status: 'Canceled' })).toBe(false);
  });

  it('maps canonical states to display labels', () => {
    expect(displayStatusForCanonical('verifying_on_main')).toBe('Verifying');
    expect(displayStatusForCanonical('unknown')).toBe('Todo');
  });

  it('maps normalized Rally states to canonical states', () => {
    expect(mapRallyStateToCanonical('in_progress')).toBe('in_progress');
    expect(mapRallyStateToCanonical('closed')).toBe('done');
    expect(mapRallyStateToCanonical('open')).toBe('todo');
    expect(mapRallyStateToCanonical('')).toBe('todo');
  });
});
