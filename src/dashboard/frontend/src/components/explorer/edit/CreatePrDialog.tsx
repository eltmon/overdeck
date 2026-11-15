/**
 * Create PR dialog for an edit workspace (PAN-5191 FR-6 to FR-8 and FR-12;
 * PAN-5290 FR-12, C-D8).
 *
 * Without an open PR it lists what will land (every file with its +/−) and
 * asks "How should it land?": Open a pull request (a direct PR, optionally a
 * draft) or Send through the pipeline (a GitHub issue plus its PR, handed to
 * Overdeck's review pipeline). A choice the project cannot support is
 * disabled with its reason in words. The one primary button is labelled by
 * the choice. With an open PR it becomes "Commit and push", which lists only
 * the uncommitted files and commits and pushes them to that PR. A refused
 * commit or push shows the server's message verbatim (hook output included)
 * and the dialog stays open.
 */
import type {
  EditWorkspaceChangedFile,
  EditWorkspaceChanges,
  EditWorkspaceCreatePrResult,
  EditWorkspaceStatus,
  EditWorkspaceSupport,
} from '@overdeck/contracts'
import { useState, type FormEvent } from 'react'

import { Modal } from '../../shared/Modal'
import { explorerErrorMessage } from '../explorer-rpc'
import { defaultPrTitle } from './default-pr-title'
import { createEditWorkspacePr } from './edit-workspace-http'
import styles from './editDialog.module.css'

type Mode = 'direct' | 'pipeline'

export interface CreatePrDialogProps {
  status: EditWorkspaceStatus
  /** What will land (GET …/changes); undefined while it loads. */
  changes: EditWorkspaceChanges | undefined
  onClose(): void
  onDone(result: EditWorkspaceCreatePrResult): void
}

const CHOICES: Array<{ mode: Mode; title: string; description: string }> = [
  {
    mode: 'direct',
    title: 'Open a pull request',
    description: 'You review and merge it yourself. When GitHub reports no conflicts, Merge appears in the editor bar.',
  },
  {
    mode: 'pipeline',
    title: 'Send through the pipeline',
    description: 'Creates an issue and a PR; review and test agents check it, then it merges like any other issue.',
  },
]

const SUBMIT_LABEL: Record<Mode, string> = { direct: 'Open pull request', pipeline: 'Send through the pipeline' }

function filesWord(n: number): string {
  return `${n} ${n === 1 ? 'file' : 'files'}`
}

function FileRows({ files }: { files: readonly EditWorkspaceChangedFile[] }) {
  return (
    <ul className={styles.fileList} data-testid="create-pr-files">
      {files.map((file) => (
        <li key={file.path} className={styles.fileRow}>
          <span className={styles.filePath} title={file.path}>
            {file.path}
          </span>
          <span className={styles.fileCounts}>{file.binary ? 'binary' : `+${file.additions} −${file.deletions}`}</span>
        </li>
      ))}
    </ul>
  )
}

