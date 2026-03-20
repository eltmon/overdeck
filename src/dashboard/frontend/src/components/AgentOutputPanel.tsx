/**
 * AgentOutputPanel - Shows live terminal for running agents, or run logs for completed specialists.
 *
 * For specialist tmux sessions (specialist-*-*-agent), checks if the session is dead
 * and falls back to showing the latest run log from the API.
 */

import { useQuery } from '@tanstack/react-query';
import { TerminalView } from './TerminalView';
import { FileText } from 'lucide-react';

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

  // Fetch latest log for specialist agents
  const { data: logData } = useQuery({
    queryKey: ['specialist-log', specialist?.projectKey, specialist?.type],
    queryFn: async () => {
      if (!specialist) return null;
      const res = await fetch(`/api/specialists/${specialist.projectKey}/${specialist.type}/latest-log`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!specialist,
    staleTime: 10000,
  });

  // For non-specialist agents, always show terminal
  if (!specialist) {
    return <TerminalView agentId={agentId} />;
  }

  // For specialists: show terminal if it has content, otherwise show log
  // The TerminalView will show "No output yet" for dead sessions,
  // so we show the log panel alongside/instead
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
        {logData?.log ? (
          <pre className="text-xs text-content-body font-mono whitespace-pre-wrap leading-relaxed">
            {logData.log}
          </pre>
        ) : (
          <div className="text-content-muted text-sm">No run logs available yet.</div>
        )}
      </div>
    </div>
  );
}
