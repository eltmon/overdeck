/**
 * AgentOutputPanel - Shows live XTerminal for running agents/specialists.
 *
 * Renders the XTerminal WebSocket-based terminal view. When the session ends
 * (specialist completes, agent stops), shows a clean "session ended" state
 * rather than attempting to display the raw log file.
 */

import { XTerminal } from './XTerminal';
import { Terminal } from 'lucide-react';
import { useState } from 'react';

interface AgentOutputPanelProps {
  agentId: string;
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const [terminalFailed, setTerminalFailed] = useState(false);

  // Reset terminal failure state when agent changes
  const [prevAgent, setPrevAgent] = useState(agentId);
  if (agentId !== prevAgent) {
    setPrevAgent(agentId);
    setTerminalFailed(false);
  }

  // Session ended — show clean placeholder instead of garbled raw log
  if (terminalFailed) {
    return (
      <div className="bg-surface-raised rounded-lg h-full flex flex-col">
        <div className="px-4 py-3 border-b border-divider flex items-center gap-2">
          <Terminal className="w-4 h-4 text-content-subtle" />
          <span className="font-medium text-content text-sm">{agentId}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-content-muted">Session ended</span>
        </div>
      </div>
    );
  }

  // Live XTerminal for all sessions (agents and specialists)
  return (
    <div className="bg-surface-raised rounded-lg h-full flex flex-col">
      <div className="px-4 py-3 border-b border-divider flex items-center gap-2">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="font-medium text-content text-sm">{agentId}</span>
      </div>
      <div className="flex-1 min-h-0">
        <XTerminal sessionName={agentId} onDisconnect={() => setTerminalFailed(true)} />
      </div>
    </div>
  );
}
