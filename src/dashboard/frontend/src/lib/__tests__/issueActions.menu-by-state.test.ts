/**
 * PAN-4198 · the menu-per-state contract (FR-2, FR-5).
 *
 * One case per row of the PRD's "Expected menu per derived state" table. Each
 * pins the *exact* set `getMenuActions` returns, because the value of the trim
 * is what the operator does NOT see. The ≤10 ceiling is asserted per row and
 * leaves room for the Replan entry that #4203 adds on top of this registry.
 *
 * Contextual entries (pause, recoverAgent, rebuildAndStart, createWorkspace)
 * never appear here — cards invoke them by key, menus do not list them.
 */
import { describe, expect, it } from 'vitest';

import {
  ISSUE_ACTIONS,
  getMenuActions,
  type IssueActionKey,
  type IssueActionState,
} from '../issueActions';

const MENU_CEILING = 10;

const workspace = { exists: true, issueId: 'PAN-1', path: '/tmp/feature-pan-1' } as IssueActionState['workspace'];
const noWorkspace = { exists: false, issueId: 'PAN-1' } as IssueActionState['workspace'];

/** Every fixture starts here: order books loaded, nothing queued, no PR. */
function baseState(overrides: Partial<IssueActionState> = {}): IssueActionState {
  return {
    derived: null,
    panes: [],
    agent: null,
    lifecycle: null,
    workspace: noWorkspace,
    hasPlan: false,
    hasTasks: false,
    issueCanonicalState: 'todo',
    isMerged: false,
    hasPr: false,
    prUrl: null,
    orderBooksLoaded: true,
    isInActiveOrderBook: false,
    ...overrides,
  };
}

const PLAN_PANE = [{ id: 'pane-plan', issue: 'PAN-1', role: 'plan' as const, harness: 'claude-code', model: 'claude-opus-5', state: 'working' as const }];
const WORK_PANE = [{ id: 'pane-work', issue: 'PAN-1', role: 'work' as const, harness: 'claude-code', model: 'claude-opus-5', state: 'working' as const }];

const pr = (reviewState: string, checks: 'pending' | 'green' | 'red', mergeable: boolean) =>
  ({ url: 'https://example.test/pr/1', number: 1, reviewState, checks, mergeable });

/** A work agent that has stopped with a session worth resuming. */
const stoppedWork = {
  agent: { status: 'stopped', role: 'work' } as IssueActionState['agent'],
  lifecycle: { canResumeSession: true },
  hasPlan: true,
  hasTasks: true,
  workspace,
  hasPr: true,
  issueCanonicalState: 'in_review',
};

const cases: ReadonlyArray<readonly [string, IssueActionState, readonly IssueActionKey[]]> = [
  [
    'backlog: plan it, queue it, or drop it',
    baseState({ derived: { issueId: 'PAN-1', state: 'backlog' } }),
    ['plan', 'addToOrderBook', 'cancel'],
  ],
  [
    'parked: same three as backlog',
    baseState({ derived: { issueId: 'PAN-1', state: 'parked' } }),
    ['plan', 'addToOrderBook', 'cancel'],
  ],
  [
    'planning: watch it or talk to it, never queue it',
    baseState({
      derived: { issueId: 'PAN-1', state: 'planned' },
      panes: PLAN_PANE,
      agent: { status: 'running', role: 'plan' },
      workspace,
      issueCanonicalState: 'in_progress',
    }),
    ['watchPlanning', 'tell', 'stopAgent', 'resetIssue', 'cancel', 'open'],
  ],
  [
    'planned: accept the plan and start work',
    baseState({
      derived: { issueId: 'PAN-1', state: 'planned' },
      agent: { status: 'stopped', role: 'plan' },
      lifecycle: { canResumeSession: false },
      hasPlan: true,
      hasTasks: true,
      workspace,
      issueCanonicalState: 'in_progress',
    }),
    ['donePlanning', 'startAgent', 'syncMain', 'resetIssue', 'cancel', 'open', 'addToOrderBook', 'tasks'],
  ],
  [
    'working: steer the agent, no start and no sync',
    baseState({
      derived: { issueId: 'PAN-1', state: 'working' },
      panes: WORK_PANE,
      agent: { status: 'running', role: 'work' },
      hasPlan: true,
      hasTasks: true,
      workspace,
      issueCanonicalState: 'in_progress',
    }),
    ['tell', 'doneWork', 'stopAgent', 'restartAgent', 'resetIssue', 'cancel', 'open', 'tasks'],
  ],
  [
    'in-review: review again, never resume or restart the author',
    baseState({ ...stoppedWork, derived: { issueId: 'PAN-1', state: 'in-review', pr: pr('review-requested', 'pending', true) } }),
    ['restartReview', 'syncMain', 'resetIssue', 'cancel', 'open', 'viewPr', 'tasks'],
  ],
  [
    'changes-requested: the one state that offers Resume and Restart',
    baseState({ ...stoppedWork, derived: { issueId: 'PAN-1', state: 'changes-requested', pr: pr('changes-requested', 'pending', true) } }),
    ['restartReview', 'resumeSession', 'restartAgent', 'syncMain', 'resetIssue', 'cancel', 'open', 'viewPr', 'tasks'],
  ],
  [
    'ready: merge is the next step',
    baseState({ ...stoppedWork, derived: { issueId: 'PAN-1', state: 'ready', pr: pr('approved', 'green', true) } }),
    ['merge', 'syncMain', 'resetIssue', 'cancel', 'open', 'viewPr', 'tasks'],
  ],
  [
    'merged: close out, and nothing that would undo the merge',
    baseState({
      ...stoppedWork,
      derived: { issueId: 'PAN-1', state: 'merged', pr: pr('approved', 'green', true) },
      isMerged: true,
      lifecycle: null,
    }),
    ['closeOut', 'open', 'viewPr', 'tasks'],
  ],
  [
    'closed: reopen it, or reclaim the workspace',
    baseState({
      ...stoppedWork,
      derived: { issueId: 'PAN-1', state: 'closed', pr: pr('approved', 'green', true) },
      lifecycle: null,
      issueCanonicalState: 'done',
    }),
    ['reopen', 'destroyWorkspace', 'open', 'viewPr', 'tasks'],
  ],
];

describe('getMenuActions per derived state', () => {
  it.each(cases)('%s', (_name, state, expected) => {
    const actual = getMenuActions(state).map((action) => action.key);

    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual).toHaveLength(expected.length);
    expect(actual.length).toBeLessThanOrEqual(MENU_CEILING);
  });

  it('never lists a contextual entry', () => {
    for (const [name, state] of cases) {
      const contextual = getMenuActions(state).filter((action) => action.placement !== 'menu');
      expect(contextual.map((action) => action.key), name).toEqual([]);
    }
  });
});

describe('registry copy (FR-5)', () => {
  it('has no planning jargon in any label', () => {
    for (const action of ISSUE_ACTIONS) {
      expect(action.label, action.key).not.toMatch(/done planning|watch planning/i);
    }
  });

  it('describes every action, menu or contextual, in one sentence', () => {
    for (const action of ISSUE_ACTIONS) {
      expect(action.description, action.key).toMatch(/^[^\n]+\.$/);
      expect(action.description, action.key).not.toContain('. ');
    }
  });
});
