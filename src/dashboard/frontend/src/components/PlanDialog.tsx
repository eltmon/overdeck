/**
 * PlanDialog - Simplified version without planning phase
 *
 * The planning phase has been removed (PAN-275).
 * This dialog now simply allows starting the work agent directly.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, AlertCircle, Play, List } from 'lucide-react';
import { Rnd } from 'react-rnd';
import { Issue } from '../types';
import { BeadsDialog } from './BeadsDialog';

interface PlanDialogProps {
  issue: Issue;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type Step = 'ready' | 'starting' | 'error';

export function PlanDialog({ issue, isOpen, onClose, onComplete }: PlanDialogProps) {
  const [step, setStep] = useState<Step>('ready');
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 }); // -1 means centered
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [showBeadsDialog, setShowBeadsDialog] = useState(false);

  const queryClient = useQueryClient();

  // Start agent mutation - spawns work agent and updates status to "In Progress"
  const startAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier, phase: 'implementation' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start agent');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      onComplete();
      onClose();
    },
    onError: (err: Error) => {
      setError(`Failed to start agent: ${err.message}`);
      setStep('error');
    },
  });

  // Reset state when dialog closes/opens
  useEffect(() => {
    if (!isOpen) {
      setStep('ready');
      setError(null);
      setMinimized(false);
    }
  }, [isOpen]);

  const handleStartWork = () => {
    setStep('starting');
    startAgentMutation.mutate();
  };

  if (!isOpen) return null;

  // Calculate centered position on first render
  const centeredX = position.x === -1 ? (window.innerWidth - size.width) / 2 : position.x;
  const centeredY = position.y === -1 ? (window.innerHeight - size.height) / 2 : position.y;

  // When minimized, only render the floating bar
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 bg-surface-raised rounded-lg shadow-2xl border border-divider px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-surface-overlay transition-colors"
        onClick={() => setMinimized(false)}
      >
        <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center">
          <Play className="w-3 h-3 text-content" />
        </div>
        <span className="text-sm text-content font-medium">Start Work: {issue.identifier}</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMinimized(true)} />

      {/* Dialog with Rnd for drag/resize */}
      <Rnd
        position={{ x: centeredX, y: centeredY }}
        size={size}
        onDragStop={(_e, d) => setPosition({ x: d.x, y: d.y })}
        onResizeStop={(_e, _direction, ref, _delta, pos) => {
          setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
          setPosition({ x: pos.x, y: pos.y });
        }}
        minWidth={500}
        minHeight={300}
        bounds="window"
        dragHandleClassName="drag-handle"
        enableResizing={{
          top: true,
          right: true,
          bottom: true,
          left: true,
          topRight: true,
          bottomRight: true,
          bottomLeft: true,
          topLeft: true,
        }}
      >
        <div className="w-full h-full bg-surface-raised rounded-xl shadow-2xl border border-divider overflow-hidden flex flex-col">
          {/* Header - drag handle */}
          <div className="drag-handle flex items-center justify-between px-6 py-4 border-b border-divider cursor-move">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center">
                <Play className="w-5 h-5 text-content" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-content">Start Work: {issue.identifier}</h2>
                <p className="text-sm text-content-subtle line-clamp-1">{issue.title}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMinimized(true)}
                className="p-2 text-content-subtle hover:text-content hover:bg-surface-overlay rounded-lg transition-colors"
                title="Minimize"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Ready step - start work */}
            {step === 'ready' && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-green-500/20 border border-blue-500/30 flex items-center justify-center mb-6">
                  <Play className="w-10 h-10 text-blue-400" />
                </div>

                <h3 className="text-xl font-semibold text-content mb-2">Ready to Start Work</h3>
                <p className="text-content-subtle text-center max-w-md mb-6">
                  This will create a workspace (if needed) and start an AI agent to implement the issue.
                  Make sure you have a PRD in docs/prds/active/ or a PRD draft.
                </p>

                <div className="bg-surface-overlay/50 rounded-lg p-4 mb-6 max-w-md w-full">
                  <h4 className="text-sm font-medium text-content-body mb-2">What happens:</h4>
                  <ul className="space-y-2 text-sm text-content-subtle">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      Issue moves to &quot;In Progress&quot;
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      Git worktree created for feature branch
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      Work agent starts implementation
                    </li>
                  </ul>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowBeadsDialog(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors"
                  >
                    <List className="w-5 h-5" />
                    View Tasks
                  </button>
                  <button
                    onClick={handleStartWork}
                    disabled={startAgentMutation.isPending}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-content rounded-lg transition-colors font-medium disabled:opacity-50"
                  >
                    <Play className="w-5 h-5" />
                    Start Work Agent
                  </button>
                </div>
              </div>
            )}

            {/* Starting step */}
            {step === 'starting' && (
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin mb-4" />
                <p className="text-content-body">Starting work agent...</p>
                <p className="text-sm text-content-muted mt-2">Creating workspace, spawning agent</p>
              </div>
            )}

            {/* Error step */}
            {step === 'error' && (
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                  <AlertCircle className="w-10 h-10 text-red-400" />
                </div>
                <h3 className="text-xl font-semibold text-content mb-2">Failed to Start</h3>
                <p className="text-red-400 text-center max-w-md mb-6">{error}</p>

                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-surface-overlay hover:bg-surface-emphasis text-content rounded-lg transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setStep('ready');
                      setError(null);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-content rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Rnd>

      {/* Beads Tasks Dialog */}
      <BeadsDialog
        issueId={issue.identifier}
        isOpen={showBeadsDialog}
        onClose={() => setShowBeadsDialog(false)}
      />
    </div>
  );
}
