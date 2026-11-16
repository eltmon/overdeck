import { useState } from 'react';
import type { Issue } from '../../../types';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';

interface SyncPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSync: (syncToTracker: boolean, options?: { cleanupWorkspace?: boolean; stopAgents?: boolean }) => void;
  issue: Issue | null;
}

export function SyncPromptDialog({ isOpen, onClose, onSync, issue }: SyncPromptDialogProps) {
  const [cleanupWorkspace, setCleanupWorkspace] = useState(false);
  const [stopAgents, setStopAgents] = useState(false);

  if (!isOpen || !issue) return null;

  // Determine tracker type from issue source
  const trackerName = issue.source === 'github' ? 'GitHub' : 'Linear';

  return (
    <Modal
      title="Move to Done"
      size="narrow"
      onClose={onClose}
      footer={<>
        <button
          type="button"
          onClick={() => onSync(false, { cleanupWorkspace, stopAgents })}
          className={formStyles.button}
        >
          Shadow Only
        </button>
        <button
          type="button"
          onClick={() => onSync(true, { cleanupWorkspace, stopAgents })}
          className={formStyles.primaryButton}
        >
          Sync to {trackerName}
        </button>
      </>}
    >
      <div className={formStyles.form}>
        <p className={formStyles.text}>
          You're moving <strong>{issue.identifier}</strong> to Done.
        </p>

        {/* Cleanup options */}
        <fieldset className={formStyles.fieldset}>
          <label className={formStyles.choice}>
            <input
              type="checkbox"
              checked={cleanupWorkspace}
              onChange={(e) => setCleanupWorkspace(e.target.checked)}
            />
            <span className={formStyles.choiceTitle}>Clean up workspace</span>
          </label>
          <label className={formStyles.choice}>
            <input
              type="checkbox"
              checked={stopAgents}
              onChange={(e) => setStopAgents(e.target.checked)}
            />
            <span className={formStyles.choiceTitle}>Stop running agents</span>
          </label>
        </fieldset>

        <p className={formStyles.hint}>
          Sync status change to {trackerName}?
        </p>
      </div>
    </Modal>
  );
}
