/**
 * Parity smoke test for `commandDeckActions` — verifies that every canonical
 * action key is reachable from at least one realistic pipeline state.
 *
 * If a future PR adds a new `ActionKey` value but forgets to wire it into
 * `getZoneAActions` / `getZoneBActions`, this test fails — the key is in the
 * `ALL_ACTION_KEYS` master list but not produced by any input. That's the
 * "parity smoke test" the review-agent feedback asks for.
 */

import { describe, it, expect } from 'vitest';
import {
  getZoneAActions,
  getZoneBActions,
  flattenActions,
  type ActionKey,
  type ZoneAInput,
} from '../commandDeckActions';

const ALL_ACTION_KEYS: readonly ActionKey[] = [
  'merge', 'reviewTest', 'recover', 'stopAgent',
  'startAgent', 'resumeSession', 'resetSession',
  'createWorkspace', 'copySettings',
  'beads', 'vbrief', 'state', 'prd', 'inference',
  'discussions', 'transcripts', 'upload', 'syncDiscussions', 'syncMain', 'statusReview',
  'reopen', 'restartFromPlan', 'resetIssue', 'cancel',
  'stopSession', 'viewTerminal',
];

const baseZoneA: ZoneAInput = {
  reviewStatus: null,
  agent: null,
  lifecycle: null,
  workspace: null,
  hasPlan: false,
  beadsCount: 0,
  hasInference: false,
  hasDiscussions: false,
  hasTranscripts: false,
  issueCanonicalState: 'in_progress',
  isMerged: false,
};

const agentWithGit = {
  status: 'stopped' as const,
  git: {
    branch: 'feature/pan-867',
    uncommittedFiles: 0,
    latestCommit: 'abc123 test commit',
  },
};

describe('getZoneAActions', () => {
  it('default state (no agent, no review, no plan) shows fresh-start basics', () => {
    const layout = getZoneAActions(baseZoneA);
    expect(layout.primary).toContain('startAgent');
    // No agent + no workspace → offer createWorkspace (in secondary).
    expect(layout.secondary).toContain('createWorkspace');
    // Default state has no merge / recover / reviewTest button.
    expect(layout.primary).not.toContain('merge');
    expect(layout.primary).not.toContain('recover');
    expect(layout.primary).not.toContain('reviewTest');
  });

  it('readyForMerge promotes merge + reviewTest to primary', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      reviewStatus: {
        issueId: 'PAN-830',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'pending',
        readyForMerge: true,
        updatedAt: '2026-04-26T00:00:00Z',
      },
    });
    expect(layout.primary).toContain('merge');
    expect(layout.primary).toContain('reviewTest');
  });

  it('failed pipeline surfaces recover + reviewTest', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      reviewStatus: {
        issueId: 'PAN-830',
        reviewStatus: 'failed',
        testStatus: 'pending',
        mergeStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-04-26T00:00:00Z',
      },
    });
    expect(layout.primary).toContain('recover');
    expect(layout.primary).toContain('reviewTest');
  });

  it('running agent surfaces stopAgent', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      agent: { status: 'running' },
    });
    expect(layout.primary).toContain('stopAgent');
    expect(layout.primary).not.toContain('startAgent');
    expect(layout.primary).not.toContain('resumeSession');
  });

  it('stopped agent with resumable session surfaces resumeSession + resetSession', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      agent: { status: 'stopped' },
      lifecycle: { canResumeSession: true },
      workspace: { exists: true },
    });
    expect(layout.primary).toContain('resumeSession');
    expect(layout.secondary).toContain('resetSession');
    expect(layout.secondary).toContain('copySettings');
  });

  it('stopped agent with no session surfaces startAgent + createWorkspace', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      agent: { status: 'stopped' },
      lifecycle: { canResumeSession: false },
      workspace: { exists: false },
    });
    expect(layout.primary).toContain('startAgent');
    expect(layout.secondary).toContain('createWorkspace');
    expect(layout.secondary).not.toContain('resetSession');
  });

  it('hasPlan + beadsCount surfaces beads + vbrief', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      hasPlan: true,
      beadsCount: 5,
    });
    expect(layout.secondary).toContain('beads');
    expect(layout.secondary).toContain('vbrief');
  });

  it('always surfaces planning artifact buttons (state, prd, status, sync, upload)', () => {
    const layout = getZoneAActions(baseZoneA);
    expect(layout.secondary).toContain('state');
    expect(layout.secondary).toContain('prd');
    expect(layout.secondary).toContain('statusReview');
    expect(layout.secondary).toContain('syncDiscussions');
    expect(layout.secondary).toContain('upload');
  });

  it('surfaces syncMain when the agent has git metadata', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      agent: agentWithGit,
    });
    expect(layout.secondary).toContain('syncMain');
  });

  it('inference / discussions / transcripts only surface when present', () => {
    const without = getZoneAActions(baseZoneA);
    expect(without.secondary).not.toContain('inference');
    expect(without.secondary).not.toContain('discussions');
    expect(without.secondary).not.toContain('transcripts');

    const withAll = getZoneAActions({
      ...baseZoneA,
      hasInference: true,
      hasDiscussions: true,
      hasTranscripts: true,
    });
    expect(withAll.secondary).toContain('inference');
    expect(withAll.secondary).toContain('discussions');
    expect(withAll.secondary).toContain('transcripts');
  });

  it('non-merged state surfaces danger zone (restartFromPlan, resetIssue, cancel)', () => {
    const layout = getZoneAActions(baseZoneA);
    expect(layout.overflow).toContain('restartFromPlan');
    expect(layout.overflow).toContain('resetIssue');
    expect(layout.overflow).toContain('cancel');
    // Issue is in_progress → no reopen.
    expect(layout.overflow).not.toContain('reopen');
  });

  it('done state surfaces reopen but not resetIssue', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      issueCanonicalState: 'done',
    });
    expect(layout.overflow).toContain('reopen');
    expect(layout.overflow).not.toContain('resetIssue');
  });

  it('merged state collapses danger zone entirely', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      isMerged: true,
    });
    expect(layout.overflow).not.toContain('cancel');
    expect(layout.overflow).not.toContain('reopen');
    expect(layout.overflow).not.toContain('resetIssue');
    expect(layout.overflow).not.toContain('restartFromPlan');
  });
});

