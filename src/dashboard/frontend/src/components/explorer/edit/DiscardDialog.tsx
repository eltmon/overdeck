/**
 * Discard dialog for an edit workspace (PAN-5191, FR-11). Lists what will be
 * lost (uncommitted files from git status and code panes with unsaved
 * edits), offers "Also close PR #n" while a PR is open, and removes the edit
 * workspace with force.
 */
import type { EditWorkspaceStatus } from '@overdeck/contracts'
import { useState } from 'react'

import { Modal } from '../../shared/Modal'
import { explorerErrorMessage } from '../explorer-rpc'
import { discardEditWorkspace } from './edit-workspace-http'
import styles from './editDialog.module.css'

export interface DiscardDialogProps {
  status: EditWorkspaceStatus
  uncommittedPaths: readonly string[]
  unsavedPaths: readonly string[]
  onClose(): void
  onDiscarded(result: { removed: true; prClosed: boolean }): void
}

export function DiscardDialog({ status, uncommittedPaths, unsavedPaths, onClose, onDiscarded }: DiscardDialogProps) {
  const openPr = status.pr?.state === 'OPEN' ? status.pr : null
  const [closePr, setClosePr] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lost = [...new Set([...uncommittedPaths, ...unsavedPaths])]

  const discard = async () => {
    setBusy(true)
    setError(null)
    try {
      onDiscarded(await discardEditWorkspace(status.workspace.id, openPr ? closePr : false))
    } catch (e) {
      setError(explorerErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Discard edit workspace ${status.workspace.name}`}
      onClose={onClose}
      dismissible={!busy}
      pinned={error ? <p className={styles.error} role="alert" data-testid="discard-error">{error}</p> : undefined}
      footer={
        <>
          <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.destructiveButton} onClick={() => void discard()} disabled={busy}>
            {busy ? 'Working…' : 'Discard'}
          </button>
        </>
      }
    >
      <div className={styles.form} data-testid="discard-dialog">
        {lost.length > 0 ? (
          <div className={styles.field}>
            <p className={styles.text}>These changes will be lost:</p>
            <ul className={styles.list} data-testid="discard-paths">
              {lost.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={styles.text}>No uncommitted changes.</p>
        )}
        <p className={styles.hint}>
          Removes the worktree and the branch <code>{status.workspace.branch}</code>. The main checkout is not changed.
        </p>
        {openPr && (
          <label className={styles.choice}>
            <input type="checkbox" checked={closePr} disabled={busy} onChange={(e) => setClosePr(e.target.checked)} />
            Also close PR #{openPr.number}
          </label>
        )}
      </div>
    </Modal>
  )
}
