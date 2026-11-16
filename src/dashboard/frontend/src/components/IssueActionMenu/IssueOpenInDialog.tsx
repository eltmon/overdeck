import { PanOpenInPicker } from '../PanOpenInPicker';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';

interface IssueOpenInDialogProps {
  cwd: string;
  onClose: () => void;
}

export function IssueOpenInDialog({ cwd, onClose }: IssueOpenInDialogProps) {
  return (
    <Modal title="Open workspace" size="narrow" onClose={onClose}>
      <div className={formStyles.content}>
        <PanOpenInPicker openInCwd={cwd} />
      </div>
    </Modal>
  );
}
