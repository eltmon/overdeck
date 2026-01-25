import { useState } from 'react';
import { Users, CheckCircle, XCircle, Loader2, X, AlertCircle, ExternalLink } from 'lucide-react';
import { useConvoys, useConvoyStatus, useConvoyOutput, ConvoyState } from '../hooks/useConvoys';

interface ConvoyPanelProps {
  onClose: () => void;
}

function StatusIcon({ status }: { status: ConvoyState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'partial':
      return <AlertCircle className="w-4 h-4 text-yellow-400" />;
  }
}

function AgentStatusBadge({ status }: { status: string }) {
  const colors = {
    pending: 'bg-gray-900/50 text-gray-400',
    running: 'bg-blue-900/50 text-blue-400',
    completed: 'bg-green-900/50 text-green-400',
    failed: 'bg-red-900/50 text-red-400',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[status as keyof typeof colors] || colors.pending}`}>
      {status}
    </span>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatDuration(start: string, end?: string): string {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = Math.floor((endTime - startTime) / 1000);

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function ConvoyDetailView({ convoy }: { convoy: ConvoyState }) {
  const { data: outputs } = useConvoyOutput(convoy.id);

  return (
    <div className="border-t border-gray-700 p-4 bg-gray-900/50">
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-500">Template:</span>
          <span className="ml-2 text-white">{convoy.template}</span>
        </div>
        <div>
          <span className="text-gray-500">Duration:</span>
          <span className="ml-2 text-white">
            {formatDuration(convoy.startedAt, convoy.completedAt)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Output:</span>
          <a
            href={`file://${convoy.outputDir}`}
            className="ml-2 text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            {convoy.outputDir}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {convoy.context.prUrl && (
          <div>
            <span className="text-gray-500">PR:</span>
            <a
              href={convoy.context.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
            >
              View PR
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-white mb-2">Agents</h4>
        {convoy.agents.map((agent) => (
          <div key={agent.role} className="bg-gray-800 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusIcon status={agent.status as ConvoyState['status']} />
                <span className="font-medium text-white">{agent.role}</span>
                <span className="text-xs text-gray-500">({agent.subagent})</span>
              </div>
              <AgentStatusBadge status={agent.status} />
            </div>

            {agent.startedAt && (
              <div className="text-xs text-gray-500 mb-1">
                Started: {formatTime(agent.startedAt)}
                {agent.completedAt && ` • Completed: ${formatTime(agent.completedAt)}`}
              </div>
            )}

            {agent.status === 'running' && (
              <div className="text-xs text-gray-500">
                Tmux: <code className="text-gray-400">{agent.tmuxSession}</code>
              </div>
            )}

            {agent.status === 'completed' && outputs && outputs[agent.role] && (
              <div className="mt-2">
                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-400 hover:text-blue-300">
                    View output
                  </summary>
                  <pre className="mt-2 bg-gray-900 rounded p-2 text-gray-300 font-mono overflow-x-auto max-h-64 overflow-y-auto">
                    {outputs[agent.role].substring(0, 1000)}
                    {outputs[agent.role].length > 1000 && '\n... (truncated)'}
                  </pre>
                </details>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConvoyPanel({ onClose }: ConvoyPanelProps) {
  const { data: convoys, isLoading } = useConvoys();
  const [selectedConvoyId, setSelectedConvoyId] = useState<string | null>(null);
  const { data: selectedConvoy } = useConvoyStatus(selectedConvoyId || undefined);

  const displayConvoy = selectedConvoy || (selectedConvoyId && convoys?.find(c => c.id === selectedConvoyId));

  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-purple-400" />
          <h2 className="font-medium text-white">Convoys</h2>
          {convoys && convoys.length > 0 && (
            <span className="text-xs text-gray-500">({convoys.length})</span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !convoys || convoys.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Users className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No convoys yet</p>
            <p className="text-xs mt-1">Start a convoy to see it here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {convoys.map((convoy) => (
              <div key={convoy.id} className="p-3">
                <button
                  onClick={() => setSelectedConvoyId(selectedConvoyId === convoy.id ? null : convoy.id)}
                  className="w-full text-left"
                >
                  {/* Convoy header */}
                  <div className="flex items-center gap-2 mb-2">
                    <StatusIcon status={convoy.status} />
                    <code className="text-sm text-white font-mono flex-1 truncate">
                      {convoy.id}
                    </code>
                    <span className="text-xs text-gray-500">
                      {formatDuration(convoy.startedAt, convoy.completedAt)}
                    </span>
                  </div>

                  {/* Summary */}
                  <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
                    <span className="text-purple-400">{convoy.template}</span>
                    <span>•</span>
                    <span>
                      {convoy.agents.filter(a => a.status === 'completed').length}/{convoy.agents.length} agents
                    </span>
                    <span>•</span>
                    <span>{formatTime(convoy.startedAt)}</span>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        convoy.status === 'running'
                          ? 'bg-blue-900/50 text-blue-400'
                          : convoy.status === 'completed'
                          ? 'bg-green-900/50 text-green-400'
                          : convoy.status === 'failed'
                          ? 'bg-red-900/50 text-red-400'
                          : 'bg-yellow-900/50 text-yellow-400'
                      }`}
                    >
                      {convoy.status}
                    </span>
                  </div>
                </button>

                {/* Expanded details */}
                {selectedConvoyId === convoy.id && displayConvoy && (
                  <ConvoyDetailView convoy={displayConvoy} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
