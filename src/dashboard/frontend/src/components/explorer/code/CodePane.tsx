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
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePanesStore } from '../../../lib/panesStore'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { pickViewer } from '../viewers/viewer-router'
import styles from '../../Stage/stage.module.css'
import type { PaneWrapperProps } from '../../Stage/types'
import { useEditWorkspaceStore } from '../edit/edit-workspace-store'
import { explorerErrorCode, explorerErrorMessage, parseRootId, readFile } from '../explorer-rpc'
import { openCodePane } from '../openCodePane'
import { draftKey, isDraftDirty, useCodeDrafts } from './code-drafts'
import { MonacoCodeEditor, type CodeEditorInstance, type CodePosition } from './MonacoCodeEditor'
import { ChangesView } from './ChangesView'
import { CodePaneHeader, isMarkdownPath, type CodePaneView } from './CodePaneHeader'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { useCodePaneSave } from './useCodePaneSave'
import { readDisk, useExternalChange } from './useExternalChange'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: ExplorerReadFileResult }

// PAN-5188's viewer host: images, PDFs, audio, fonts, tables, archives and
// large text. Its viewers lazy-load in turn (PAN-5188 D-1, the §6.7 seam).
const FileViewer = lazy(() => import('../viewers/FileViewer'))

/** PAN-5191: the note on a project root, whose saves go to an edit workspace. */
export const PROJECT_EDIT_NOTE = 'Edits here are saved to an edit workspace. The main checkout is never changed.'
export const CREATING_EDIT_NOTE = 'Creating edit workspace…'

