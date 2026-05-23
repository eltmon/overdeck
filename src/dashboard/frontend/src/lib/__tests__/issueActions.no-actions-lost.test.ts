import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { ZoneBActionStrip } from '../../components/CommandDeck/ZoneBActionStrip';
import {
  ISSUE_ACTIONS,
  PROJECT_TREE_CONTEXT_ACTIONS,
  ZONE_B_SESSION_ACTIONS,
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

const projectTreeUtilityActions = PROJECT_TREE_CONTEXT_ACTIONS;
const zoneBSessionActions = ZONE_B_SESSION_ACTIONS;

function renderZoneBActionStrip() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      DialogProvider,
      null,
      createElement(ZoneBActionStrip, {
        issueId: 'PAN-1331',
        onViewTerminal: () => undefined,
        session: {
          sessionId: 'agent-pan-1331',
          type: 'work',
          presence: 'active',
          tmuxSession: 'agent-pan-1331',
          hasJsonl: true,
          roundMetadata: { roundCount: 1 },
        } as any,
      }),
    ),
  ));
}

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

  it('keeps retained project-tree context-menu actions in the non-issue registry', () => {
    expect(projectTreeUtilityActions.map((action) => action.label)).toEqual(expect.arrayContaining([
      'Copy project name',
      'View Logs',
      'Inspect',
      'Restart',
      'Stop',
      'Start',
      'Open State Dir',
      'View JSONL',
      'Deep Wipe',
    ]));
    for (const action of projectTreeUtilityActions) {
      expect(action.scope, action.label).not.toBe('issue');
      expect(action.ownerSurface, action.label).toMatch(/ProjectNode|ContainerNode|FeatureItem/);
    }
  });

  it('renders Zone B session-scoped actions from their real surface', () => {
    renderZoneBActionStrip();

    expect(screen.getByTitle('Stop session')).toBeInTheDocument();
    expect(screen.getByTitle('View terminal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('zone-b-overflow'));
    for (const action of zoneBSessionActions.filter((entry) => !['stopSession', 'viewTerminal'].includes(entry.key))) {
      expect(screen.getByText(action.label), action.key).toBeInTheDocument();
      expect(registryKeys.has(action.key as IssueActionKey), action.label).toBe(false);
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
