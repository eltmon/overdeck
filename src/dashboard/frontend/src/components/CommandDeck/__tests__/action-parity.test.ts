import { describe, expect, it } from 'vitest';

import { ISSUE_ACTIONS, type IssueActionKey } from '../../../lib/issueActions';

const issueActionKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));

const legacyIssueActionMap: Record<string, IssueActionKey | null> = {
  'Review & Test': 'reviewTest',
  Recover: 'recoverReview',
  'Stop agent': 'stopAgent',
  'Start agent': 'startAgent',
  'Create workspace': 'createWorkspace',
  Merge: null,
  'Close Out': 'closeOut',
  Reopen: 'reopen',
  Cancel: 'cancel',
  'Resume session': 'resumeSession',
  'Reset session': 'resetSession',
  'Restart agent': 'restartAgent',
  'Restart from plan': 'restartFromPlan',
  'Reset issue': 'resetIssue',
  Beads: 'beads',
  Transcripts: 'transcripts',
  Discussions: 'discussions',
  Upload: 'upload',
  Inference: 'inference',
  'Sync discussions': 'syncDiscussions',
  'Sync main': 'syncMain',
  'Status review': 'statusReview',
  'Copy settings': 'copySettings',
  Open: 'open',
  'Inspect bead': 'inspectBead',
  Untroubled: 'untroubled',
};

const nonIssueScopedActionLabels = [
  'Merge',
  'Stop session',
  'View terminal',
  'View State.md',
  'View vBRIEF',
  'Copy Session ID',
  'Copy tmux command',
] as const;

describe('Command Deck action parity', () => {
  it.each(Object.entries(legacyIssueActionMap))(
    'legacy issue action "%s" maps to registry key "%s"',
    (_legacyLabel, actionKey) => {
      if (actionKey === null) return;
      expect(issueActionKeys.has(actionKey)).toBe(true);
    },
  );

  it('documents non-issue-scoped actions that stay outside ISSUE_ACTIONS', () => {
    expect(nonIssueScopedActionLabels).toContain('Merge');
    expect(nonIssueScopedActionLabels).toContain('Stop session');
  });
});
