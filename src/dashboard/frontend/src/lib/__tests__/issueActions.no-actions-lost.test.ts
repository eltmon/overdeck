import { describe, expect, it } from 'vitest';

import {
  ISSUE_ACTIONS,
  type IssueActionKey,
} from '../issueActions';

const registryKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));
const registryByKey = new Map(ISSUE_ACTIONS.map((action) => [action.key, action]));

const legacyCommandDeckIssueActions = [
  { legacyKey: 'merge', registryKey: null, surfaceText: 'Merge', note: 'Human-only MergeButton remains outside ISSUE_ACTIONS per Decision D6.' },
  { legacyKey: 'reviewTest', registryKey: 'reviewTest', surfaceText: 'Review & Test' },
  { legacyKey: 'recover', registryKey: 'recoverReview', surfaceText: 'Recover' },
  { legacyKey: 'stopAgent', registryKey: 'stopAgent', surfaceText: 'Stop Agent' },
  { legacyKey: 'startAgent', registryKey: 'startAgent', surfaceText: 'Start Agent' },
  { legacyKey: 'resumeSession', registryKey: 'resumeSession', surfaceText: 'Resume Session' },
  { legacyKey: 'resetSession', registryKey: 'resetSession', surfaceText: 'Reset Session' },
  { legacyKey: 'createWorkspace', registryKey: 'createWorkspace', surfaceText: 'Create Workspace' },
  { legacyKey: 'copySettings', registryKey: 'copySettings', surfaceText: 'Copy Settings' },
  { legacyKey: 'closeOut', registryKey: 'closeOut', surfaceText: 'Close Out' },
  { legacyKey: 'beads', registryKey: 'beads', surfaceText: 'Tasks' },
  { legacyKey: 'inference', registryKey: 'inference', surfaceText: 'Inference' },
  { legacyKey: 'discussions', registryKey: 'discussions', surfaceText: 'Discussions' },
  { legacyKey: 'transcripts', registryKey: 'transcripts', surfaceText: 'Transcripts' },
  { legacyKey: 'upload', registryKey: 'upload', surfaceText: 'Upload' },
  { legacyKey: 'syncDiscussions', registryKey: 'syncDiscussions', surfaceText: 'Sync' },
  { legacyKey: 'syncMain', registryKey: 'syncMain', surfaceText: 'Sync main' },
  { legacyKey: 'statusReview', registryKey: 'statusReview', surfaceText: 'Status' },
  { legacyKey: 'reopen', registryKey: 'reopen', surfaceText: 'Reopen' },
  { legacyKey: 'restartAgent', registryKey: 'restartAgent', surfaceText: 'Restart agent' },
  { legacyKey: 'restartFromPlan', registryKey: 'restartFromPlan', surfaceText: 'Restart from plan' },
  { legacyKey: 'resetIssue', registryKey: 'resetIssue', surfaceText: 'Reset issue' },
  { legacyKey: 'cancel', registryKey: 'cancel', surfaceText: 'Cancel Issue' },
] as const satisfies readonly { legacyKey: string; registryKey: IssueActionKey | null; surfaceText: string; note?: string }[];

const commandDeckGapActions = [
  'untroubled',
  'inspectBead',
  'open',
] as const satisfies readonly IssueActionKey[];

const badgeBarActions = [
  { surfaceText: 'Tasks', registryKey: 'beads' },
  { surfaceText: 'Status', registryKey: 'statusReview' },
  { surfaceText: 'Inference', registryKey: 'inference' },
  { surfaceText: 'Discussions', registryKey: 'discussions' },
  { surfaceText: 'Transcripts', registryKey: 'transcripts' },
  { surfaceText: 'Upload', registryKey: 'upload' },
  { surfaceText: 'Sync', registryKey: 'syncDiscussions' },
] as const satisfies readonly { surfaceText: string; registryKey: IssueActionKey }[];

