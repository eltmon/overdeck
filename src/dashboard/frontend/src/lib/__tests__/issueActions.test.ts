import { describe, expect, it } from 'vitest';

import {
  ISSUE_ACTIONS,
  deriveIssueActionPhase,
  getEnabledActions,
  getPhasePrimaryActions,
  type IssueActionKey,
  type IssueActionState,
  type PipelinePhase,
} from '../issueActions';

const prdActionKeys: readonly IssueActionKey[] = [
  'plan',
  'autoPlan',
  'watchPlanning',
  'donePlanning',
  'startAgent',
  'startSkipPlanning',
  'swarm',
  'tell',
  'doneWork',
  'requestReview',
  'restartReview',
  'recoverReview',
  'stopAgent',
  'pause',
  'unpause',
  'untroubled',
  'recoverAgent',
  'resumeSession',
  'switchModel',
  'syncMain',
  'inspectBead',
  'reopen',
  'closeOut',
  'wipe',
  'destroyWorkspace',
  'open',
  'resetIssue',
  'viewPr',
];

const preservedActionKeys: readonly IssueActionKey[] = [
  'beads',
  'inference',
  'discussions',
  'transcripts',
  'upload',
  'syncDiscussions',
  'statusReview',
  'createWorkspace',
  'copySettings',
  'resetSession',
  'restartFromPlan',
  'restartAgent',
  'reviewTest',
];

const baseState: IssueActionState = {
  reviewStatus: null,
  agent: null,
  lifecycle: null,
  workspace: { exists: true, path: '/tmp/workspace' },
  hasPlan: false,
  hasBeads: false,
  issueCanonicalState: 'todo',
  isMerged: false,
};

function keys(actions: { key: IssueActionKey }[]) {
  return actions.map((action) => action.key);
}

function reviewStatus(overrides: Partial<NonNullable<IssueActionState['reviewStatus']>> = {}): NonNullable<IssueActionState['reviewStatus']> {
  return {
    issueId: 'PAN-1331',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('ISSUE_ACTIONS', () => {
  it('contains every PRD action key and every preserved existing action key', () => {
    const registered = new Set(ISSUE_ACTIONS.map((action) => action.key));

    for (const key of prdActionKeys) expect(registered.has(key), key).toBe(true);
    for (const key of preservedActionKeys) expect(registered.has(key), key).toBe(true);
    expect(registered.size).toBe(ISSUE_ACTIONS.length);
  });

  it('fully describes every registry entry', () => {
    for (const action of ISSUE_ACTIONS) {
      expect(action.label.trim(), action.key).not.toBe('');
      expect(action, action.key).toHaveProperty('panVerb');
      expect(action, action.key).toHaveProperty('endpoint');
      expect(typeof action.enabledWhen, action.key).toBe('function');
      expect(Array.isArray(action.phasePrimary), action.key).toBe(true);
      expect(['safe', 'dialog', 'destructive']).toContain(action.kind);
      expect(action.group.trim(), action.key).not.toBe('');
    }
  });

  it('filters enabled actions without mutating registry order', () => {
    const enabled = keys(getEnabledActions({
      ...baseState,
      hasPlan: true,
      hasBeads: true,
      hasInference: true,
      hasDiscussions: true,
      hasTranscripts: true,
      agent: { status: 'stopped', git: { branch: 'feature/pan-1331', latestCommit: 'abc', uncommittedFiles: 0 } },
      lifecycle: { canResumeSession: true },
    }));

    expect(enabled).toContain('beads');
    expect(enabled).toContain('inference');
    expect(enabled).toContain('discussions');
    expect(enabled).toContain('transcripts');
    expect(enabled).toContain('syncMain');
    expect(enabled).toContain('resumeSession');
    expect(enabled).toContain('resetSession');
  });
});

describe('getPhasePrimaryActions', () => {
  const cases: Array<[PipelinePhase, IssueActionState, IssueActionKey[]]> = [
    ['QUEUED_FOR_PLAN', { ...baseState, workspace: { exists: false }, hasPlan: false, issueCanonicalState: 'todo' }, ['plan', 'startAgent']],
    ['PLANNING', { ...baseState, agent: { status: 'running', role: 'plan' }, issueCanonicalState: 'in_progress' }, ['watchPlanning', 'donePlanning']],
    ['PLANNED_IDLE', { ...baseState, hasPlan: true, issueCanonicalState: 'todo' }, ['startAgent']],
    ['WORK_RUNNING', { ...baseState, agent: { status: 'running', role: 'work' }, issueCanonicalState: 'in_progress' }, ['tell', 'doneWork']],
    ['INPUT', { ...baseState, agent: { status: 'running', role: 'work' }, hasPendingInput: true }, ['open', 'tell']],
    ['REVIEW_RUNNING', { ...baseState, agent: { status: 'running', role: 'review' }, reviewStatus: reviewStatus({ reviewStatus: 'reviewing' }) }, ['tell', 'recoverAgent']],
    ['SHIP_RUNNING', { ...baseState, agent: { status: 'running', role: 'ship' }, reviewStatus: reviewStatus({ mergeStatus: 'merging' }) }, ['tell', 'recoverAgent']],
    ['CHANGES_REQUESTED', { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'blocked' }) }, ['open', 'requestReview']],
    ['STUCK', { ...baseState, agent: { status: 'failed', role: 'work' }, reviewStatus: reviewStatus({ testStatus: 'failed' }) }, ['recoverAgent', 'tell']],
    ['READY_TO_MERGE', { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true }), hasPr: true }, ['viewPr']],
    ['MERGED', { ...baseState, isMerged: true, reviewStatus: reviewStatus({ mergeStatus: 'merged' }) }, ['closeOut']],
  ];

  it.each(cases)('returns the ordered %s primary action set', (phase, state, expected) => {
    expect(keys(getPhasePrimaryActions(state, phase))).toEqual(expected);
  });

  it('derives the selector phase from the shared pipeline classifier', () => {
    expect(deriveIssueActionPhase({ ...baseState, hasPlan: false, issueCanonicalState: 'todo' })).toBe('QUEUED_FOR_PLAN');
    expect(deriveIssueActionPhase({ ...baseState, agent: { status: 'running', role: 'plan' }, issueCanonicalState: 'in_progress' })).toBe('PLANNING');
    expect(deriveIssueActionPhase({ ...baseState, agent: { status: 'running', role: 'work' }, issueCanonicalState: 'in_progress' })).toBe('WORK_RUNNING');
    expect(deriveIssueActionPhase({ ...baseState, reviewStatus: reviewStatus({ readyForMerge: true }) })).toBe('READY_TO_MERGE');
    expect(deriveIssueActionPhase({ ...baseState, isMerged: true })).toBe('MERGED');
  });
});
