import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, RefreshCw, Send, Loader2 } from 'lucide-react';
import { Agent } from '../types';

interface TerminalPanelProps {
  agent: Agent;
  onClose: () => void;
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

export function TerminalPanel({ agent, onClose }: TerminalPanelProps) {
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'logs' | 'status'>('logs');
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const startedAt = new Date(agent.startedAt);

  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agent.id],
    queryFn: () => fetchOutput(agent.id),
    refetchInterval: agent.status === 'stopped' ? false : 1000,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await fetch(`/api/agents/${agent.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error('Failed to send');
    },
    onSuccess: () => {
      setMessage('');
      setTimeout(() => refetch(), 500);
    },
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

  const handleSend = () => {
    if (message.trim()) sendMutation.mutate(message.trim());
  };

  const borderColor = '#232f48';
  const bgTerminal = '#0d1117';
  const textSecondary = '#92a4c9';

  return (
    <div
      className="flex flex-col h-full min-w-0"
      style={{ backgroundColor: bgTerminal }}
    >
      {/* Tab bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor, backgroundColor: '#161b26' }}
      >
        <div className="flex items-center gap-1">
          {(['logs', 'status'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1 text-xs rounded transition-colors font-medium ${
                activeTab === tab ? 'text-white' : 'hover:text-white'
              }`}
              style={activeTab === tab ? { backgroundColor: '#232f48', color: '#fff' } : { color: textSecondary }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 rounded transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
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
      {activeTab === 'logs' ? (
        <>
          <pre
            ref={terminalRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs leading-relaxed m-0 whitespace-pre text-gray-300"
            style={{ backgroundColor: bgTerminal }}
          >
            {output || (agent.status === 'stopped' ? 'No saved output available.' : 'Connecting to agent...')}
            <div ref={bottomRef} />
          </pre>

          {/* Chat input — only for running agents */}
          {agent.status !== 'stopped' && (
            <div
              className="p-2 border-t shrink-0"
              style={{ borderColor, backgroundColor: '#161b26' }}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Send message to agent..."
                  className="flex-1 px-3 py-2 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1"
                  style={{ backgroundColor: '#0d1117', borderColor, border: `1px solid ${borderColor}` }}
                />
                <button
                  onClick={handleSend}
                  disabled={!message.trim() || sendMutation.isPending}
                  className="px-3 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  style={{ backgroundColor: '#2769ec' }}
                >
                  {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ backgroundColor: '#0d1117' }}>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-white mb-2" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>Agent Summary</h3>
              <div className="text-xs space-y-1" style={{ color: textSecondary }}>
                <p><span className="text-gray-500">Issue:</span> <span className="text-white">{agent.issueId}</span></p>
                <p><span className="text-gray-500">Session:</span> <span className="font-mono text-[10px] text-white">{agent.id}</span></p>
                <p><span className="text-gray-500">Model:</span> <span className="text-white">{agent.model}</span></p>
                <p><span className="text-gray-500">Runtime:</span> <span className="text-white">{agent.runtime}</span></p>
                <p><span className="text-gray-500">Started:</span> <span className="text-white">{startedAt.toLocaleString()}</span></p>
                <p><span className="text-gray-500">Status:</span> <span className="text-green-400">{agent.status}</span></p>
                <p><span className="text-gray-500">Restarts:</span> <span className="text-white">{agent.killCount}</span></p>
              </div>
            </div>

            {agent.workspace && (
              <div>
                <h3 className="text-sm font-medium text-white mb-2" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>Workspace</h3>
                <p className="font-mono text-[10px] break-all" style={{ color: textSecondary }}>{agent.workspace}</p>
              </div>
            )}

            {agent.git && (
              <div>
                <h3 className="text-sm font-medium text-white mb-2" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>Git Status</h3>
                <div className="text-xs space-y-1" style={{ color: textSecondary }}>
                  <p><span className="text-gray-500">Branch:</span> <span className="font-mono text-white">{agent.git.branch}</span></p>
                  <p><span className="text-gray-500">Uncommitted:</span> <span className="text-white">{agent.git.uncommittedFiles} files</span></p>
                  <p><span className="text-gray-500">Latest:</span> <span className="text-white">{agent.git.latestCommit}</span></p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
