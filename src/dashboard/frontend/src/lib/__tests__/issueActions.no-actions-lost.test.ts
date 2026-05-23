import { describe, expect, it } from 'vitest';

import {
  ISSUE_ACTIONS,
  type IssueActionKey,
} from '../issueActions';
import {
  COMMAND_DECK_SURFACE_REGISTRY,
} from '../commandDeckSurfaceRegistry';
import {
  flattenActions,
  getZoneBActions,
  type ActionKey,
} from '../commandDeckActions';

const registryKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));
const registryByKey = new Map(ISSUE_ACTIONS.map((action) => [action.key, action]));

const legacyActionKeys = [
  'merge',
  'reviewTest',
  'recover',
  'stopAgent',
  'startAgent',
  'resumeSession',
  'resetSession',
  'createWorkspace',
  'copySettings',
  'closeOut',
  'beads',
  'inference',
  'discussions',
  'transcripts',
  'upload',
  'syncDiscussions',
  'syncMain',
  'statusReview',
  'reopen',
  'restartAgent',
  'restartFromPlan',
  'resetIssue',
  'cancel',
  'stopSession',
  'viewTerminal',
  'viewState',
  'viewVbrief',
  'copySessionId',
  'copyTmuxCommand',
] as const satisfies readonly ActionKey[];

const sessionScopedActionKeys = [
  'stopSession',
  'viewTerminal',
  'viewState',
  'viewVbrief',
  'copySessionId',
  'copyTmuxCommand',
] as const satisfies readonly ActionKey[];

type IssueActionCoverage = {
  legacyKey: ActionKey;
  registryKey: IssueActionKey | null;
  surfaceText: string;
  note?: string;
};

const legacyIssueActionCoverage = [
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
] as const satisfies readonly IssueActionCoverage[];

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

const projectTreeContextMenuActions = [
  { surfaceText: 'Copy project name', scope: 'project', ownerSurface: 'ProjectNode' },
  { surfaceText: 'View Logs', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Inspect', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Restart', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Stop', scope: 'container', ownerSurface: 'ContainerNode' },
  { surfaceText: 'Start', scope: 'container', ownerSurface: 'ContainerNode' },
] as const;

const zoneBSessionActions = [
  { key: 'stopSession', surfaceText: 'Stop session' },
  { key: 'viewTerminal', surfaceText: 'View terminal' },
  { key: 'viewState', surfaceText: 'View State.md' },
  { key: 'viewVbrief', surfaceText: 'View vBRIEF' },
  { key: 'copySessionId', surfaceText: 'Copy Session ID' },
  { key: 'copyTmuxCommand', surfaceText: 'Copy tmux command' },
] as const satisfies readonly { key: typeof sessionScopedActionKeys[number]; surfaceText: string }[];

function renderMenuLabels(entries: readonly IssueActionCoverage[]) {
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
  it('catalogues every ActionKey value from the existing Command Deck vocabulary', () => {
    expect(new Set(legacyActionKeys).size).toBe(legacyActionKeys.length);
    expect(new Set([...legacyIssueActionCoverage.map((entry) => entry.legacyKey), ...sessionScopedActionKeys])).toEqual(new Set(legacyActionKeys));
  });

  it('maps every existing issue-scoped Command Deck action to the new registry or a documented human-only exclusion', () => {
    for (const entry of legacyIssueActionCoverage) {
      if (entry.registryKey === null) {
        expect(entry.note, entry.legacyKey).toContain('Human-only');
      } else {
        expect(registryKeys.has(entry.registryKey), entry.legacyKey).toBe(true);
      }
    }
  });

  it('covers every currently registered dashboard surface action', () => {
    const coverageByLegacyKey = new Map(legacyIssueActionCoverage.map((entry) => [entry.legacyKey, entry]));

    for (const registration of COMMAND_DECK_SURFACE_REGISTRY) {
      const coverage = coverageByLegacyKey.get(registration.actionKey);
      expect(coverage, `${registration.surface}:${registration.source}`).toBeDefined();
      if (coverage?.registryKey) expect(registryKeys.has(coverage.registryKey), registration.actionKey).toBe(true);
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

  it('documents project-tree context menu actions as non-issue-scoped retained surfaces', () => {
    for (const action of projectTreeContextMenuActions) {
      expect(action.scope, action.surfaceText).not.toBe('issue');
      expect(action.ownerSurface, action.surfaceText).toMatch(/ProjectNode|ContainerNode/);
    }
  });

  it('keeps Zone B session-scoped actions on the existing Command Deck session surface', () => {
    const renderedZoneBKeys = new Set(flattenActions(getZoneBActions({ presence: 'active', type: 'work', hasTerminal: true })));

    for (const action of zoneBSessionActions) {
      expect(renderedZoneBKeys.has(action.key), action.surfaceText).toBe(true);
    }
  });

  it('has menu-renderable labels for every registry-covered legacy issue action', () => {
    const menu = renderMenuLabels(legacyIssueActionCoverage);

    try {
      for (const { registryKey } of legacyIssueActionCoverage) {
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
