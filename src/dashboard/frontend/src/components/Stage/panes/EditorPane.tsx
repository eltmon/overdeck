import { useCallback, useEffect, useState } from 'react'
import { EDITORS, PanRpcError, WS_METHODS, type EditorId } from '@overdeck/contracts'
import { toast } from 'sonner'

import { getTransport, type PanRpcProtocolClient } from '../../../lib/wsTransport'
import { getPreferredEditor, setPreferredEditor } from '../../../editorPreferences'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string; mtimeMs: number }
  | { status: 'error'; code?: string; message: string }

const TEXTAREA_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  outline: 'none',
  resize: 'none',
  padding: 16,
  fontFamily: "'SF Mono', monospace",
  fontSize: 13,
  lineHeight: 1.55,
  background: 'transparent',
  color: 'var(--foreground)',
}

/**
 * EditorPane — paneType='editor' (PAN-3260). Reads/writes a single
 * allowlisted markdown file by absolute path via readFileAtPath/writeFileAtPath
 * (no issueId required, unlike DocsPane/FilesPane — this pane serves surfaces
 * with no workspace context, e.g. a repo-root file chip inside a conversation).
 * Edit|Preview mirrors DocsPane's sub-tab styling; Preview reuses MarkdownTab
 * so there is exactly one markdown renderer in the app (PAN-3260 decision).
 */
export function EditorPane({ pane }: PaneWrapperProps) {
  const filePath = pane.editorFilePath
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)

  const loadFile = useCallback(() => {
    if (!filePath) return
    setLoad({ status: 'loading' })
    setConflict(false)
    void getTransport()
      .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.readFileAtPath]({ path: filePath }))
      .then((result) => {
        const r = result as { text: string; mtimeMs: number }
        setLoad({ status: 'ready', text: r.text, mtimeMs: r.mtimeMs })
        setDraft(r.text)
      })
      .catch((error: unknown) => {
        const code = error instanceof PanRpcError ? error.code : undefined
        const message = error instanceof Error ? error.message : String(error)
        setLoad({ status: 'error', code, message })
      })
  }, [filePath])

  useEffect(() => {
    loadFile()
  }, [loadFile])

  const dirty = load.status === 'ready' && draft !== load.text

  const save = useCallback(
    (opts?: { overwrite?: boolean }) => {
      if (load.status !== 'ready' || !filePath) return
      setSaving(true)
      void getTransport()
        .request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.writeFileAtPath]({
            path: filePath,
            content: draft,
            ...(opts?.overwrite ? {} : { expectedMtimeMs: load.mtimeMs }),
          }),
        )
        .then((result) => {
          const r = result as { mtimeMs: number }
          setLoad({ status: 'ready', text: draft, mtimeMs: r.mtimeMs })
          setConflict(false)
          toast.success('Saved')
        })
        .catch((error: unknown) => {
          if (error instanceof PanRpcError && error.code === 'WRITE_CONFLICT') {
            setConflict(true)
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          toast.error(`Failed to save: ${message}`)
        })
        .finally(() => setSaving(false))
    },
    [load, draft, filePath],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (dirty && !saving) save()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dirty, saving, save])

  const openExternally = useCallback(() => {
    if (!filePath) return
    void getTransport()
      .request((client) => (client as PanRpcProtocolClient)[WS_METHODS.getAvailableEditors]())
      .then((result) => {
        const availableEditors = (result as { editors: readonly EditorId[] }).editors
        const preferred = getPreferredEditor()
        const editor = preferred && availableEditors.includes(preferred)
          ? preferred
          : EDITORS.find((entry) => availableEditors.includes(entry.id))?.id
        if (!editor) throw new Error('No available editors found.')
        setPreferredEditor(editor)
        return getTransport().request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({ cwd: filePath, editor }),
        )
      })
      .then(() => toast.success('Opened in editor'))
      .catch((error: unknown) => {
        toast.error(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`)
      })
  }, [filePath])

  if (!filePath) {
    return (
      <div className={styles.placeholder} data-testid="editor-pane-missing-path">
        <div className={styles.placeholderTitle}>No file to edit</div>
        <div className={styles.placeholderHint}>This editor tab has no file path.</div>
      </div>
    )
  }

  if (load.status === 'loading') {
    return (
      <div className={styles.placeholder} data-testid="editor-pane-loading">
        Loading…
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className={styles.placeholder} data-testid="editor-pane-error">
        <div className={styles.placeholderTitle}>Couldn’t open file</div>
        <div className={styles.placeholderHint}>{load.message}</div>
        {load.code === 'FILE_TOO_LARGE' && (
          <button type="button" onClick={openExternally}>
            Open externally
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.subPane} data-testid="editor-pane">
      <div className={styles.subTabs} role="tablist" aria-label="Editor">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'edit'}
          className={`${styles.subTab} ${activeTab === 'edit' ? styles.subTabActive : ''}`}
          onClick={() => setActiveTab('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          className={`${styles.subTab} ${activeTab === 'preview' ? styles.subTabActive : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
        <span style={{ flex: 1 }} />
        {dirty && <span data-testid="editor-pane-dirty" title="Unsaved changes" style={{ color: 'var(--muted-foreground)' }}>●</span>}
        <button type="button" disabled={!dirty || saving} onClick={() => save()} data-testid="editor-pane-save">
          Save
        </button>
      </div>
      {conflict && (
        <div data-testid="editor-pane-conflict" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          File changed on disk since it was read.
          <button type="button" onClick={loadFile} data-testid="editor-pane-reload" style={{ marginLeft: 8 }}>
            Reload from disk
          </button>
          <button type="button" onClick={() => save({ overwrite: true })} data-testid="editor-pane-overwrite" style={{ marginLeft: 8 }}>
            Overwrite
          </button>
        </div>
      )}
      <div className={styles.subBody}>
        {activeTab === 'edit' ? (
          <textarea
            data-testid="editor-pane-textarea"
            style={TEXTAREA_STYLE}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
        ) : (
          <MarkdownTab body={draft} />
        )}
      </div>
    </div>
  )
}