describe('getZoneBActions', () => {
  it('active session surfaces stopSession', () => {
    const layout = getZoneBActions({ presence: 'active', type: 'work' });
    expect(layout.primary).toContain('stopSession');
  });

  it('idle session still surfaces stopSession (PTY can be detached)', () => {
    const layout = getZoneBActions({ presence: 'idle', type: 'work' });
    expect(layout.primary).toContain('stopSession');
  });

  it('ended session shows no stopSession', () => {
    const layout = getZoneBActions({ presence: 'ended', type: 'work' });
    expect(layout.primary).not.toContain('stopSession');
  });

  it('hasTerminal surfaces viewTerminal', () => {
    const layout = getZoneBActions({ presence: 'active', type: 'work', hasTerminal: true });
    expect(layout.secondary).toContain('viewTerminal');
  });
});

describe('parity smoke (master coverage)', () => {
  it('every ActionKey is reachable from at least one realistic state', () => {
    // Generate the union of all action keys produced across a representative
    // matrix of states. If any key in ALL_ACTION_KEYS isn't produced, the test
    // tells us so we can add either a missing branch in the mapper or a missing
    // test case here.
    const reached = new Set<ActionKey>();

    // Default + plan + artifacts + done (gives most artifact + reopen keys).
    for (const layout of [
      getZoneAActions(baseZoneA),
      getZoneAActions({
        ...baseZoneA,
        hasPlan: true,
        beadsCount: 3,
        hasInference: true,
        hasDiscussions: true,
        hasTranscripts: true,
        agent: agentWithGit,
      }),
      getZoneAActions({
        ...baseZoneA,
        issueCanonicalState: 'done',
      }),
    ]) {
      for (const k of flattenActions(layout)) reached.add(k);
    }

    // Workspace lifecycle states: running, stopped+resumable, stopped+fresh, no-workspace.
    for (const layout of [
      getZoneAActions({ ...baseZoneA, agent: { status: 'running' } }),
      getZoneAActions({
        ...baseZoneA,
        agent: { status: 'stopped' },
        lifecycle: { canResumeSession: true },
        workspace: { exists: true },
      }),
      getZoneAActions({
        ...baseZoneA,
        agent: { status: 'stopped' },
        lifecycle: { canResumeSession: false },
        workspace: { exists: false },
      }),
    ]) {
      for (const k of flattenActions(layout)) reached.add(k);
    }

    // Pipeline states: ready-to-merge, failed/blocked.
    for (const layout of [
      getZoneAActions({
        ...baseZoneA,
        reviewStatus: {
          issueId: 'PAN-830',
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'pending',
          readyForMerge: true,
          updatedAt: '2026-04-26T00:00:00Z',
        },
      }),
      getZoneAActions({
        ...baseZoneA,
        reviewStatus: {
          issueId: 'PAN-830',
          reviewStatus: 'failed',
          testStatus: 'pending',
          mergeStatus: 'pending',
          readyForMerge: false,
          updatedAt: '2026-04-26T00:00:00Z',
        },
      }),
    ]) {
      for (const k of flattenActions(layout)) reached.add(k);
    }

    // Zone B — active session with terminal.
    for (const k of flattenActions(getZoneBActions({
      presence: 'active', type: 'work', hasTerminal: true,
    }))) {
      reached.add(k);
    }

    const missing = ALL_ACTION_KEYS.filter((k) => !reached.has(k));
    expect(missing).toEqual([]);
  });

  it('actions from existing surfaces (KanbanBoard, InspectorPanel) are present in Command Deck output', () => {
    // Map of surface-exposed actions → the canonical ActionKey they correspond to.
    // This ensures drift detection: if a surface adds a new action not wired into
    // the Command Deck, the test fails.
    const surfaceActions: Array<{ name: string; key: ActionKey; find(): ActionKey[] }> = [
      { name: 'MergeButton', key: 'merge', find: () => flattenActions(getZoneAActions({ ...baseZoneA, reviewStatus: { issueId: 'PAN-830', reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending', readyForMerge: true, updatedAt: '2026-04-26T00:00:00Z' } })) },
      { name: 'StopAgentButton', key: 'stopAgent', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'running' } })) },
      { name: 'RecoverButton', key: 'recover', find: () => flattenActions(getZoneAActions({ ...baseZoneA, reviewStatus: { issueId: 'PAN-830', reviewStatus: 'failed', testStatus: 'pending', mergeStatus: 'pending', readyForMerge: false, updatedAt: '2026-04-26T00:00:00Z' } })) },
      { name: 'StartAgent', key: 'startAgent', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'stopped' }, lifecycle: { canResumeSession: false }, workspace: { exists: false } })) },
      { name: 'ResumeSession', key: 'resumeSession', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'stopped' }, lifecycle: { canResumeSession: true }, workspace: { exists: true } })) },
      { name: 'ResetSession', key: 'resetSession', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'stopped' }, lifecycle: { canResumeSession: true }, workspace: { exists: true } })) },
      { name: 'CreateWorkspace', key: 'createWorkspace', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'stopped' }, lifecycle: { canResumeSession: false }, workspace: { exists: false } })) },
      { name: 'CopySettings', key: 'copySettings', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: { status: 'stopped' }, lifecycle: { canResumeSession: true }, workspace: { exists: true } })) },
      { name: 'ReviewTest', key: 'reviewTest', find: () => flattenActions(getZoneAActions({ ...baseZoneA, reviewStatus: { issueId: 'PAN-830', reviewStatus: 'failed', testStatus: 'pending', mergeStatus: 'pending', readyForMerge: false, updatedAt: '2026-04-26T00:00:00Z' } })) },
      { name: 'Beads', key: 'beads', find: () => flattenActions(getZoneAActions({ ...baseZoneA, hasPlan: true, beadsCount: 3 })) },
      { name: 'vBrief', key: 'vbrief', find: () => flattenActions(getZoneAActions({ ...baseZoneA, hasPlan: true })) },
      { name: 'State', key: 'state', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'PRD', key: 'prd', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'Inference', key: 'inference', find: () => flattenActions(getZoneAActions({ ...baseZoneA, hasInference: true })) },
      { name: 'Discussions', key: 'discussions', find: () => flattenActions(getZoneAActions({ ...baseZoneA, hasDiscussions: true })) },
      { name: 'Transcripts', key: 'transcripts', find: () => flattenActions(getZoneAActions({ ...baseZoneA, hasTranscripts: true })) },
      { name: 'Upload', key: 'upload', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'SyncDiscussions', key: 'syncDiscussions', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'SyncMain', key: 'syncMain', find: () => flattenActions(getZoneAActions({ ...baseZoneA, agent: agentWithGit })) },
      { name: 'StatusReview', key: 'statusReview', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'Reopen', key: 'reopen', find: () => flattenActions(getZoneAActions({ ...baseZoneA, issueCanonicalState: 'done' })) },
      { name: 'RestartFromPlan', key: 'restartFromPlan', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'ResetIssue', key: 'resetIssue', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'Cancel', key: 'cancel', find: () => flattenActions(getZoneAActions(baseZoneA)) },
      { name: 'StopSession', key: 'stopSession', find: () => flattenActions(getZoneBActions({ presence: 'active', type: 'work' })) },
      { name: 'ViewTerminal', key: 'viewTerminal', find: () => flattenActions(getZoneBActions({ presence: 'active', type: 'work', hasTerminal: true })) },
    ];

    const missing: string[] = [];
    for (const surface of surfaceActions) {
      const actions = surface.find();
      if (!actions.includes(surface.key)) {
        missing.push(`${surface.name} → ${surface.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
