/**
 * IssueWorkbench — three-zone Command Deck shell (PAN-830, pan-11sr).
 *
 * Reads the per-issue selection from `useCommandDeckSelection` and renders:
 *
 *   ┌───────────────────────────────────┐
 *   │ Zone A · IssueHeader (always)     │
 *   ├───────────────────────────────────┤
 *   │ Zone B · agent context strip      │ ← agent-selected mode only
 *   ├───────────────────────────────────┤
 *   │ Zone C · ConversationPanel    OR  │ ← agent-selected
 *   │ Zone C · Overview tabs            │ ← issue-selected
 *   └───────────────────────────────────┘
 *
 * Selection arbitration: when a `sessionId` is selected for the issue and a
 * matching `SessionNode` is in the project tree, render agent-selected.
 * Otherwise (`null` selection, missing session, or empty session list) render
 * issue-selected.
 */

import { useMemo } from 'react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import {
  useCommandDeckSelection,
  selectSelectedSessionForIssue,
} from '../../lib/commandDeckSelection';
import { ZoneA } from './ZoneA';
import { ZoneB } from './ZoneB';
import { ZoneCConversation } from './ZoneCConversation';
import { ZoneCOverview } from './ZoneCOverview';

interface IssueWorkbenchProps {
  issueId: string;
  title: string;
  sessions: readonly SessionNodeType[];
  cost?: number;
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
}

export function IssueWorkbench({
  issueId,
  title,
  sessions,
  cost,
  source,
  url,
  onOpenBeads,
}: IssueWorkbenchProps) {
  const selectedSessionId = useCommandDeckSelection(selectSelectedSessionForIssue(issueId));

  const selectedSession = useMemo<SessionNodeType | null>(() => {
    if (!selectedSessionId) return null;
    return sessions.find((s) => s.sessionId === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const isAgentSelected = !!selectedSession;

  return (
    <div
      data-testid="issue-workbench"
      data-mode={isAgentSelected ? 'agent-selected' : 'issue-selected'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <ZoneA
        issueId={issueId}
        title={title}
        cost={cost}
        source={source}
        url={url}
        onOpenBeads={onOpenBeads}
      />
      {isAgentSelected ? (
        <>
          <ZoneB session={selectedSession} />
          <ZoneCConversation session={selectedSession} issueId={issueId} />
        </>
      ) : (
        <ZoneCOverview issueId={issueId} />
      )}
    </div>
  );
}
