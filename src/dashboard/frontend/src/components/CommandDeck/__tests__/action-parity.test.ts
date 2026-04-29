/**
 * Action parity smoke test — verifies that every user-facing action from
 * the legacy views (KanbanBoard, InspectorPanel, BadgeBar, StatusFlowControl)
 * has a corresponding ActionKey in the Command Deck action maps.
 *
 * This is a compile-time/unit test — no DOM rendering needed.
 */

import { describe, it, expect } from 'vitest';
import {
  getZoneAActions,
  getZoneBActions,
  flattenActions,
  type ActionKey,
  type ZoneAInput,
  type ZoneBInput,
} from '../../../lib/commandDeckActions';

function collectAllPossibleActions(): Set<ActionKey> {
  const allActions = new Set<ActionKey>();

  const base = { hasPlan: true, beadsCount: 5, hasInference: false, hasTranscripts: false, hasDiscussions: false };
  const zoneAInputs: ZoneAInput[] = [
    // generic: no agent, no review → startAgent, createWorkspace
    { hasPlan: false, beadsCount: 0, hasInference: false, hasTranscripts: false, hasDiscussions: false },
    // generic: all artifacts → beads, vbrief, inference, discussions, transcripts
    { hasPlan: true, beadsCount: 5, hasInference: true, hasTranscripts: true, hasDiscussions: true },
    // in_progress_work_running → stopAgent
    { ...base, issueCanonicalState: 'in_progress', agent: { status: 'active', agentPhase: 'working', git: null } },
    // in_progress_work_idle with resume → resumeSession, resetSession, copySettings
    { ...base, issueCanonicalState: 'in_progress', lifecycle: { canResumeSession: true }, workspace: { exists: true } },
    // in_progress_work_idle without resume → startAgent, createWorkspace
    { ...base, issueCanonicalState: 'in_progress', workspace: { exists: false } },
    // verification_failing → reviewTest, recover
    { ...base, issueCanonicalState: 'in_progress', reviewStatus: { verificationStatus: 'failed' } as any },
    // in_review_changes_requested → reviewTest, recover
    { ...base, issueCanonicalState: 'in_progress', reviewStatus: { reviewStatus: 'failed' } as any },
    // in_review_approved + readyForMerge → reviewTest, merge
    { ...base, issueCanonicalState: 'in_progress', reviewStatus: { reviewStatus: 'passed', readyForMerge: true } as any },
    // ready_to_merge → merge, reviewTest
    { ...base, issueCanonicalState: 'in_progress', reviewStatus: { readyForMerge: true } as any },
    // done → reopen
    { ...base, issueCanonicalState: 'done', isMerged: true },
    // canceled → reopen
    { ...base, issueCanonicalState: 'canceled' },
    // with git → syncMain
    { ...base, issueCanonicalState: 'in_progress', agent: { status: 'active', agentPhase: 'working', git: { branch: 'main' } } },
    // stuck → recover
    { ...base, issueCanonicalState: 'in_progress', reviewStatus: { reviewStatus: 'blocked', stuckSince: new Date().toISOString() } as any },
  ];

  for (const input of zoneAInputs) {
    for (const key of flattenActions(getZoneAActions(input))) {
      allActions.add(key);
    }
  }

  const zoneBInputs: ZoneBInput[] = [
    { presence: 'active', type: 'work', hasTerminal: true },
    { presence: 'idle', type: 'work', hasTerminal: false },
    { presence: 'ended', type: 'work', hasTerminal: false },
    { presence: 'active', type: 'review', hasTerminal: true },
  ];

  for (const input of zoneBInputs) {
    for (const key of flattenActions(getZoneBActions(input))) {
      allActions.add(key);
    }
  }

  return allActions;
}

describe('Command Deck action parity', () => {
  const allActions = collectAllPossibleActions();

  const legacyActionMap: Record<string, ActionKey> = {
    // KanbanBoard context menu
    'Review & Test': 'reviewTest',
    'Stop agent': 'stopAgent',
    'Start agent': 'startAgent',
    'Create workspace': 'createWorkspace',
    'Merge': 'merge',
    'Reopen': 'reopen',
    'Cancel': 'cancel',

    // InspectorPanel / StatusFlowControl pipeline actions
    'Recover': 'recover',
    'Resume session': 'resumeSession',
    'Reset session': 'resetSession',
    'Restart from plan': 'restartFromPlan',
    'Reset issue': 'resetIssue',

    // BadgeBar artifact buttons
    'PRD': 'prd',
    'State': 'state',
    'Beads': 'beads',
    'Transcripts': 'transcripts',
    'Discussions': 'discussions',
    'Upload': 'upload',

    // Zone A secondary actions
    'vBRIEF': 'vbrief',
    'Inference': 'inference',
    'Sync discussions': 'syncDiscussions',
    'Sync main': 'syncMain',
    'Status review': 'statusReview',
    'Copy settings': 'copySettings',

    // Zone B session-scoped actions
    'Stop session': 'stopSession',
    'View terminal': 'viewTerminal',
    'View State.md': 'viewState',
    'View vBRIEF': 'viewVbrief',
    'Copy Session ID': 'copySessionId',
    'Copy tmux command': 'copyTmuxCommand',
  };

  it.each(Object.entries(legacyActionMap))(
    'legacy action "%s" maps to ActionKey "%s" which exists in the action surface',
    (legacyLabel, actionKey) => {
      expect(allActions.has(actionKey)).toBe(true);
    },
  );

  it('covers all ActionKey values in the legacy action map', () => {
    const mappedKeys = new Set(Object.values(legacyActionMap));
    for (const action of allActions) {
      expect(mappedKeys.has(action)).toBe(true);
    }
  });
});
