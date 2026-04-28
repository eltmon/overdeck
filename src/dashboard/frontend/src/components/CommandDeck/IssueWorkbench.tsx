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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import {
  useCommandDeckSelection,
  selectSelectedSessionForIssue,
} from '../../lib/commandDeckSelection';
import type { Agent, Issue } from '../../types';
import type { OverviewTab } from './ZoneCOverview';
import { ZoneA } from './ZoneA';
import { ZoneB } from './ZoneB';
import { ZoneCConversation } from './ZoneCConversation';
import { ZoneCOverview } from './ZoneCOverview';
import { IssueComposer } from './IssueComposer';

interface IssueWorkbenchProps {
  issueId: string;
  title: string;
  sessions: readonly SessionNodeType[];
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
  /** Work agent for this issue — drives Zone A action strip. */
  agent?: Agent;
  /** Full issue record — forwarded to Zone A for status gating. */
  issue?: Issue;
}

export function IssueWorkbench({
  issueId,
  title,
  sessions,
  source,
  url,
  onOpenBeads,
  agent,
  issue,
}: IssueWorkbenchProps) {
  const selectedSessionId = useCommandDeckSelection(selectSelectedSessionForIssue(issueId));

  const selectedSession = useMemo<SessionNodeType | null>(() => {
    if (!selectedSessionId) return null;
    return sessions.find((s) => s.sessionId === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const isAgentSelected = !!selectedSession;

  const readTabFromUrl = useCallback((): OverviewTab => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    switch (fromUrl) {
      case 'overview':
      case 'activity':
      case 'costs':
      case 'prd':
      case 'state':
      case 'inference':
      case 'vbrief':
      case 'beads':
      case 'prdiff':
      case 'discussions':
        return fromUrl;
      default:
        return 'overview';
    }
  }, []);

  const [activeTab, setActiveTab] = useState<OverviewTab>(() => readTabFromUrl());

  useEffect(() => {
    if (selectedSessionId) return;
    const currentUrl = new URL(window.location.href);
    const nextTab = readTabFromUrl();
    setActiveTab(nextTab);
    if (!currentUrl.searchParams.has('tab')) {
      currentUrl.searchParams.set('tab', nextTab);
      window.history.replaceState(window.history.state, '', currentUrl);
    }
  }, [readTabFromUrl, selectedSessionId]);

  const handleSwitchTab = useCallback((tab: OverviewTab) => {
    setActiveTab(tab);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', tab);
    window.history.pushState(window.history.state, '', nextUrl);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (selectedSessionId) return;
      setActiveTab(readTabFromUrl());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [readTabFromUrl, selectedSessionId]);

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
        source={source}
        url={url}
        onOpenBeads={onOpenBeads}
        agent={agent}
        issue={issue}
        onSwitchTab={handleSwitchTab}
      />
      {isAgentSelected ? (
        <>
          <ZoneB session={selectedSession} issueId={issueId} />
          <ZoneCConversation session={selectedSession} issueId={issueId} />
        </>
      ) : (
        <>
          <ZoneCOverview
            issueId={issueId}
            activeTab={activeTab}
            onTabChange={handleSwitchTab}
          />
          <IssueComposer issueId={issueId} sessions={sessions} />
        </>
      )}
    </div>
  );
}
