/**
 * AgentOutputPanel - Shows live XTerminal for running agents/specialists.
 *
 * For all tmux sessions (agents and specialists), renders the XTerminal
 * WebSocket-based terminal view. For specialists with dead sessions,
 * falls back to showing the latest run log.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { XTerminal } from './XTerminal';
import { FileText, Terminal } from 'lucide-react';

interface AgentOutputPanelProps {
  agentId: string;
}

// Parse specialist tmux session name: specialist-{projectKey}-{type}
function parseSpecialistSession(agentId: string): { projectKey: string; type: string } | null {
  const match = agentId.match(/^specialist-(.+)-(review-agent|test-agent|merge-agent)$/);
  if (!match) return null;
  return { projectKey: match[1], type: match[2] };
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const specialist = parseSpecialistSession(agentId);
  const [terminalFailed, setTerminalFailed] = useState(false);

  // Fetch latest log for specialist agents (fallback when terminal disconnects)
  const { data: logData } = useQuery({
    queryKey: ['specialist-log', specialist?.projectKey, specialist?.type],
    queryFn: async () => {
      if (!specialist) return null;
      const res = await fetch(`/api/specialists/${specialist.projectKey}/${specialist.type}/latest-log`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!specialist && terminalFailed,
    staleTime: 10000,
  });

  // Reset terminal failure state when agent changes
  const [prevAgent, setPrevAgent] = useState(agentId);
  if (agentId !== prevAgent) {
    setPrevAgent(agentId);
    setTerminalFailed(false);
  }

  // Show log fallback for specialists when terminal has no session
  if (specialist && terminalFailed && logData?.log) {
    return (
      <div className="bg-surface-raised rounded-lg h-full flex flex-col">
        <div className="px-4 py-3 border-b border-divider flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-400" />
          <span className="font-medium text-content text-sm">{agentId}</span>
          {logData?.file && (
            <span className="text-xs text-content-muted ml-auto">
              {logData.file} ({logData.totalRuns} total runs)
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs text-content-body font-mono whitespace-pre-wrap leading-relaxed">
            {logData.log}
          </pre>
        </div>
      </div>
    );
  }

  // Live XTerminal for all sessions (agents and specialists)
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center gap-2 shrink-0 bg-surface-raised">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="font-medium text-content text-sm">{agentId}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <XTerminal sessionName={agentId} onDisconnect={() => setTerminalFailed(true)} />
      </div>
    </div>
  );
}
