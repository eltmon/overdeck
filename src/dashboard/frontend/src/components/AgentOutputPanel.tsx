/**
 * AgentOutputPanel - Activity/Terminal split view for agents and specialists.
 *
 * For specialists:
 *   - Running: shows live XTerminal (same as review agent in Image 1)
 *   - Down: shows ConversationPanel with JSONL (same as Command Deck in Image 2)
 *
 * For work agents: Activity shows the issue conversation, Terminal shows XTerminal.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { XTerminal } from './XTerminal';
import { ActivityView } from './CommandDeck/ActivityView';
import { ConversationPanel } from './chat/ConversationPanel';
import type { Conversation } from './CommandDeck/ConversationList';
import { useDashboardStore, selectAgentById } from '../lib/store';
import styles from './CommandDeck/styles/command-deck.module.css';

interface AgentOutputPanelProps {
  agentId: string;
}

// Parse specialist tmux session name: specialist-{projectKey}-{issueId}-{type}
function parseSpecialistSession(agentId: string): { projectKey: string; issueId: string; type: string } | null {
  const match = agentId.match(/^specialist-(.+)-([A-Z]+-\d+)-(review-agent|test-agent|merge-agent)$/);
  if (!match) return null;
  return { projectKey: match[1], issueId: match[2], type: match[3] };
}

// Derive issueId for role runs: agent-pan-505 → PAN-505, agent-pan-505-test → PAN-505.
export function deriveAgentIssueId(agentId: string, agentIssueId?: string): string | null {
  if (agentIssueId) return agentIssueId;
  const issuePattern = '((?:[a-z]+-\\d+|(?:f|us|de|ta|tc)\\d+))';
  const match = agentId.match(new RegExp(`^(?:agent|planning)-${issuePattern}(?:-(?:\\d+|plan|review|test|ship))?$`, 'i'));
  return match ? match[1]!.toUpperCase() : null;
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const [viewMode, setViewMode] = useState<'activity' | 'terminal'>('activity');

  const agent = useDashboardStore(selectAgentById(agentId));
  const specialist = parseSpecialistSession(agentId);
  const [_terminalFailed, setTerminalFailed] = useState(false);

  // Reset view mode when agent changes
  const [prevAgent, setPrevAgent] = useState(agentId);
  if (agentId !== prevAgent) {
    setPrevAgent(agentId);
    setViewMode('activity');
    setTerminalFailed(false);
  }

  // Fetch specialist runtime state
  const { data: specData } = useQuery({
    queryKey: ['specialist-panel-status', agentId],
    queryFn: async () => {
      if (!specialist) return null;
      const res = await fetch(`/api/specialists/${specialist.projectKey}/${specialist.issueId}/${specialist.type}/status`);
      if (!res.ok) return null;
      return res.json() as Promise<{ isRunning: boolean; sessionId?: string }>;
    },
    enabled: !!specialist,
    refetchInterval: 5000,
  });

  const specialistIsRunning = specData?.isRunning ?? false;

  // Build a Conversation object for specialists so ConversationPanel can fetch the JSONL
  const specialistConversation = useMemo<Conversation | null>(() => {
    if (!specialist) return null;
    return {
      id: 0,
      name: agentId,
      tmuxSession: agentId,
      status: specialistIsRunning ? 'active' : 'ended',
      cwd: '',
      issueId: null,
      createdAt: new Date().toISOString(),
      endedAt: specialistIsRunning ? null : new Date().toISOString(),
      lastAttachedAt: null,
      sessionAlive: specialistIsRunning,
      sessionFile: null, // Backend resolves this from the specialist .session file
    };
  }, [specialist, agentId, specialistIsRunning]);

  // Role runs are identified by the persisted role field; the planning- prefix is
  // retained only as a fallback for sessions missing from the dashboard store.
  const isPlanningAgent = agent?.role === 'plan' || (!agent && agentId.startsWith('planning-'));
  const roleRunIssueId = agent?.role === 'test' ? agent.issueId : undefined;
  const workAgentIssueId = specialist ? null : deriveAgentIssueId(agentId, roleRunIssueId ?? agent?.issueId);

  const label = specialist
    ? `${specialist.projectKey} / ${specialist.type.replace('-agent', '')}`
    : agentId;

  return (
    <div className="bg-card rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
        <span className="font-medium text-foreground text-sm flex-1 truncate">{label}</span>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === 'activity' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setViewMode('activity')}
          >
            Activity
          </button>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setViewMode('terminal')}
          >
            Terminal
          </button>
        </div>
      </div>

      {/* Activity view */}
      {viewMode === 'activity' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {specialist ? (
            specialistIsRunning ? (
              // Live specialist → show XTerminal
              <XTerminal
                sessionName={agentId}
                onDisconnect={() => setTerminalFailed(true)}
              />
            ) : specialistConversation ? (
              // Down specialist → show JSONL conversation (same as Command Deck)
              <ConversationPanel conversation={specialistConversation} agentId={agentId} />
            ) : null
          ) : workAgentIssueId ? (
            <ActivityView issueId={workAgentIssueId} />
          ) : isPlanningAgent ? (
            // Planning agent with non-derivable issueId → fall back to raw terminal
            <XTerminal sessionName={agentId} onDisconnect={() => setTerminalFailed(true)} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No issue associated with this session
            </div>
          )}
        </div>
      )}

      {/* Terminal view — always XTerminal */}
      {viewMode === 'terminal' && (
        <div className="flex-1 min-h-0">
          <XTerminal sessionName={agentId} />
        </div>
      )}
    </div>
  );
}
