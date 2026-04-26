/**
 * IssueWorkbench tests — verify selection arbitration (PAN-830, pan-11sr).
 *
 * Selection state lives in the sibling `useCommandDeckSelection` Zustand
 * slice. These tests drive the slice directly and assert that:
 *   - no selection (or null) → issue-selected mode (ZoneCOverview, no ZoneB)
 *   - selected sessionId not in `sessions` → issue-selected mode (defensive)
 *   - selected sessionId in `sessions` → agent-selected mode (ZoneB + ZoneC)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import { IssueWorkbench } from '../IssueWorkbench';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';

// Mock SessionPanel so we can detect the agent-selected branch without
// pulling its dependency tree into this test.
vi.mock('../SessionView/SessionPanel', () => ({
  SessionPanel: (props: any) => (
    <div data-testid="session-panel" data-session={props.session.sessionId} />
  ),
}));

vi.mock('../SessionView/IssueHeader', () => ({
  IssueHeader: (props: any) => (
    <div data-testid="issue-header" data-issue={props.issueId} />
  ),
}));

function makeSession(sessionId: string): SessionNodeType {
  return {
    type: 'work',
    role: undefined,
    sessionId,
    tmuxSession: sessionId,
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 60,
    status: 'running',
    presence: 'active',
  } as SessionNodeType;
}

const ISSUE = 'PAN-821';
const SESSION_ID = 'agent-pan-821';

describe('IssueWorkbench', () => {
  beforeEach(() => {
    act(() => {
      useCommandDeckSelection.getState().clearAll();
    });
  });

  it('renders issue-selected mode by default (no session selected)', () => {
    render(
      <IssueWorkbench
        issueId={ISSUE}
        title="Test issue"
        sessions={[makeSession(SESSION_ID)]}
      />,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'issue-selected');
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('zone-b')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
  });

  it('renders agent-selected mode when slice has a matching session', () => {
    act(() => {
      useCommandDeckSelection.getState().selectSession(ISSUE, SESSION_ID);
    });

    render(
      <IssueWorkbench
        issueId={ISSUE}
        title="Test issue"
        sessions={[makeSession(SESSION_ID)]}
      />,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'agent-selected');
    expect(screen.getByTestId('zone-b')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toHaveAttribute(
      'data-session',
      SESSION_ID,
    );
    expect(screen.queryByTestId('zone-c-overview')).not.toBeInTheDocument();
  });

  it('falls back to issue-selected when slice points at a missing session', () => {
    act(() => {
      useCommandDeckSelection.getState().selectSession(ISSUE, 'does-not-exist');
    });

    render(
      <IssueWorkbench
        issueId={ISSUE}
        title="Test issue"
        sessions={[makeSession(SESSION_ID)]}
      />,
    );

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toHaveAttribute('data-mode', 'issue-selected');
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('zone-b')).not.toBeInTheDocument();
  });
});
