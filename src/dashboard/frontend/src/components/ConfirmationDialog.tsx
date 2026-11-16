/**
 * Confirmation Dialog Component
 *
 * Modal dialog for confirming destructive actions detected in agent tmux sessions.
 * Shows when agents request confirmation for operations like branch deletion.
 */

import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

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
    <Modal
      title="Confirmation Required"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onDeny} className={formStyles.button}>
            Deny
          </button>
          <button type="button" onClick={onConfirm} className={formStyles.primaryButton}>
            Confirm
          </button>
        </>
      }
    >
      <div className={`${formStyles.content} flex flex-col gap-3`}>
        <div>
          <p className="text-sm text-muted-foreground mb-1">Agent:</p>
          <p className="text-base text-foreground font-medium">{request.agentId}</p>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-1">Action:</p>
          <p className="text-base text-foreground font-medium">{request.action}</p>
        </div>

        {request.details && (
          <div>
            <p className="text-sm text-muted-foreground mb-1">Details:</p>
            <p className="text-sm text-foreground bg-card/50 p-2 rounded border border-border">
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
    </Modal>
  );
}
