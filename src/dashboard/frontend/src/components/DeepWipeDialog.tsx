import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle2, Loader2, Circle, AlertCircle, Trash2, Skull, FolderX, GitBranch, RotateCcw, ShieldOff } from 'lucide-react';
import { Issue } from '../types';

interface DeepWipeProgress {
  step: number;
  total: number;
  label: string;
  detail: string;
  status: 'active' | 'complete' | 'error';
}

type WipeState = 'idle' | 'wiping' | 'complete' | 'error';

interface DeepWipeDialogProps {
  issue: Issue;
  isOpen: boolean;
  onClose: () => void;
}

const STEP_ICONS = [Skull, FolderX, GitBranch, RotateCcw, ShieldOff];
const STEP_LABELS = [
  'Tearing down workspace',
  'Deleting git branches',
  'Resetting issue status',
  'Clearing review status',
];

function StepRow({ stepNum, event }: { stepNum: number; event?: DeepWipeProgress }) {
  const Icon = STEP_ICONS[stepNum - 1] || Circle;
  const defaultLabel = STEP_LABELS[stepNum - 1] || `Step ${stepNum}`;

  const isActive = event?.status === 'active';
  const isComplete = event?.status === 'complete';
  const isError = event?.status === 'error';
  const isPending = !event;

  return (
    <div className={`flex items-start gap-4 transition-opacity duration-300 ${isPending ? 'opacity-35' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 transition-colors duration-300 ${
        isComplete ? 'badge-bg-destructive' :
        isActive ? 'badge-bg-warning' :
        isError ? 'bg-destructive/20' :
        'border border-divider'
      }`}>
        {isComplete && <CheckCircle2 className="w-4 h-4 text-destructive" />}
        {isActive && <Loader2 className="w-4 h-4 text-warning animate-spin" />}
        {isError && <AlertCircle className="w-4 h-4 text-destructive" />}
        {isPending && <Circle className="w-4 h-4 text-content-muted" />}
      </div>
      <div className="flex-1 py-1">
        <p className={`text-sm font-medium transition-colors duration-300 ${
          isComplete ? 'text-destructive' :
          isActive ? 'text-content' :
          isError ? 'text-destructive' :
          'text-content-muted'
        }`}>
          {event?.label || defaultLabel}
        </p>
        {event?.detail && (
          <p className={`text-xs mt-0.5 font-mono ${
            isError ? 'text-destructive/80' : 'text-content-muted'
          }`}>
            {event.detail}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 mt-1.5">
        <Icon className={`w-4 h-4 ${
          isComplete ? 'text-destructive/50' :
          isActive ? 'text-warning/50' :
          isError ? 'text-destructive/50' :
          'text-content-muted/30'
        }`} />
      </div>
    </div>
  );
}

export function DeepWipeDialog({ issue, isOpen, onClose }: DeepWipeDialogProps) {
  const [state, setState] = useState<WipeState>('idle');
  const [steps, setSteps] = useState<DeepWipeProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const totalSteps = STEP_LABELS.length;
  const completedCount = steps.filter(s => s.status === 'complete').length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  const stepMap = new Map<number, DeepWipeProgress>();
  for (const s of steps) {
    stepMap.set(s.step, s);
  }

  const handleWipe = useCallback(async () => {
    setState('wiping');
    setSteps([]);
    setError(null);

    try {
      const res = await fetch(`/api/issues/${issue.identifier}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Reset failed');
        setState('error');
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response stream');
        setState('error');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'progress') {
              setSteps(prev => {
                const existing = prev.findIndex(s => s.step === event.step && s.label === event.label);
                const updated = [...prev];
                const progressEvent: DeepWipeProgress = {
                  step: event.step,
                  total: event.total,
                  label: event.label,
                  detail: event.detail,
                  status: event.status,
                };
                if (existing >= 0) {
                  updated[existing] = progressEvent;
                } else {
                  updated.push(progressEvent);
                }
                return updated;
              });
            } else if (event.type === 'complete') {
              setState('complete');
              queryClient.invalidateQueries({ queryKey: ['issues'] });
              queryClient.invalidateQueries({ queryKey: ['agents'] });
            } else if (event.type === 'error') {
              setError(event.error || 'Reset failed');
              setState('error');
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setState('error');
    }
  }, [issue.identifier, queryClient]);

  const handleClose = () => {
    setState('idle');
    setSteps([]);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={state === 'wiping' ? undefined : handleClose} />

      <div className="relative w-full max-w-lg bg-surface-raised rounded-xl shadow-2xl border border-divider overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500/30 to-orange-500/30 flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-content">Reset Issue: {issue.identifier}</h2>
              <p className="text-sm text-content-subtle line-clamp-1">{issue.title}</p>
            </div>
          </div>
          {state !== 'wiping' && (
            <button
              onClick={handleClose}
              className="p-2 text-content-subtle hover:text-content hover:bg-surface-overlay rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {state === 'idle' && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full badge-bg-destructive flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <p className="text-sm text-content-body mb-2">This will <span className="text-destructive font-medium">permanently destroy</span>:</p>
              <ul className="text-sm text-content-subtle space-y-1 mb-6">
                <li>All running agents for this issue</li>
                <li>Workspace directory and all files</li>
                <li>Local and remote feature branches</li>
                <li>Agent state and review status</li>
              </ul>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleWipe}
                  className="flex items-center gap-2 px-4 py-2 bg-destructive hover:bg-destructive/90 text-white rounded-lg transition-colors font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Reset Issue
                </button>
              </div>
            </div>
          )}

          {(state === 'wiping' || state === 'complete' || state === 'error') && (
            <>
              {/* Step timeline */}
              <div className="space-y-4 mb-6">
                {STEP_LABELS.map((_, i) => (
                  <StepRow
                    key={i + 1}
                    stepNum={i + 1}
                    event={stepMap.get(i + 1)}
                  />
                ))}
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-content-muted mb-2">
                  <span>{state === 'complete' ? 'Complete' : `Step ${Math.min(completedCount + 1, totalSteps)} of ${totalSteps}`}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      state === 'complete' ? 'bg-destructive' : 'bg-gradient-to-r from-destructive to-warning'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="badge-bg-destructive border badge-border-destructive rounded-lg p-3 mb-4">
                  <p className="text-xs text-destructive font-mono">{error}</p>
                </div>
              )}

              {/* Complete state */}
              {state === 'complete' && (
                <div className="text-center">
                  <p className="text-sm text-destructive font-medium mb-3">
                    {issue.identifier} has been reset to Todo.
                  </p>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
