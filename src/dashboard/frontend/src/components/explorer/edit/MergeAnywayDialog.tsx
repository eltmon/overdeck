/**
 * Confirms a merge GitHub allows while the PR's checks have not all passed
 * (mergeStateStatus UNSTABLE, PAN-5391). Built on shared/Modal like the other
 * edit-workspace dialogs.
 */
import { Modal } from '../../shared/Modal'
import styles from './editDialog.module.css'

export interface MergeAnywayDialogProps {
  prNumber: number
  defaultBranch: string
  onCancel(): void
  onConfirm(): void
}

export function MergeAnywayDialog({ prNumber, defaultBranch, onCancel, onConfirm }: MergeAnywayDialogProps) {
  return (
    <Modal
      title={`Merge PR #${prNumber} before its checks pass?`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.primaryButton} onClick={onConfirm}>Merge anyway</button>
        </>
      }
    >
      <div className={styles.form} data-testid="merge-anyway-dialog">
        <p className={styles.text}>
          GitHub allows this merge, but the PR's checks have not all passed. Merging now squashes it into{' '}
          <code>{defaultBranch}</code> without waiting for them.
        </p>
      </div>
    </Modal>
  )
}
