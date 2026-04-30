import { useState, useEffect, useRef } from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import { ModelSelect, useAvailableModels } from './shared/ModelPicker';
import { getFriendlyModelName } from './inspector/utils';

interface SwitchModelModalProps {
  currentModel: string;
  agentId: string;
  issueId: string;
  agentStatus: string;
  hasResumableSession: boolean;
  onClose: () => void;
  onSwitch: (model: string, message?: string) => void;
  isPending: boolean;
}

export function SwitchModelModal({
  currentModel,
  agentStatus,
  hasResumableSession,
  onClose,
  onSwitch,
  isPending,
}: SwitchModelModalProps) {
  const { groups } = useAvailableModels();
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [message, setMessage] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  const isRunning = agentStatus !== 'stopped';
  const isSameModel = selectedModel === currentModel;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-card rounded-lg shadow-xl border border-border w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Switch Model</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <div className="text-xs text-muted-foreground">
            Current: <span className="text-foreground font-medium">{getFriendlyModelName(currentModel)}</span>
          </div>

          <ModelSelect
            value={selectedModel}
            onChange={setSelectedModel}
            groups={groups}
            label="New model"
          />

          {isRunning && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2">
              The running agent will be stopped and restarted with the new model.
            </div>
          )}

          {hasResumableSession && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2">
              Cannot resume across models — the saved session will be cleared. The new agent starts fresh from STATE.md.
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Message for agent (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell the agent what to do, or leave empty to let it pick up from STATE.md"
              className="w-full px-2 py-1.5 text-xs bg-card border border-border rounded resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              rows={3}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSwitch(selectedModel, message || undefined)}
            disabled={isPending || isSameModel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            data-testid="switch-model-confirm"
          >
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {isPending ? 'Switching...' : 'Switch Model'}
          </button>
        </div>
      </div>
    </div>
  );
}
