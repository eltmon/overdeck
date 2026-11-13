/**
 * Changes view (PAN-5187, FR-7): a Monaco diff of the file's committed
 * (HEAD) version against the live draft.
 *
 * The HEAD text is read once each time the view opens. The modified side is
 * the draft: edits there go through the same onChange as the plain editor,
 * and Ctrl/Cmd+S and blur save as they do there. A file that is not in HEAD
 * diffs against empty text.
 *
 * With `original` set (the banner's Compare), the left side is that text,
 * the file's current disk content, and nothing is read.
 */
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../../hooks/useTheme'
import { explorerErrorMessage, readFile } from '../explorer-rpc'
import { codeLanguageForPath, codeModelUri, type CodeEditorInstance, type CodePosition } from './MonacoCodeEditor'

type HeadState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'unavailable'; message: string }

export interface ChangesViewProps {
  rootId: string
  path: string
  modified: string
  /** Diff against this text instead of HEAD. */
  original?: string
  wordWrap: 'on' | 'off'
  readOnly: boolean
  /** Where the cursor was in the plain editor; restored on the modified side. */
  initialPosition: CodePosition | null
  onChange(text: string): void
  onBlur(): void
  onSaveShortcut(): void
  onMount(modifiedEditor: CodeEditorInstance): void
}

export function ChangesView(props: ChangesViewProps) {
  const { rootId, path, modified, original, wordWrap, readOnly } = props
  const theme = useTheme((s) => s.resolvedTheme)
  const [fetched, setFetched] = useState<HeadState>({ status: 'loading' })
  const head: HeadState = original !== undefined ? { status: 'ready', text: original } : fetched
  const against = original !== undefined ? 'disk' : 'HEAD'
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (against === 'disk') return
    let cancelled = false
    readFile(rootId, path, 'HEAD')
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'text') setFetched({ status: 'ready', text: result.text ?? '' })
        else setFetched({ status: 'unavailable', message: 'The committed version is too large or binary to compare.' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setFetched({ status: 'unavailable', message: explorerErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [rootId, path, against])

  const handleMount = useCallback<DiffOnMount>((diffEditor, monaco) => {
    const editor = diffEditor.getModifiedEditor()
    editor.onDidChangeModelContent(() => latest.current.onChange(editor.getValue()))
    editor.onDidBlurEditorText(() => latest.current.onBlur())
    editor.addAction({
      id: 'overdeck.explorer.diffSave',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => latest.current.onSaveShortcut(),
    })
    const position = latest.current.initialPosition
    if (position) {
      editor.setPosition(position)
      editor.revealPositionInCenter(position)
    }
    editor.focus()
    latest.current.onMount(editor)
  }, [])

  if (head.status === 'loading') {
    return <div className="p-4 text-sm text-muted-foreground">Loading changes…</div>
  }
  if (head.status === 'unavailable') {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="changes-view-unavailable">
        {head.message}
      </div>
    )
  }

  const modelUri = codeModelUri(rootId, path)
  return (
    <DiffEditor
      height="100%"
      original={head.text}
      modified={modified}
      language={codeLanguageForPath(path)}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      originalModelPath={`${modelUri}?ref=${against}`}
      modifiedModelPath={`${modelUri}?diff`}
      loading={<div className="p-4 text-sm text-muted-foreground">Loading changes…</div>}
      options={{
        originalEditable: false,
        readOnly,
        wordWrap,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
      }}
      onMount={handleMount}
    />
  )
}