function Placeholder({ title, hint, testId }: { title: string; hint?: string; testId: string }) {
  return (
    <div className={styles.placeholder} data-testid={testId}>
      <div className={styles.placeholderTitle}>{title}</div>
      {hint ? <div className={styles.placeholderHint}>{hint}</div> : null}
    </div>
  )
}

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
  // null until the user picks: a text file a viewer can show (CSV, SVG)
  // opens in Preview, everything else in Edit.
  const [chosenView, setView] = useState<CodePaneView | null>(null)
  // The diff in the body: the Changes view (HEAD) or the banner's Compare (disk).
  const [diff, setDiff] = useState<'head' | 'disk' | null>(null)
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
    if (!editor || diff || !position) return
    carriedPosition.current = null
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }, [editor, diff])

  const rootRef = parseRootId(rootId)
  const isProjectRoot = rootRef?.kind === 'project'
  const creatingEdit = useEditWorkspaceStore((s) => (isProjectRoot && rootRef ? s.creating[rootRef.key] === true : false))
  // PAN-5191: a project root is editable; the first save moves the edit to an edit workspace.
  const writable = load.status === 'ready' && load.result.kind === 'text' && (load.result.writable || isProjectRoot)
  const preview = pane.explorerPreview === true
  const save = useCodePaneSave({ rootId, path, workspaceId, paneId: pane.paneId, writable, preview })
  const toggleWrap = useCallback(() => setWordWrap((w) => (w === 'on' ? 'off' : 'on')), [])
  const switchDiff = useCallback(
    (next: 'head' | 'disk' | null) => {
      carriedPosition.current = (diff ? diffEditor.current : editor)?.getPosition() ?? null
      if (diff) diffEditor.current = null
      if (!diff && next) setEditor(null)
      setView('edit')
      setDiff(next)
    },
    [diff, editor],
  )
  const toggleChanges = useCallback(() => switchDiff(diff === 'head' ? null : 'head'), [diff, switchDiff])
  const onDiffMount = useCallback((instance: CodeEditorInstance) => {
    diffEditor.current = instance
  }, [])
  const keepOpen = useCallback(
    () => usePanesStore.getState().updatePane(workspaceId, pane.paneId, { explorerPreview: false }),
    [workspaceId, pane.paneId],
  )
  // Ctrl/Cmd+S while focus is anywhere in this pane, e.g. its header (D-C17).
  // The editor's own action handles it while the editor has focus.
  const { saveNow, conflict, clearConflict, overwrite } = save

  // A save refused with DISK_CONFLICT: show what disk holds now.
  useEffect(() => {
    if (!conflict) return
    let cancelled = false
    readDisk(rootId, path)
      .then((read) => {
        // Reload from disk may have cleaned the draft while this read ran; a
        // refused save of edits that no longer exist needs no banner.
        if (cancelled || !isDraftDirty(useCodeDrafts.getState().drafts[key])) return
        setExternal(read.missing ? { kind: 'deleted' } : { kind: 'changed', diskText: read.text, diskSignature: read.signature })
      })
      .catch((error: unknown) => {
        console.warn('[explorer-code] re-read after a refused save failed', error)
      })
      .finally(() => {
        if (!cancelled) clearConflict()
      })
    return () => {
      cancelled = true
    }
  }, [conflict, rootId, path, key, setExternal, clearConflict])

  const externalState = external.state
  const resolveChange = useCallback(
    (apply: (diskText: string, diskSignature: string) => void) => {
      if (externalState.kind !== 'changed') return
      apply(externalState.diskText, externalState.diskSignature)
      if (diff === 'disk') switchDiff(null)
      setExternal({ kind: 'clean' })
    },
    [externalState, diff, switchDiff, setExternal],
  )
  const onReload = useCallback(
    () => resolveChange((diskText, signature) => useCodeDrafts.getState().reset(key, diskText, signature)),
    [resolveChange, key],
  )
  const onKeepMine = useCallback(
    () => resolveChange((diskText, signature) => useCodeDrafts.getState().keepMine(key, diskText, signature)),
    [resolveChange, key],
  )
  const onOverwrite = useCallback(() => resolveChange(() => overwrite()), [resolveChange, overwrite])
  // Compare closes when the banner clears by itself (e.g. disk went back to the base).
  useEffect(() => {
    if (diff === 'disk' && externalState.kind !== 'changed') switchDiff(null)
  }, [diff, externalState.kind, switchDiff])
  const onCompare = useCallback(() => switchDiff(diff === 'disk' ? null : 'disk'), [diff, switchDiff])
  const onOpenRenamed = useCallback(
    (newPath: string) => openCodePane(workspaceId, { rootId, path: newPath }),
    [workspaceId, rootId],
  )
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
  const viewer = pickViewer(path, result)
  // A viewer-only file (binary, large text, or a text read such as an ASCII
  // PDF that only a viewer can show) never opens in Monaco.
  if (result.kind !== 'text' || (viewer.kind !== 'text' && !viewer.textEditable)) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="code-pane-viewer">
        <Suspense fallback={<Placeholder title="Loading…" testId="code-pane-loading" />}>
          <FileViewer rootId={rootId} path={path} read={result} wordWrap={wordWrap === 'on'} />
        </Suspense>
      </div>
    )
  }
  const viewerPreview = viewer.kind !== 'text' && viewer.textEditable
  const previewable = viewerPreview || isMarkdownPath(path)
  const view = chosenView ?? (viewerPreview ? 'preview' : 'edit')
  const showPreview = previewable && view === 'preview'
  // Compare shows the disk text only while the banner reports it.
  const diskDiff = diff === 'disk' && externalState.kind === 'changed' ? externalState.diskText : undefined

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-pane" onKeyDown={onPaneKeyDown}>
      <CodePaneHeader
        path={path}
        previewable={previewable}
        view={view}
        onView={setView}
        wordWrap={wordWrap}
        onToggleWrap={toggleWrap}
        changes={diff === 'head'}
        onToggleChanges={toggleChanges}
        preview={preview}
        onKeepOpen={keepOpen}
      />
      <ExternalChangeBanner
        state={externalState}
        comparing={diskDiff !== undefined}
        onCompare={onCompare}
        onReload={onReload}
        onKeepMine={onKeepMine}
        onOverwrite={onOverwrite}
        onOpen={onOpenRenamed}
      />
      {isProjectRoot ? (
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="code-pane-project-note">
          {creatingEdit ? CREATING_EDIT_NOTE : PROJECT_EDIT_NOTE}
        </div>
      ) : null}
      {diff === 'head' || diskDiff !== undefined ? (
        <div className="min-h-0 flex-1" data-testid="code-pane-changes">
          <ChangesView
            key={diff ?? 'none'}
            rootId={rootId}
            path={path}
            modified={text ?? result.text ?? ''}
            original={diff === 'disk' ? diskDiff : undefined}
            wordWrap={wordWrap}
            readOnly={!writable}
            initialPosition={carriedPosition.current}
            onChange={save.onChange}
            onBlur={save.onBlur}
            onSaveShortcut={save.saveNow}
            onMount={onDiffMount}
          />
        </div>
      ) : showPreview && viewerPreview ? (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="code-pane-viewer">
          <Suspense fallback={<Placeholder title="Loading…" testId="code-pane-loading" />}>
            <FileViewer rootId={rootId} path={path} read={{ ...result, text: text ?? result.text }} wordWrap={wordWrap === 'on'} />
          </Suspense>
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
            readOnly={!writable}
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
