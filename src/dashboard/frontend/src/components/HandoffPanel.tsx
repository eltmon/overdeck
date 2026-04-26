import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { useHandoffSuggestion } from '../hooks/useHandoffData';
import { useConfirm, useAlert } from './DialogProvider';

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
  opus: 'text-signal-review badge-bg-secondary border-signal-review/30',
  sonnet: 'text-primary badge-bg-primary border-primary/30',
  haiku: 'text-success badge-bg-success border-success/30',
};

export function HandoffPanel({ agentId }: HandoffPanelProps) {
  const { data: suggestion, isLoading } = useHandoffSuggestion(agentId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();

  const handoffMutation = useMutation({
    mutationFn: ({ toModel, reason }: { toModel: string; reason?: string }) =>
      executeHandoff(agentId, toModel, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['handoff-suggestion', agentId] });
      showAlert({ message: 'Handoff completed successfully', variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Handoff failed: ${error.message}`, variant: 'error' });
    },
  });

  const handleHandoff = async (toModel: string) => {
    if (await confirm({ title: 'Confirm Handoff', message: `Hand off ${agentId} to ${toModel}?`, confirmLabel: 'Hand Off' })) {
      handoffMutation.mutate({ toModel, reason: 'Manual handoff from dashboard' });
    }
  };

  const handleAutoHandoff = async () => {
    if (!suggestion?.suggestedModel) return;
    if (await confirm({ title: 'Confirm Handoff', message: `${suggestion.reason}\n\nProceed with handoff to ${suggestion.suggestedModel}?`, confirmLabel: 'Hand Off' })) {
      handoffMutation.mutate({
        toModel: suggestion.suggestedModel,
        reason: suggestion.reason,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-3 bg-card rounded border border-border">
        <div className="text-sm text-muted-foreground">Loading handoff data...</div>
      </div>
    );
  }

  if (!suggestion) return null;

  return (
    <div className="p-3 bg-card rounded border border-border space-y-3">
      {/* Current Model Badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Current Model:</span>
        <span
          className={`px-2 py-1 text-xs font-medium rounded border ${
            MODEL_COLORS[suggestion.currentModel as keyof typeof MODEL_COLORS] ||
            'text-muted-foreground bg-popover border-border'
          }`}
        >
          {suggestion.currentModel}
        </span>
      </div>

      {/* Handoff Suggestion */}
      {suggestion.suggested && suggestion.suggestedModel && (
        <div className="flex items-start gap-2 p-2 badge-bg-warning border border-warning/30 rounded">
          <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-warning mb-1">
              Handoff Suggested
            </div>
            <div className="text-xs text-foreground mb-2">{suggestion.reason}</div>
            <button
              onClick={handleAutoHandoff}
              disabled={handoffMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-foreground bg-warning hover:bg-warning/90 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-3 h-3" />
              Hand off to {suggestion.suggestedModel}
            </button>
          </div>
        </div>
      )}

      {/* Manual Handoff Controls */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Manual Handoff:</div>
        <div className="flex gap-2">
          <button
            onClick={() => handleHandoff('haiku')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'haiku'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-success badge-bg-success hover:bg-success/20 border border-success/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Haiku
          </button>
          <button
            onClick={() => handleHandoff('sonnet')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'sonnet'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-primary badge-bg-primary hover:bg-primary/20 border border-primary/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sonnet
          </button>
          <button
            onClick={() => handleHandoff('opus')}
            disabled={handoffMutation.isPending || suggestion.currentModel === 'opus'}
            className="flex-1 px-2 py-1.5 text-xs font-medium text-signal-review badge-bg-secondary hover:bg-signal-review/20 border border-signal-review/30 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Opus
          </button>
        </div>
      </div>
    </div>
  );
}