const statusFlowActions = [
  { surfaceText: 'MERGE', registryKey: null, note: 'Human-only MergeButton remains outside ISSUE_ACTIONS per Decision D6.' },
  { surfaceText: 'Review & Test', registryKey: 'reviewTest' },
  { surfaceText: 'Recover', registryKey: 'recoverReview' },
  { surfaceText: 'Stop Agent', registryKey: 'stopAgent' },
  { surfaceText: 'Start Agent', registryKey: 'startAgent' },
  { surfaceText: 'Resume Session', registryKey: 'resumeSession' },
  { surfaceText: 'Reset Session', registryKey: 'resetSession' },
  { surfaceText: 'Create Workspace', registryKey: 'createWorkspace' },
  { surfaceText: 'Reopen', registryKey: 'reopen' },
] as const satisfies readonly { surfaceText: string; registryKey: IssueActionKey | null; note?: string }[];

const projectTreeUtilityActions = [
  { surfaceText: 'Copy project name', scope: 'project', ownerSurface: 'ProjectNode' },
  { surfaceText: 'View Logs', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Inspect', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Restart', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Stop', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Start', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Open State Dir', scope: 'session-artifact', ownerSurface: 'FeatureItem' },
  { surfaceText: 'View JSONL', scope: 'session-artifact', ownerSurface: 'FeatureItem' },
  { surfaceText: 'Deep Wipe', scope: 'agent-state', ownerSurface: 'FeatureItem' },
] as const;

const zoneBSessionActions = [
  { key: 'stopSession', surfaceText: 'Stop session' },
  { key: 'viewTerminal', surfaceText: 'View terminal' },
  { key: 'viewState', surfaceText: 'View State.md' },
  { key: 'viewVbrief', surfaceText: 'View vBRIEF' },
  { key: 'copySessionId', surfaceText: 'Copy Session ID' },
  { key: 'copyTmuxCommand', surfaceText: 'Copy tmux command' },
] as const;

function renderMenuLabels(entries: typeof legacyCommandDeckIssueActions) {
  const menu = document.createElement('div');
  for (const entry of entries) {
    if (!entry.registryKey) continue;
    const action = registryByKey.get(entry.registryKey);
    if (!action) continue;
    const button = document.createElement('button');
    button.textContent = action.label;
    button.dataset.actionKey = action.key;
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  return menu;
}

describe('issueActions no-actions-lost audit', () => {
  it('maps every pre-reconciliation issue-scoped Command Deck action to the registry or a documented human-only exclusion', () => {
    for (const entry of legacyCommandDeckIssueActions) {
      if (entry.registryKey === null) {
        expect(entry.note, entry.legacyKey).toContain('Human-only');
      } else {
        expect(registryKeys.has(entry.registryKey), entry.legacyKey).toBe(true);
      }
    }
  });

  it('keeps the Command Deck gap actions in the registry', () => {
    for (const key of commandDeckGapActions) {
      expect(registryKeys.has(key), key).toBe(true);
    }
  });

  it('keeps BadgeBar artifact actions in the registry', () => {
    for (const { registryKey } of badgeBarActions) {
      expect(registryKeys.has(registryKey), registryKey).toBe(true);
    }
  });

  it('keeps WorkspaceStatusOverview and StatusFlowControl actions covered', () => {
    for (const action of statusFlowActions) {
      if (action.registryKey === null) {
        expect(action.note, action.surfaceText).toContain('Human-only');
      } else {
        expect(registryKeys.has(action.registryKey), action.surfaceText).toBe(true);
      }
    }
  });

  it('documents retained project-tree utility actions as non-issue-scoped surfaces', () => {
    for (const action of projectTreeUtilityActions) {
      expect(action.scope, action.surfaceText).not.toBe('issue');
      expect(action.ownerSurface, action.surfaceText).toMatch(/ProjectNode|ContainerNode|FeatureItem/);
    }
  });

  it('documents Zone B session-scoped actions outside the issue action registry', () => {
    for (const action of zoneBSessionActions) {
      expect(registryKeys.has(action.key as IssueActionKey), action.surfaceText).toBe(false);
    }
  });

  it('has menu-renderable labels for every registry-covered legacy issue action', () => {
    const menu = renderMenuLabels(legacyCommandDeckIssueActions);

    try {
      for (const { registryKey } of legacyCommandDeckIssueActions) {
        if (!registryKey) continue;
        const action = registryByKey.get(registryKey);
        expect(action?.label.trim(), registryKey).not.toBe('');
        expect(menu.textContent, registryKey).toContain(action?.label);
      }
    } finally {
      menu.remove();
    }
  });
});