function PathRows({ paths }: { paths: readonly string[] }) {
  return (
    <ul className={styles.fileList} data-testid="create-pr-files">
      {paths.map((path) => (
        <li key={path} className={styles.fileRow}>
          <span className={styles.filePath} title={path}>
            {path}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CreatePrDialog({ status, changes, onClose, onDone }: CreatePrDialogProps) {
  const pushOnly = status.pr?.state === 'OPEN'
  const { workspace, prSupport, pipelineSupport } = status
  const support: Record<Mode, EditWorkspaceSupport> = { direct: prSupport, pipeline: pipelineSupport }
  const [title, setTitle] = useState(() => defaultPrTitle(changes?.files.map((f) => f.path) ?? []))
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  // The first available choice; direct when both are.
  const [mode, setMode] = useState<Mode>(() => (!prSupport.available && pipelineSupport.available ? 'pipeline' : 'direct'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleMissing = title.trim() === ''
  const submitMode: Mode = pushOnly ? 'direct' : mode
  const canSubmit = !titleMissing && !busy && (pushOnly || support[mode].available)

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const result = await createEditWorkspacePr(workspace.id, {
        mode: submitMode,
        title: title.trim(),
        body,
        draft: submitMode === 'direct' && !pushOnly && draft,
      })
      onDone(result)
    } catch (e) {
      setError(explorerErrorMessage(e))
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  // Push mode lists the uncommitted paths themselves: the files above are measured from the merge
  // base, which can miss a file a pushed commit added and the working tree deleted.
  const uncommittedPaths = changes?.uncommittedPaths ?? []

  return (
    <Modal
      title={pushOnly ? 'Commit and push' : 'Create a pull request'}
      onClose={onClose}
      dismissible={!busy}
      onSubmit={onSubmit}
      pinned={error ? <p className={styles.error} role="alert" data-testid="create-pr-error">{error}</p> : undefined}
      footer={
        <>
          <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
            {busy ? 'Working…' : pushOnly ? 'Commit and push' : SUBMIT_LABEL[mode]}
          </button>
        </>
      }
    >
      <div className={styles.form} data-testid="create-pr-dialog">
        <p className={styles.text} data-testid="create-pr-from">
          {pushOnly ? (
            <>
              Commits every change in edit workspace <code>{workspace.name}</code> and pushes <code>{workspace.branch}</code> to PR #
              {status.pr?.number}.
            </>
          ) : (
            <>
              From edit workspace <code>{workspace.name}</code>, branch <code>{workspace.branch}</code>, into{' '}
              <code>{workspace.defaultBranch}</code>.
            </>
          )}
        </p>
        <div className={styles.field}>
          <label htmlFor="create-pr-title" className={styles.label}>
            {pushOnly ? 'Commit message' : 'Title'}
          </label>
          <input
            id="create-pr-title"
            className={styles.input}
            value={title}
            required
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {pushOnly ? null : (
          <div className={styles.field}>
            <label htmlFor="create-pr-body" className={styles.label}>
              Description (optional)
            </label>
            <textarea
              id="create-pr-body"
              className={styles.textarea}
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        )}
        <div className={styles.field}>
          <span className={styles.label} data-testid="create-pr-files-heading">
            {!changes ? (
              'Reading what will land…'
            ) : pushOnly ? (
              <>What will be committed · {filesWord(uncommittedPaths.length)}</>
            ) : (
              <>
                What will land · {filesWord(changes.files.length)}{' '}
                <span className={styles.mono}>
                  +{changes.additions} −{changes.deletions}
                </span>
              </>
            )}
          </span>
          {!changes ? null : pushOnly ? <PathRows paths={uncommittedPaths} /> : <FileRows files={changes.files} />}
        </div>
        {pushOnly ? null : (
          <div className={styles.field}>
            <span id="create-pr-land" className={styles.label}>
              How should it land?
            </span>
            <div role="radiogroup" aria-labelledby="create-pr-land" className={styles.radioGroup}>
              {CHOICES.map((choice) => {
                const available = support[choice.mode].available
                const checked = mode === choice.mode
                return (
                  <button
                    key={choice.mode}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-disabled={!available || busy}
                    className={`${styles.radio} ${checked ? styles.radioChecked : ''}`}
                    onClick={() => {
                      if (available && !busy) setMode(choice.mode)
                    }}
                  >
                    <span aria-hidden className={styles.radioMark} />
                    <span className={styles.radioText}>
                      <span className={styles.radioTitle}>{choice.title}</span>
                      <span className={styles.hint} data-testid={`create-pr-${choice.mode}-note`}>
                        {available ? choice.description : support[choice.mode].reason}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {mode === 'direct' ? (
              <label className={styles.choice}>
                <input type="checkbox" checked={draft} disabled={busy} onChange={(e) => setDraft(e.target.checked)} />
                Open as a draft
              </label>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
