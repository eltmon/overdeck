/**
 * Create PR dialog for an edit workspace (PAN-5191, FR-6, FR-7, FR-8, FR-12).
 *
 * Without an open PR it offers Open PR (a direct PR, optionally a draft) and
 * Send through pipeline (a GitHub issue plus its PR, handed to Overdeck's
 * review pipeline); each is disabled with its reason in words when the
 * project lacks support. With an open PR it becomes "Commit and push", which
 * commits and pushes to that PR. A refused commit or push shows the server's
 * message verbatim (hook output included) and the dialog stays open.
 */
import type { EditWorkspaceCreatePrResult, EditWorkspaceStatus } from '@overdeck/contracts'
import { useState, type FormEvent } from 'react'

import { Modal } from '../../shared/Modal'
import { explorerErrorMessage } from '../explorer-rpc'
import { defaultPrTitle } from './default-pr-title'
import { createEditWorkspacePr } from './edit-workspace-http'
import styles from './editDialog.module.css'

type Mode = 'direct' | 'pipeline'

export interface CreatePrDialogProps {
  status: EditWorkspaceStatus
  /** Git status paths of the edit root: uncommitted entries, then committed ones. */
  changedPaths: readonly string[]
  onClose(): void
  onDone(result: EditWorkspaceCreatePrResult): void
}

export function CreatePrDialog({ status, changedPaths, onClose, onDone }: CreatePrDialogProps) {
  const pushOnly = status.pr?.state === 'OPEN'
  const [title, setTitle] = useState(() => defaultPrTitle(changedPaths))
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { workspace, prSupport, pipelineSupport } = status
  const titleMissing = title.trim() === ''

  const submit = async (mode: Mode) => {
    if (titleMissing || busy) return
    setBusy(mode)
    setError(null)
    try {
      const result = await createEditWorkspacePr(workspace.id, {
        mode,
        title: title.trim(),
        body,
        draft: mode === 'direct' && !pushOnly && draft,
      })
      onDone(result)
    } catch (e) {
      setError(explorerErrorMessage(e))
      setBusy(null)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pushOnly || prSupport.available) void submit('direct')
  }

  const label = (mode: Mode, idle: string) => (busy === mode ? 'Working…' : idle)

  return (
    <Modal
      title={pushOnly ? 'Commit and push' : 'Create PR'}
      onClose={onClose}
      dismissible={busy === null}
      onSubmit={onSubmit}
      pinned={error ? <p className={styles.error} role="alert" data-testid="create-pr-error">{error}</p> : undefined}
      footer={
        <button type="button" className={styles.button} onClick={onClose} disabled={busy !== null}>
          Cancel
        </button>
      }
    >
      <div className={styles.form} data-testid="create-pr-dialog">
        <div className={styles.field}>
          <label htmlFor="create-pr-title" className={styles.label}>
            {pushOnly ? 'Commit message' : 'Title'}
          </label>
          <input
            id="create-pr-title"
            className={styles.input}
            value={title}
            required
            disabled={busy !== null}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {pushOnly ? (
          <div className={styles.action}>
            <button type="submit" className={styles.primaryButton} disabled={titleMissing || busy !== null}>
              {label('direct', 'Commit and push')}
            </button>
            <p className={styles.hint}>
              Commits every change in this edit workspace and pushes <code>{workspace.branch}</code> to PR #{status.pr?.number}.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor="create-pr-body" className={styles.label}>
                Body
              </label>
              <textarea
                id="create-pr-body"
                className={styles.textarea}
                value={body}
                disabled={busy !== null}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className={styles.action}>
              <label className={styles.choice}>
                <input type="checkbox" checked={draft} disabled={busy !== null} onChange={(e) => setDraft(e.target.checked)} />
                Open as a draft
              </label>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!prSupport.available || titleMissing || busy !== null}
              >
                {label('direct', 'Open PR')}
              </button>
              <p className={styles.hint} data-testid="open-pr-note">
                {prSupport.available ? (
                  <>
                    Commits every change in this edit workspace, pushes <code>{workspace.branch}</code> and opens a PR to{' '}
                    <code>{workspace.defaultBranch}</code>.
                  </>
                ) : (
                  prSupport.reason
                )}
              </p>
            </div>
            <div className={styles.action}>
              <button
                type="button"
                className={styles.button}
                disabled={!pipelineSupport.available || titleMissing || busy !== null}
                onClick={() => void submit('pipeline')}
              >
                {label('pipeline', 'Send through pipeline')}
              </button>
              <p className={styles.hint} data-testid="pipeline-note">
                {pipelineSupport.available
                  ? "Creates a GitHub issue, opens its PR and hands it to Overdeck's review pipeline."
                  : pipelineSupport.reason}
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
