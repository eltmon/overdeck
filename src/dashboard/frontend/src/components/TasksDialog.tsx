import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';
import { TasksPanel } from './TasksPanel';

interface TasksDialogProps {
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TasksDialog({ issueId, isOpen, onClose }: TasksDialogProps) {
  if (!isOpen) return null;

  return (
    <Modal title={`Tasks: ${issueId}`} closeLabel="Close tasks viewer" onClose={onClose}>
      <div className={formStyles.content}>
        <TasksPanel issueId={issueId} />
      </div>
    </Modal>
  );
}
