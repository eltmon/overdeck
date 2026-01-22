import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Brain, RotateCcw, Power, Square, Loader2 } from 'lucide-react';

export interface SpecialistAgent {
  name: 'merge-agent' | 'review-agent' | 'test-agent';
  displayName: string;
  description: string;
  enabled: boolean;
  autoWake: boolean;
  sessionId?: string;
  lastWake?: string;
  contextTokens?: number;
  state: 'sleeping' | 'active' | 'uninitialized';
  isRunning: boolean;
  tmuxSession: string;
}

interface SpecialistAgentCardProps {
  specialist: SpecialistAgent;
  onSelect?: () => void;
  isSelected?: boolean;
}

const STATE_EMOJI = {
  sleeping: '😴',
  active: '🟢',
  uninitialized: '⚪',
};

const STATE_LABEL = {
  sleeping: 'Sleeping',
  active: 'Active',
  uninitialized: 'Not Initialized',
};

const STATE_COLOR = {
  sleeping: 'text-blue-400',
  active: 'text-green-400',
  uninitialized: 'text-gray-500',
};

async function wakeSpecialist(name: string): Promise<void> {
  const res = await fetch(`/api/specialists/${name}/wake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to wake specialist');
  }
}

async function resetSpecialist(name: string): Promise<void> {
  const res = await fetch(`/api/specialists/${name}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reinitialize: false }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to reset specialist');
  }
}

async function killSpecialist(tmuxSession: string): Promise<void> {
  const res = await fetch(`/api/agents/${tmuxSession}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to kill specialist');
}

interface SpecialistCost {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

async function fetchSpecialistCost(name: string): Promise<SpecialistCost> {
  const res = await fetch(`/api/specialists/${name}/cost`);
  if (!res.ok) return { cost: 0, inputTokens: 0, outputTokens: 0 };
  return res.json();
}

function useSpecialistCost(name: string, enabled: boolean) {
  return useQuery({
    queryKey: ['specialist-cost', name],
    queryFn: () => fetchSpecialistCost(name),
    enabled,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatLastWake(timestamp: string | undefined): string {
  if (!timestamp) return 'Never';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'Just now';
  }
}

export function SpecialistAgentCard({
  specialist,
  onSelect,
  isSelected,
}: SpecialistAgentCardProps) {
  const queryClient = useQueryClient();
  const { data: costData } = useSpecialistCost(specialist.name, specialist.state !== 'uninitialized');

  const wakeMutation = useMutation({
    mutationFn: () => wakeSpecialist(specialist.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to wake ${specialist.displayName}: ${error.message}`);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetSpecialist(specialist.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
    },
    onError: (error: Error) => {
      alert(`Failed to reset ${specialist.displayName}: ${error.message}`);
    },
  });

  const killMutation = useMutation({
    mutationFn: () => killSpecialist(specialist.tmuxSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const handleWake = (e: React.MouseEvent) => {
    e.stopPropagation();
    wakeMutation.mutate();
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      confirm(
        `Reset ${specialist.displayName}? This will clear the session file and context.`
      )
    ) {
      resetMutation.mutate();
    }
  };

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Kill ${specialist.displayName}?`)) {
      killMutation.mutate();
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`p-4 cursor-pointer transition-colors ${
        isSelected ? 'bg-gray-700' : 'hover:bg-gray-750'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-purple-400" />
          <div>
            <div className="font-medium text-white flex items-center gap-2">
              {specialist.displayName}
              {specialist.state === 'active' ? (
                <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
              ) : (
                <span className={`text-xs ${STATE_COLOR[specialist.state]}`}>
                  {STATE_EMOJI[specialist.state]}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-400">{specialist.description}</div>
            {specialist.sessionId && (
              <div className="text-xs text-gray-500 font-mono mt-1">
                Session: {specialist.sessionId.slice(0, 8)}...
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm text-gray-400">
              {STATE_LABEL[specialist.state]}
            </div>
            {costData && costData.cost > 0 && (
              <div className="text-xs text-green-400 font-medium" title="Total cost">
                ${costData.cost.toFixed(4)}
              </div>
            )}
            {specialist.contextTokens && (
              <div className="text-xs text-gray-500">
                {formatTokens(specialist.contextTokens)} tokens
              </div>
            )}
            {specialist.lastWake && (
              <div className="text-xs text-gray-500">
                Last wake: {formatLastWake(specialist.lastWake)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Wake button - only for sleeping or uninitialized */}
            {(specialist.state === 'sleeping' || specialist.state === 'uninitialized') && (
              <button
                onClick={handleWake}
                disabled={wakeMutation.isPending || specialist.state === 'uninitialized'}
                className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  specialist.state === 'uninitialized'
                    ? 'Specialist not initialized - needs session ID'
                    : 'Wake specialist'
                }
              >
                <Power className="w-4 h-4" />
              </button>
            )}

            {/* Kill button - only for active */}
            {specialist.state === 'active' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"
                title="Kill specialist"
              >
                <Square className="w-4 h-4" />
              </button>
            )}

            {/* Reset button - only for sleeping or uninitialized */}
            {(specialist.state === 'sleeping' || specialist.state === 'uninitialized') && (
              <button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-gray-600 rounded"
                title="Reset specialist (clear session)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
