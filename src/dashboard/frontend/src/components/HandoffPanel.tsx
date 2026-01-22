import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, TrendingUp, AlertCircle } from 'lucide-react';
import { useHandoffSuggestion } from '../hooks/useHandoffData';

interface HandoffPanelProps {
  agentId: string;
}

async function executeHandoff(agentId: string, toModel: string, reason?: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toModel, reason }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to execute handoff');
  }
}

const MODEL_COLORS = {
  opus: 'text-purple-400 bg-purple-900/20 border-purple-500/30',
  sonnet: 'text-blue-400 bg-blue-900/20 border-blue-500/30',
  haiku: 'text-green-400 bg-green-900/20 border-green-500/30',
};

export function HandoffPanel({ agentId }: HandoffPanelProps) {
  const { data: suggestion, isLoading } = useHandoffSuggestion(agentId);
  const queryClient = useQueryClient();

  const handoffMutation = useMutation({
    mutationFn: ({ toModel, reason }: { toModel: string; reason?: string }) =>
      executeHandoff(agentId, toModel, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['handoff-suggestion', agentId] });
      alert('Handoff completed successfully');
    },
    onError: (error: Error) => {
      alert(`Handoff failed: ${error.message}`);
    },
  });

  const handleHandoff = (toModel: string) => {
    if (confirm(`Hand off ${agentId} to ${toModel}?`)) {
      handoffMutation.mutate({ toModel, reason: 'Manual handoff from dashboard' });
    }
  };

  const handleAutoHandoff = () => {
    if (!suggestion?.suggestedModel) return;
    if (confirm(`${suggestion.reason}\n\nProceed with handoff to ${suggestion.suggestedModel}?`)) {
      handoffMutation.mutate({
        toModel: suggestion.suggestedModel,
        reason: suggestion.reason,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-3 bg-gray-800 rounded border border-gray-700">
        <div className="text-sm text-gray-400">Loading handoff data...</div>
      </div>
    );
  }

  if (!suggestion) return null;

  return (
    <div className="p-3 bg-gray-800 rounded border border-gray-700 space-y-3">
      {/* Current Model Badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Current Model:</span>
        <span
          className={`px-2 py-1 text-xs font-medium rounded border ${
            MODEL_COLORS[suggestion.currentModel as keyof typeof MODEL_COLORS] ||
            'text-gray-400 bg-gray-700 border-gray-600'
          }`}
        >
          {suggestion.currentModel}
        </span>
      </div>

      {/* Handoff Suggestion */}
      {suggestion.suggested && suggestion.suggestedModel && (
        <div className="flex items-start gap-2 p-2 bg-orange-900/20 border border-orange-500/30 rounded">
          <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-orange-400 mb-1">
              Handoff Suggested
            </div>
            <div className="text-xs text-gray-300 mb-2">{suggestion.reason}</div>
            <button
              onClick={handleAutoHandoff}
              disabled={handoffMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-500 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-3 h-3" />
              Hand off to {suggestion.suggestedModel}
            </button>
          </div>
        </div>
      )}

      {/* Manual Handoff Controls */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Manual Handoff:</div>
        <div className="flex gap-2">
          <button
            onClick={() => handleHandoff('haiku')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'haiku'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-500/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Haiku
          </button>
          <button
            onClick={() => handleHandoff('sonnet')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'sonnet'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sonnet
          </button>
          <button
            onClick={() => handleHandoff('opus')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'opus'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-purple-400 bg-purple-900/20 hover:bg-purple-900/40 border border-purple-500/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Opus
          </button>
        </div>
      </div>
    </div>
  );
}
