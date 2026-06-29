import { AlertTriangle } from 'lucide-react';
import type { Issue } from '../../../types';

interface AgentWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  issue: Issue | null;
}

export function AgentWarningDialog({ isOpen, onClose, onConfirm, issue }: AgentWarningDialogProps) {
  if (!isOpen || !issue) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 badge-bg-warning rounded-lg">
            <AlertTriangle className="w-6 h-6 text-warning-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Active Agent Warning
            </h3>
            <p className="text-foreground text-sm mb-4">
              <strong>{issue.identifier}</strong> has an active agent working on it.
              Moving this issue may disrupt the agent's work.
            </p>
            <p className="text-muted-foreground text-xs mb-6">
              Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 bg-warning hover:bg-warning/90 text-foreground rounded-lg transition-colors text-sm"
              >
                Move Anyway
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
