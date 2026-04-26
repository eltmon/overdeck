/**
 * IssueWorkbench — three-zone Command Deck shell (PAN-830, pan-11sr).
 *
 * Reads the per-issue selection from `useCommandDeckSelection` and renders:
 *
 *   ┌───────────────────────────────────┐
 *   │ Zone A · IssueHeader + actions    │ ← always
 *   ├───────────────────────────────────┤
 *   │ Zone B · agent context strip      │ ← agent-selected only
 *   ├───────────────────────────────────┤
 *   │ Zone C · ConversationPanel    OR  │ ← agent-selected
 *   │ Zone C · Overview tabs            │ ← issue-selected
 *   │       + composer placeholder      │ ← issue-selected (B4)
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
import type { Agent, Issue } from '../../types';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { OverviewTab } from './ZoneCOverview';
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
  /** Forwarded to ZoneCOverview → ActivityTab. */
  issues?: readonly Issue[];
  featureData?: ProjectFeature | null;
  /** Work agent for this issue — drives Zone A action strip. */
  agent?: Agent;
  /** Full issue record — forwarded to Zone A for status gating. */
  issue?: Issue;
}

function ComposerPlaceholder({ sessions }: { sessions: readonly SessionNodeType[] }) {
  const hasSessions = sessions.length > 0;
  return (
    <div
      data-testid="composer-placeholder"
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--mc-border, var(--border))',
        background: 'var(--mc-surface-2, color-mix(in srgb, var(--foreground) 3%, transparent))',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid var(--mc-border, var(--border))',
          background: 'var(--mc-surface, var(--background))',
          color: 'var(--mc-text-muted, var(--muted-foreground))',
          fontSize: 13,
          opacity: 0.7,
        }}
      >
        {hasSessions
          ? 'Select a session to chat'
          : 'No sessions — start an agent to begin'}
      </div>
    </div>
  );
}

export function IssueWorkbench({
  issueId,
  title,
  sessions,
  cost,
  source,
  url,
  onOpenBeads,
  issues,
  featureData,
  agent,
  issue,
}: IssueWorkbenchProps) {
  const selectedSessionId = useCommandDeckSelection(selectSelectedSessionForIssue(issueId));

  const selectedSession = useMemo<SessionNodeType | null>(() => {
    if (!selectedSessionId) return null;
    return sessions.find((s) => s.sessionId === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const isAgentSelected = !!selectedSession;

  const handleSwitchTab = (_tab: OverviewTab) => {
    // TODO: propagate to ZoneCOverview via ref or state lift if needed
    // For now the action strip's tab-switch buttons are visual only;
    // full wiring can land in a follow-up bead.
  };

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
        agent={agent}
        issue={issue}
        onSwitchTab={handleSwitchTab}
      />
      {isAgentSelected ? (
        <>
          <ZoneB session={selectedSession} />
          <ZoneCConversation session={selectedSession} issueId={issueId} />
        </>
      ) : (
        <>
          <ZoneCOverview issueId={issueId} issues={issues} featureData={featureData} />
          <ComposerPlaceholder sessions={sessions} />
        </>
      )}
    </div>
  );
}
