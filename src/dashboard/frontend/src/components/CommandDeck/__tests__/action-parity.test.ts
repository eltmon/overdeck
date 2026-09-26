import { describe, expect, it } from 'vitest';

import {
  ISSUE_ACTIONS,
  ZONE_B_SESSION_ACTIONS,
  type IssueActionKey,
  type NonIssueActionKey,
} from '../../../lib/issueActions';

const issueActionKeys = new Set(ISSUE_ACTIONS.map((action) => action.key));

const legacyIssueActionMap: Record<string, IssueActionKey | null> = {
  'Review & Test': 'requestReview',
  Recover: 'recoverAgent',
  'Stop agent': 'stopAgent',
  'Start agent': 'startAgent',
  'Create workspace': 'createWorkspace',
  Merge: null,
  'Close Out': 'closeOut',
  Reopen: 'reopen',
  Cancel: 'cancel',
  'Resume session': 'resumeSession',
  // PAN-4198 D6: Reset session, Complete work reset and Restart from plan are
  // options inside the one Restart agent… dialog.
  'Reset session': 'restartAgent',
  'Complete work reset': 'restartAgent',
  'Restart agent': 'restartAgent',
  'Restart from plan': 'restartAgent',
  Tasks: 'tasks',
  // PAN-4198 D6: Transcripts, Discussions, Upload, Inference, Sync discussions
  // and Copy settings left the registry. Their RETIREMENT_AUDIT rows in
  // issueActions.parity.test.tsx name each new home or drop reason.
  'Sync main': 'syncMain',
  Open: 'open',
};

const zoneBSessionActionKeys = [
  'stopSession',
  'viewTerminal',
  'pauseSession',
  'resumeFocusedSession',
  'restartSession',
  'replaySession',
  'openStateDir',
  'viewState',
  'viewFocusedXbrief',
  'copySessionId',
  'copyTmuxCommand',
  'viewJsonl',
  'exportSessionMetadata',
  'exportRoundHistory',
  'deepWipe',
] as const satisfies readonly NonIssueActionKey[];

describe('Command Deck action parity', () => {
  it.each(Object.entries(legacyIssueActionMap))(
    'legacy issue action "%s" maps to registry key "%s"',
    (_legacyLabel, actionKey) => {
      if (actionKey === null) return;
      expect(issueActionKeys.has(actionKey)).toBe(true);
    },
  );

  it('keeps every Zone B session action executable and outside ISSUE_ACTIONS', () => {
    expect(ZONE_B_SESSION_ACTIONS.map((action) => action.key)).toEqual(
      zoneBSessionActionKeys,
    );

    for (const action of ZONE_B_SESSION_ACTIONS) {
      expect(action.ownerSurface, action.key).toBe('ZoneBActionStrip');
      expect(action.scope, action.key).toBe('session');
      expect(issueActionKeys.has(action.key as IssueActionKey), action.key).toBe(false);
    }
  });
});
