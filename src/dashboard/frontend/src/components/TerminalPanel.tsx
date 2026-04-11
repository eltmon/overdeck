import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw, ExternalLink } from 'lucide-react';
import { Agent } from '../types';
import { XTerminal } from './XTerminal';

interface TerminalPanelProps {
  agent: Agent;
  onClose: () => void;
}

function popoutTerminal(sessionName: string, title: string): void {
  const bridge = window.panopticonBridge;
  if (bridge?.isDesktopApp()) {
    bridge.openTerminalWindow(sessionName, title);
    return;
  }
  // Browser: use window.open with named popup to re-focus existing window
  const name = `terminal-${sessionName}`;
  const features = 'width=900,height=650,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';
  const popup = window.open(`/terminal/${sessionName}?title=${encodeURIComponent(title)}`, name, features);
  if (popup) {
    popup.document.title = title;
  }
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

export function TerminalPanel({ agent, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
  });

  // Optimistic: show XTerminal until probe confirms dead (tmuxAlive === false, not undefined)
  const isStopped = tmuxAlive === false;

  // Only poll output for stopped agents — running agents use XTerminal WebSocket
  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agent.id],
    queryFn: () => fetchOutput(agent.id),
    enabled: isStopped,
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
          {isStopped ? 'Last output' : agent.id}
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
              onClick={() => popoutTerminal(agent.id, `agent-${agent.issueId ?? agent.id} · ${agent.issueId ?? agent.id}`)}
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
          <XTerminal sessionName={agent.id} />
        </div>
      )}
    </div>
  );
}
