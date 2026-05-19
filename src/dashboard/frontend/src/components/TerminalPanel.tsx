import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw, ExternalLink } from 'lucide-react';
import { Agent } from '../types';
import { TerminalSessionWrapper } from './TerminalSessionWrapper';
import { MessagesTimeline } from './chat/MessagesTimeline';
import type { ChatMessage } from './chat/chat-types';
import { ActivityView } from './CommandDeck/ActivityView';

interface TerminalPanelProps {
  agent: Agent;
  onClose: () => void;
  /** Override the tmux session to stream. Defaults to agent.id for back-compat. */
  sessionName?: string;
  /** Override the header title. Defaults to agent.id. */
  title?: string;
  /** Called when XTerminal exhausts reconnect attempts for this session. */
  onSessionEnded?: (sessionName: string) => void;
}

function popoutTerminal(sessionName: string, title: string): void {
  const bridge = window.panopticonBridge;
  if (bridge?.isDesktopApp?.()) {
    bridge.openTerminalWindow(sessionName, title);
    return;
  }

  const popupName = `terminal-${sessionName}`;
  const features = 'width=900,height=650,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';
  window.open(`/terminal/${sessionName}?title=${encodeURIComponent(title)}`, popupName, features);
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}


function derivePlanningIssueId(agent: Agent): string | undefined {
  if (agent.issueId) return agent.issueId;
  // planning-pan-503 → PAN-503
  const m = agent.id.match(/^planning-([a-z]+)-(\d+)$/i);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  return undefined;
}

function PlanningActivityPanel({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full min-w-0" style={{ backgroundColor: '#0d1117' }}>
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: '#232f48', backgroundColor: '#161b26' }}
      >
        <span className="text-xs font-medium" style={{ color: '#92a4c9' }}>{issueId}</span>
        <button onClick={onClose} className="p-1 rounded transition-colors hover:bg-white/10" style={{ color: '#92a4c9' }} title="Close terminal">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ActivityView issueId={issueId} />
      </div>
    </div>
  );
}

function TerminalPanelTerminal({ agent, onClose, sessionName: sessionNameProp, title: titleProp, onSessionEnded }: TerminalPanelProps) {
  const activeSession = sessionNameProp ?? agent.id;
  const displayTitle = titleProp ?? agent.id;
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Only probe the work agent's session liveness when we're actually viewing it.
  // Specialist sessions (sessionNameProp !== agent.id) stream their own tmux sessions
  // independently — keying isStopped off agent.id when a specialist tab is selected would
  // cause the work agent's fallback content to render in place of the specialist stream.
  const isViewingWorkAgent = !sessionNameProp || sessionNameProp === agent.id;

  // Check if agent's tmux session is alive via a lightweight probe.
  // The store status can be stale after server restarts, so verify with the server.
  // Default to showing XTerminal (optimistic) — switch to raw log only if probe confirms dead.
  const { data: tmuxAlive } = useQuery({
    queryKey: ['tmux-alive', agent.id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent.id}/tmux-alive`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.alive === true;
    },
    refetchInterval: 10000,
    enabled: isViewingWorkAgent,
  });

  // Optimistic: show XTerminal until probe confirms dead (tmuxAlive === false, not undefined).
  // Never true for specialist tabs — they manage their own session lifecycle via onSessionEnded.
  const isStopped = isViewingWorkAgent && tmuxAlive === false;

  // Only fetch for stopped agents — running agents use XTerminal WebSocket
  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agent.id],
    queryFn: () => fetchOutput(agent.id),
    enabled: isStopped,
  });

  const { data: conversationData } = useQuery({
    queryKey: ['agent-conversation', agent.id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent.id}/conversation`);
      if (!res.ok) return { messages: [] as ChatMessage[] };
      const data = await res.json();
      return { messages: (data.messages ?? []) as ChatMessage[] };
    },
    enabled: isStopped,
  });
  const conversationMessages = conversationData?.messages ?? [];

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [output, autoScroll]);

  const handleScroll = useCallback(() => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
    }
  }, []);

  const borderColor = '#232f48';
  const bgTerminal = '#0d1117';
  const textSecondary = '#92a4c9';

  return (
    <div
      className="flex flex-col h-full min-w-0"
      style={{ backgroundColor: bgTerminal }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor, backgroundColor: '#161b26' }}
      >
        <span className="text-xs font-medium" style={{ color: textSecondary }}>
          {isStopped ? (conversationMessages.length > 0 ? 'Conversation' : 'Last output') : displayTitle}
        </span>
        <div className="flex items-center gap-1">
          {isStopped && (
            <button
              onClick={() => refetch()}
              className="p-1 rounded transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {!isStopped && (
            <button
              onClick={() => popoutTerminal(activeSession, displayTitle)}
              className="p-1 rounded transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
              title="Pop out terminal"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            title="Close terminal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isStopped ? (
        conversationMessages.length > 0 ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <MessagesTimeline messages={conversationMessages} workLog={[]} streaming={false} />
          </div>
        ) : (
          <pre
            ref={terminalRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs leading-relaxed m-0 whitespace-pre text-foreground"
            style={{ backgroundColor: bgTerminal }}
          >
            {output || 'No saved output available.'}
            <div ref={bottomRef} />
          </pre>
        )
      ) : (
        <div className="flex-1 min-h-0">
          <TerminalSessionWrapper
            sessionName={activeSession}
            onSessionEnded={onSessionEnded ? () => onSessionEnded(activeSession) : undefined}
          />
        </div>
      )}
    </div>
  );
}

export function TerminalPanel(props: TerminalPanelProps) {
  const isPlanning = props.agent.agentPhase === 'planning' || props.agent.id.startsWith('planning-');
  const planningIssueId = isPlanning ? derivePlanningIssueId(props.agent) : undefined;
  if (planningIssueId) {
    return <PlanningActivityPanel issueId={planningIssueId} onClose={props.onClose} />;
  }
  return <TerminalPanelTerminal {...props} />;
}
