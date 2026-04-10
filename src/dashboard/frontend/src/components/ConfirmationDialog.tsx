/**
 * Confirmation Dialog Component
 *
 * Modal dialog for confirming destructive actions detected in agent tmux sessions.
 * Shows when agents request confirmation for operations like branch deletion.
 */

import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmationRequest {
  id: string;
  agentId: string;
  sessionName: string;
  action: string; // e.g., "delete branch feature/foo"
  details?: string;
  timestamp: string;
}

interface ConfirmationDialogProps {
  request: ConfirmationRequest | null;
  isOpen: boolean;
  onConfirm: () => void;
  onDeny: () => void;
  onClose: () => void;
}

export function ConfirmationDialog({
  request,
  isOpen,
  onConfirm,
  onDeny,
  onClose,
}: ConfirmationDialogProps) {
  if (!isOpen || !request) return null;

  return (
    // Overlay
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* Dialog */}
      <div className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h3 className="text-lg font-semibold text-content">Confirmation Required</h3>
          </div>
          <button
            onClick={onClose}
            className="text-content-subtle hover:text-content-body transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div>
            <p className="text-sm text-content-subtle mb-1">Agent:</p>
            <p className="text-base text-content font-medium">{request.agentId}</p>
          </div>

          <div>
            <p className="text-sm text-content-subtle mb-1">Action:</p>
            <p className="text-base text-content font-medium">{request.action}</p>
          </div>

          {request.details && (
            <div>
              <p className="text-sm text-content-subtle mb-1">Details:</p>
              <p className="text-sm text-content-body bg-surface/50 p-2 rounded border border-divider">
                {request.details}
              </p>
            </div>
          )}

          <div className="mt-4 p-3 badge-bg-warning border badge-border-warning rounded">
            <p className="text-sm text-warning-foreground">
              ⚠️ This action cannot be undone. Please confirm that you want to proceed.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-surface/30">
          <button
            onClick={onDeny}
            className="px-4 py-2 rounded text-sm bg-surface-overlay text-content-body hover:bg-surface-emphasis transition-colors"
          >
            Deny
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded text-sm bg-warning text-white hover:bg-warning/90 transition-colors font-medium"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
