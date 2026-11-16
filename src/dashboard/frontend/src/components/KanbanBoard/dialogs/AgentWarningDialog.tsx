import type { Issue } from '../../../types';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';

interface AgentWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  issue: Issue | null;
}

export function AgentWarningDialog({ isOpen, onClose, onConfirm, issue }: AgentWarningDialogProps) {
  if (!isOpen || !issue) return null;

  return (
    <Modal
      title="Active Agent Warning"
      size="narrow"
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={formStyles.button}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={formStyles.primaryButton}>
          Move Anyway
        </button>
      </>}
    >
      <div className={`${formStyles.content} space-y-3`}>
        <p className={formStyles.text}>
          <strong>{issue.identifier}</strong> has an active agent working on it.
          Moving this issue may disrupt the agent's work.
        </p>
        <p className={formStyles.hint}>
          Are you sure you want to proceed?
        </p>
      </div>
    </Modal>
  );
}
