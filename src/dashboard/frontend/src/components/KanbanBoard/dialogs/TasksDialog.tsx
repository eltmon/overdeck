import type { Issue } from '../../../types';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import { TasksPanel } from '../../TasksPanel';

// Simple Tasks Dialog component
export function TasksDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  return (
    <Modal title={`Tasks: ${issue.identifier}`} onClose={onClose}>
      <div className={formStyles.content}>
        {/* TasksPanel with list/graph toggle */}
        <TasksPanel issueId={issue.identifier} />
      </div>
    </Modal>
  );
}
