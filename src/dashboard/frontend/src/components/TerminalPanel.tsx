import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw } from 'lucide-react';
import { Agent } from '../types';
import { XTerminal } from './XTerminal';
import type { ActiveSession } from './inspector/phase-utils';

interface TerminalPanelProps {
  agent?: Agent;
  /** Override session derived from the current pipeline phase. When set, the panel
   *  shows this session's terminal instead of the work agent's session. */
  activeSession?: ActiveSession | null;
  onClose: () => void;
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

export function TerminalPanel({ agent, activeSession, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // When an activeSession override is provided (specialist phase), skip the tmux-alive probe
  // and always show XTerminal. The tmux-alive check only applies to the work agent session.
  const agentId = agent?.id;
  const isSpecialistSession = !!activeSession && activeSession.sessionName !== agentId;

  // Check if agent's tmux session is alive via a lightweight probe.
  // The store status can be stale after server restarts, so verify with the server.
  // Default to showing XTerminal (optimistic) — switch to raw log only if probe confirms dead.
  const { data: tmuxAlive } = useQuery({
    queryKey: ['tmux-alive', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/tmux-alive`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.alive === true;
    },
    refetchInterval: 10000,
    // Skip the probe when no agent or when showing a specialist session
    enabled: !!agentId && !isSpecialistSession,
  });

  // Optimistic: show XTerminal until probe confirms dead (tmuxAlive === false, not undefined)
  // Specialist sessions always show XTerminal (they handle reconnect internally).
  const isStopped = !isSpecialistSession && tmuxAlive === false;

  // Only poll output for stopped agents — running agents use XTerminal WebSocket
  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agentId],
    queryFn: () => fetchOutput(agentId!),
    enabled: isStopped && !!agentId,
  });

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
          {isStopped ? 'Last output' : (activeSession?.label ?? agentId ?? '')}
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
        <pre
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs leading-relaxed m-0 whitespace-pre text-content"
          style={{ backgroundColor: bgTerminal }}
        >
          {output || 'No saved output available.'}
          <div ref={bottomRef} />
        </pre>
      ) : (
        <div className="flex-1 min-h-0">
          <XTerminal sessionName={activeSession?.sessionName ?? agentId ?? ''} />
        </div>
      )}
    </div>
  );
}
