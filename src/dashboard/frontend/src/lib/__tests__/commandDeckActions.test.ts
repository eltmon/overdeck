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
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getZoneAActions,
  getZoneBActions,
  flattenActions,
  type ActionKey,
  type ZoneAInput,
} from '../commandDeckActions';
import { COMMAND_DECK_PARITY_SURFACES, COMMAND_DECK_SURFACE_REGISTRY } from '../commandDeckSurfaceRegistry';

const ALL_ACTION_KEYS: readonly ActionKey[] = [
  'merge', 'reviewTest', 'recover', 'stopAgent',
  'startAgent', 'resumeSession', 'resetSession',
  'createWorkspace', 'copySettings',
  'beads', 'inference',
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

const failedAgentNoWorkspace = {
  status: 'failed' as const,
};

const surfaceFiles = Object.fromEntries(
  COMMAND_DECK_PARITY_SURFACES.map(({ surface, file }) => {
    const fromCwd = resolve(process.cwd(), file);
    // When tests run from the frontend workspace, cwd is src/dashboard/frontend
    // and the file paths already include src/dashboard/frontend/ — try repo root too
    const fromRepoRoot = resolve(process.cwd(), '../../..', file);
    return [surface, existsSync(fromCwd) ? fromCwd : fromRepoRoot];
  })
) as Record<(typeof COMMAND_DECK_PARITY_SURFACES)[number]['surface'], string>;

function getSourceActions(): ActionKey[] {
  return COMMAND_DECK_SURFACE_REGISTRY.map((entry) => entry.actionKey);
}

function assertSurfaceImportsRegistry(surface: keyof typeof surfaceFiles) {
  const source = readFileSync(surfaceFiles[surface], 'utf-8');
  expect(source).toContain('COMMAND_DECK_SURFACE_REGISTRY');
}

function getCommandDeckReachableActions(): Set<ActionKey> {
  const reached = new Set<ActionKey>();

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
    getZoneAActions({
      ...baseZoneA,
      issueCanonicalState: 'canceled',
    }),
    getZoneAActions({
      ...baseZoneA,
      agent: { status: 'running' },
    }),
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
    getZoneAActions({
      ...baseZoneA,
      agent: failedAgentNoWorkspace,
      lifecycle: { canResumeSession: false },
      workspace: { exists: false },
    }),
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

  for (const k of flattenActions(getZoneBActions({
    presence: 'active', type: 'work', hasTerminal: true,
  }))) {
    reached.add(k);
  }

  return reached;
}

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

  it('failed agent with no workspace still surfaces startAgent + createWorkspace', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      agent: failedAgentNoWorkspace,
      lifecycle: { canResumeSession: false },
      workspace: { exists: false },
    });
    expect(layout.primary).toContain('startAgent');
    expect(layout.secondary).toContain('createWorkspace');
  });

  it('hasPlan + beadsCount surfaces beads', () => {
    const layout = getZoneAActions({
      ...baseZoneA,
      hasPlan: true,
      beadsCount: 5,
    });
    expect(layout.secondary).toContain('beads');
  });

  it('always surfaces planning artifact buttons (status, sync, upload)', () => {
    const layout = getZoneAActions(baseZoneA);
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
    const reached = getCommandDeckReachableActions();
    const missing = ALL_ACTION_KEYS.filter((k) => !reached.has(k));
    expect(missing).toEqual([]);
  });

  it('derives parity-managed actions from source surfaces via the shared registry', () => {
    for (const { surface } of COMMAND_DECK_PARITY_SURFACES) {
      assertSurfaceImportsRegistry(surface);
    }

    const sourceActions = getSourceActions();
    const reached = getCommandDeckReachableActions();
    const missing = sourceActions.filter((key) => !reached.has(key));

    expect(missing).toEqual([]);
  });
});
