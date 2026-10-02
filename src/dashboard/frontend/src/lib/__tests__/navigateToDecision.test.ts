/**
 * PAN-4466 — decisionSubjectPath carries an optional terminal view for a
 * conversation target, and navigateToDecisionSubject pushes a new history
 * entry when only the query string changes (chat view -> terminal view on
 * an already-open conversation pane).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decisionSubjectPath, navigateToDecisionSubject } from '../navigateToDecision';

describe('decisionSubjectPath', () => {
  it('returns /conv/<id>?view=terminal for a conversation target with view terminal', () => {
    expect(decisionSubjectPath({ id: 'c1', source: 'conversation', view: 'terminal' })).toBe('/conv/c1?view=terminal');
  });

  it('returns /conv/<id> for a conversation target without view', () => {
    expect(decisionSubjectPath({ id: 'c1', source: 'conversation' })).toBe('/conv/c1');
  });

  it('ignores view for an agent target', () => {
    expect(decisionSubjectPath({ id: 'a1', source: 'agent', issueId: 'PAN-1', view: 'terminal' })).toBe('/issues/PAN-1');
  });
});

describe('navigateToDecisionSubject', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/conv/c1');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('pushes a new history entry when only the search differs', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    navigateToDecisionSubject({ id: 'c1', source: 'conversation', view: 'terminal' });
    expect(pushState).toHaveBeenCalledWith({}, '', '/conv/c1?view=terminal');
    expect(window.location.pathname + window.location.search).toBe('/conv/c1?view=terminal');
  });

  it('dispatches a synthetic popstate even when the path is unchanged', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    navigateToDecisionSubject({ id: 'c1', source: 'conversation' });
    expect(dispatch).toHaveBeenCalledWith(expect.any(PopStateEvent));
  });
});
