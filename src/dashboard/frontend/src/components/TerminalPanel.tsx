import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw, Pin } from 'lucide-react';
import { Agent } from '../types';
import { XTerminal } from './XTerminal';
import type { ActiveSession } from './inspector/phase-utils';

interface TerminalPanelProps {
  agent?: Agent;
  /** Session derived from the current pipeline phase (auto-switches as phase changes). */
  activeSession?: ActiveSession | null;
  onClose: () => void;
}

interface TabDef {
  sessionName: string;
  label: string;
  isAuto: boolean;
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
  // null = auto mode; string = user-pinned session name
  const [pinnedSessionName, setPinnedSessionName] = useState<string | null>(null);

  const agentId = agent?.id;

  // Determine which session to actually display
  const displaySession = pinnedSessionName ?? activeSession?.sessionName ?? agentId ?? '';
  const isSpecialistSession = !!activeSession && activeSession.sessionName !== agentId && displaySession === activeSession.sessionName;

  // Build tab list. Show at most: Agent tab + active specialist tab (when phase is specialist).
  const tabs: TabDef[] = [];
  if (agentId) {
    tabs.push({
      sessionName: agentId,
      label: 'Agent',
      isAuto: !activeSession || activeSession.sessionName === agentId,
    });
  }
  if (activeSession && activeSession.sessionName !== agentId) {
    tabs.push({
      sessionName: activeSession.sessionName,
      label: activeSession.label,
      isAuto: true,
    });
  }

  const showTabs = tabs.length > 1;

  // Check if agent's tmux session is alive via a lightweight probe.
  // Only run when displaying the agent session (not a specialist).
  const { data: tmuxAlive } = useQuery({
    queryKey: ['tmux-alive', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/tmux-alive`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.alive === true;
    },
    refetchInterval: 10000,
    enabled: !!agentId && !isSpecialistSession,
  });

  // Specialist sessions always show XTerminal (reconnect is handled internally).
  const isStopped = !isSpecialistSession && tmuxAlive === false;

  // Only poll output for stopped agents — running agents use XTerminal WebSocket.
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

  const handleTabClick = (sessionName: string) => {
    if (pinnedSessionName === sessionName) {
      // Clicking the pinned tab again → resume auto mode
      setPinnedSessionName(null);
    } else {
      setPinnedSessionName(sessionName);
    }
  };

  const headerLabel = isStopped
    ? 'Last output'
    : (tabs.find(t => t.sessionName === displaySession)?.label ?? displaySession);

  const borderColor = '#232f48';
  const bgTerminal = '#0d1117';
  const textSecondary = '#92a4c9';

  return (
    <div
      className="flex flex-col h-full min-w-0"
      style={{ backgroundColor: bgTerminal }}
    >
      {/* Header with optional tab strip */}
      <div
        className="shrink-0 border-b"
        style={{ borderColor, backgroundColor: '#161b26' }}
      >
        {showTabs ? (
          <div className="flex items-center justify-between">
            {/* Tab strip */}
            <div className="flex items-center gap-0 min-w-0 overflow-x-auto">
              {tabs.map((tab) => {
                const isSelected = displaySession === tab.sessionName;
                const isPinned = pinnedSessionName === tab.sessionName;
                return (
                  <button
                    key={tab.sessionName}
                    onClick={() => handleTabClick(tab.sessionName)}
                    title={isPinned ? `${tab.label} (pinned — click to resume auto)` : tab.label}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'border-blue-400 text-white'
                        : 'border-transparent hover:border-white/20'
                    }`}
                    style={{ color: isSelected ? '#fff' : textSecondary }}
                  >
                    {tab.label}
                    {tab.isAuto && !pinnedSessionName && (
                      <span
                        className="text-[9px] px-1 py-0 rounded font-mono"
                        style={{ backgroundColor: '#1e3a5f', color: '#60a5fa' }}
                      >
                        auto
                      </span>
                    )}
                    {isPinned && (
                      <Pin className="w-2.5 h-2.5" style={{ color: '#60a5fa' }} />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Close button */}
            <div className="flex items-center gap-1 px-2 shrink-0">
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
        ) : (
          /* Simple header when only one session (no tabs needed) */
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs font-medium" style={{ color: textSecondary }}>
              {headerLabel}
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
        )}
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
          <XTerminal sessionName={displaySession} />
        </div>
      )}
    </div>
  );
}
