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
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePanesStore } from '../../../lib/panesStore'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import styles from '../../Stage/stage.module.css'
import type { PaneWrapperProps } from '../../Stage/types'
import { explorerErrorCode, explorerErrorMessage, readFile } from '../explorer-rpc'
import { codePaneLabel } from '../openCodePane'
import { draftKey, useCodeDrafts } from './code-drafts'
import { MonacoCodeEditor, type CodeEditorInstance, type CodePosition } from './MonacoCodeEditor'
import { ChangesView } from './ChangesView'
import { CodePaneHeader, isMarkdownPath, type CodePaneView } from './CodePaneHeader'
import { NonTextFallback } from './NonTextFallback'
import { useCodePaneSave } from './useCodePaneSave'
import { useExternalChange } from './useExternalChange'

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
  const [view, setView] = useState<CodePaneView>('edit')
  const showPreview = view === 'preview' && isMarkdownPath(path)
  const [changes, setChanges] = useState(false)
  // The cursor carried between the plain editor and the diff's modified side.
  const diffEditor = useRef<CodeEditorInstance | null>(null)
  const carriedPosition = useRef<CodePosition | null>(null)
  const [editor, setEditor] = useState<CodeEditorInstance | null>(null)
  const text = useCodeDrafts((s) => s.drafts[key]?.text)
  const external = useExternalChange(rootId, path)
  const { setState: setExternal } = external

  useEffect(() => {
    let cancelled = false
    readFile(rootId, path)
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'text') {
          const diskText = result.text ?? ''
          // An unsaved draft from an earlier visit that disk no longer matches.
          if (!useCodeDrafts.getState().loaded(key, diskText, result.signature)) {
            setExternal({ kind: 'changed', diskText, diskSignature: result.signature })
          }
        }
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
  }, [rootId, path, key, setExternal])

  // Reveal the line content search asked for (D-C23): once on mount and once
  // per new nonce, not again when the editor remounts after the diff closes.
  const revealLine = pane.explorerRevealLine
  const revealColumn = pane.explorerRevealColumn
  const revealNonce = pane.explorerRevealNonce
  const revealedNonce = useRef<number | undefined | null>(null)
  useEffect(() => {
    if (!editor || revealLine === undefined || revealedNonce.current === revealNonce) return
    revealedNonce.current = revealNonce
    editor.setPosition({ lineNumber: revealLine, column: revealColumn ?? 1 })
    editor.revealLineInCenter(revealLine)
    editor.focus()
  }, [editor, revealLine, revealColumn, revealNonce])

  // Back from the diff: put the cursor where it was on the modified side.
  useEffect(() => {
    const position = carriedPosition.current
    if (!editor || changes || !position) return
    carriedPosition.current = null
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }, [editor, changes])

  const writable = load.status === 'ready' && load.result.kind === 'text' && load.result.writable
  const preview = pane.explorerPreview === true
  const save = useCodePaneSave({ rootId, path, workspaceId, paneId: pane.paneId, writable, preview })
  const toggleWrap = useCallback(() => setWordWrap((w) => (w === 'on' ? 'off' : 'on')), [])
  const toggleChanges = useCallback(() => {
    carriedPosition.current = (changes ? diffEditor.current : editor)?.getPosition() ?? null
    if (changes) diffEditor.current = null
    else setEditor(null)
    setView('edit')
    setChanges(!changes)
  }, [changes, editor])
  const onDiffMount = useCallback((instance: CodeEditorInstance) => {
    diffEditor.current = instance
  }, [])
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
      <CodePaneHeader
        path={path}
        view={view}
        onView={setView}
        wordWrap={wordWrap}
        onToggleWrap={toggleWrap}
        changes={changes}
        onToggleChanges={toggleChanges}
        preview={preview}
        onKeepOpen={keepOpen}
      />
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
      {changes ? (
        <div className="min-h-0 flex-1" data-testid="code-pane-changes">
          <ChangesView
            rootId={rootId}
            path={path}
            modified={text ?? result.text ?? ''}
            wordWrap={wordWrap}
            readOnly={!result.writable}
            initialPosition={carriedPosition.current}
            onChange={save.onChange}
            onBlur={save.onBlur}
            onSaveShortcut={save.saveNow}
            onMount={onDiffMount}
          />
        </div>
      ) : showPreview ? (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="code-pane-markdown">
          <MarkdownTab body={text ?? result.text ?? ''} />
        </div>
      ) : (
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
      )}
    </div>
  )
}
