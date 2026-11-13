/**
 * Code pane (PAN-5187, FR-7, FR-19): one file of an explorer root in Monaco.
 *
 * CodePaneSlot mounts it with `key = rootId + path`, so a preview pane that is
 * retargeted to another file unmounts this component and mounts a fresh one:
 * the read, the draft binding and every per-file subscription follow the
 * new path without per-path effect bookkeeping.
 *
 * The text lives in the drafts store (code-drafts.ts), not in component
 * state, so unsaved edits survive the pane unmounting.
 */
import type { ExplorerReadFileResult } from '@overdeck/contracts'
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { usePanesStore } from '../../../lib/panesStore'
import styles from '../../Stage/stage.module.css'
import type { PaneWrapperProps } from '../../Stage/types'
import { explorerErrorCode, explorerErrorMessage, readFile } from '../explorer-rpc'
import { codePaneLabel } from '../openCodePane'
import { draftKey, useCodeDrafts } from './code-drafts'
import { MonacoCodeEditor, type CodeEditorInstance } from './MonacoCodeEditor'
import { NonTextFallback } from './NonTextFallback'
import { useCodePaneSave } from './useCodePaneSave'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: ExplorerReadFileResult }

export const READ_ONLY_NOTE = 'Read-only: the main checkout is never edited directly.'

function Placeholder({ title, hint, testId }: { title: string; hint?: string; testId: string }) {
  return (
    <div className={styles.placeholder} data-testid={testId}>
      <div className={styles.placeholderTitle}>{title}</div>
      {hint ? <div className={styles.placeholderHint}>{hint}</div> : null}
    </div>
  )
}

export const CONFLICT_NOTE = 'The file changed on disk. Your edits are not saved.'

export function CodePane({ pane, ctx }: PaneWrapperProps) {
  const rootId = pane.explorerRootId
  const path = pane.explorerPath
  if (!rootId || !path) return <Placeholder title="No file" hint="This code tab has no file path." testId="code-pane-no-file" />
  return <CodePaneForFile rootId={rootId} path={path} pane={pane} workspaceId={ctx.workspaceId} />
}

function CodePaneForFile({
  rootId,
  path,
  pane,
  workspaceId,
}: {
  rootId: string
  path: string
  pane: PaneWrapperProps['pane']
  workspaceId: string
}) {
  const key = draftKey(rootId, path)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on')
  const [editor, setEditor] = useState<CodeEditorInstance | null>(null)
  const text = useCodeDrafts((s) => s.drafts[key]?.text)

  useEffect(() => {
    let cancelled = false
    readFile(rootId, path)
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'text') useCodeDrafts.getState().loaded(key, result.text ?? '', result.signature)
        setLoad({ status: 'ready', result })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message =
          explorerErrorCode(error) === 'NOT_FOUND' ? 'This file no longer exists.' : explorerErrorMessage(error)
        setLoad({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [rootId, path, key])

  // Reveal the line content search asked for (D-C23), on mount and on each new nonce.
  const revealLine = pane.explorerRevealLine
  const revealColumn = pane.explorerRevealColumn
  const revealNonce = pane.explorerRevealNonce
  useEffect(() => {
    if (!editor || revealLine === undefined) return
    editor.setPosition({ lineNumber: revealLine, column: revealColumn ?? 1 })
    editor.revealLineInCenter(revealLine)
    editor.focus()
  }, [editor, revealLine, revealColumn, revealNonce])

  const writable = load.status === 'ready' && load.result.kind === 'text' && load.result.writable
  const preview = pane.explorerPreview === true
  const save = useCodePaneSave({ rootId, path, workspaceId, paneId: pane.paneId, writable, preview })
  const toggleWrap = useCallback(() => setWordWrap((w) => (w === 'on' ? 'off' : 'on')), [])
  const keepOpen = useCallback(
    () => usePanesStore.getState().updatePane(workspaceId, pane.paneId, { explorerPreview: false }),
    [workspaceId, pane.paneId],
  )
  // Ctrl/Cmd+S while focus is anywhere in this pane, e.g. its header (D-C17).
  // The editor's own action handles it while the editor has focus.
  const { saveNow } = save
  const onPaneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveNow()
      }
    },
    [saveNow],
  )

  if (load.status === 'loading') return <Placeholder title="Loading…" testId="code-pane-loading" />
  if (load.status === 'error') return <Placeholder title="Couldn’t open file" hint={load.message} testId="code-pane-error" />
  const { result } = load
  if (result.kind !== 'text') return <NonTextFallback name={codePaneLabel(path)} size={result.size} />

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-pane" onKeyDown={onPaneKeyDown}>
      {preview ? (
        <div className="flex items-center justify-end border-b border-border px-3 py-1">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={keepOpen}>
            Keep open
          </button>
        </div>
      ) : null}
      {save.conflict ? (
        <div className="border-b border-border px-3 py-1.5 text-xs text-warning-foreground" role="status" data-testid="code-pane-conflict">
          {CONFLICT_NOTE}
        </div>
      ) : null}
      {!result.writable ? (
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="code-pane-read-only">
          {READ_ONLY_NOTE}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <MonacoCodeEditor
          rootId={rootId}
          path={path}
          value={text ?? result.text ?? ''}
          wordWrap={wordWrap}
          readOnly={!result.writable}
          onChange={save.onChange}
          onBlur={save.onBlur}
          onSaveShortcut={save.saveNow}
          onToggleWrap={toggleWrap}
          onMount={setEditor}
        />
      </div>
    </div>
  )
}
