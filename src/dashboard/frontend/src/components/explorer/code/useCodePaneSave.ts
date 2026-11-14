/**
 * Saving from a code pane (PAN-5187, FR-7, FR-8).
 *
 * One app-wide save queue writes every code pane's draft, one write in
 * flight per file. Each mounted pane owns an autosave controller: 1,000 ms
 * after the last edit, on blur, on Ctrl/Cmd+S and, if the timer is armed,
 * when the pane closes (D-C19). Every write sends the draft's base
 * signature; a DISK_CONFLICT answer sets `conflict` and leaves the draft
 * dirty, and every other failure shows a toast.
 *
 * When the last pane of a file unmounts and its draft is clean, the draft
 * is dropped, so the store does not grow with every file ever opened. A
 * dirty draft stays, so reopening the file restores the unsaved text.
 *
 * PAN-5191: on a project root a save never writes. It calls ensureEditRoot,
 * which moves the draft to an edit workspace and marks it for a pending
 * save; the pane on the edit root then saves it once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { usePanesStore } from '../../../lib/panesStore'
import { useEditWorkspaceStore } from '../edit/edit-workspace-store'
import { ensureEditRoot } from '../edit/edit-workspace-switch'
import { explorerErrorCode, explorerErrorMessage, parseRootId, writeFile } from '../explorer-rpc'
import { createAutosave, type Autosave, type AutosaveReason } from './autosave'
import { draftKey, isDraftDirty, useCodeDrafts } from './code-drafts'
import { createSaveQueue } from './save-queue'
import { recordSelfWrite } from './self-write-registry'

type ErrorListener = (error: unknown) => void

const errorListeners = new Map<string, ErrorListener>()
const mountedPanes = new Map<string, number>()

function splitKey(key: string): { rootId: string; path: string } {
  const at = key.indexOf('\u0000')
  return { rootId: key.slice(0, at), path: key.slice(at + 1) }
}

function reportSaveError(key: string, error: unknown): void {
  const listener = errorListeners.get(key)
  if (listener) {
    listener(error)
    return
  }
  // The pane closed before its last save answered: the draft stays dirty in the store.
  const { path } = splitKey(key)
  const reason = explorerErrorCode(error) === 'DISK_CONFLICT' ? 'the file changed on disk' : explorerErrorMessage(error)
  toast.error(`Failed to save ${path}: ${reason}`)
}

export const codeSaveQueue = createSaveQueue({
  write: (key, req) => writeFile({ ...splitKey(key), ...req }),
  getBaseSignature: (key) => useCodeDrafts.getState().drafts[key]?.baseSignature ?? null,
  onSaved: (key, text, signature) => {
    recordSelfWrite(key, signature)
    useCodeDrafts.getState().saved(key, text, signature)
  },
  onError: reportSaveError,
})

const isDirty = (key: string) => isDraftDirty(useCodeDrafts.getState().drafts[key])

function dropIfUnused(key: string): void {
  if (!mountedPanes.has(key) && !isDirty(key)) useCodeDrafts.getState().drop(key)
}

export interface CodePaneSave {
  onChange(text: string): void
  onBlur(): void
  saveNow(): void
  /** Write the draft without the disk precondition (the banner's Overwrite). */
  overwrite(): void
  /** The last save was refused because the file changed on disk. */
  conflict: boolean
  clearConflict(): void
}

export function useCodePaneSave(opts: {
  rootId: string
  path: string
  workspaceId: string
  paneId: string
  writable: boolean
  preview: boolean
}): CodePaneSave {
  const { rootId, path, workspaceId, paneId, writable, preview } = opts
  const key = draftKey(rootId, path)
  const [conflict, setConflict] = useState(false)
  const autosave = useRef<Autosave | null>(null)
  const previewRef = useRef(preview)
  previewRef.current = preview

  // Declared before the mount bookkeeping below, so on unmount its cleanup
  // (the D-C19 flush) runs before the draft is considered for dropping.
  useEffect(() => {
    if (!writable) return
    const save = (reason: AutosaveReason) => {
      const draft = useCodeDrafts.getState().drafts[key]
      if (!draft) return
      if (parseRootId(rootId)?.kind === 'project') {
        void ensureEditRoot(rootId).catch(() => {}) // the toast is ensureEditRoot's; the draft stays dirty
        return
      }
      codeSaveQueue.enqueue(key, { text: draft.text, allowMissing: reason === 'explicit' })
    }
    const controller = createAutosave({ save, isDirty: () => isDirty(key) })
    autosave.current = controller
    errorListeners.set(key, (error) => {
      if (explorerErrorCode(error) === 'DISK_CONFLICT') setConflict(true)
      else toast.error(`Failed to save: ${explorerErrorMessage(error)}`)
    })
    return () => {
      controller.dispose()
      if (autosave.current === controller) autosave.current = null
      errorListeners.delete(key)
    }
  }, [key, writable, rootId])

  // PAN-5191: a root switch moved a dirty draft here; save it once. After the
  // effect above, so a DISK_CONFLICT answer reaches this pane's listener.
  const pending = useEditWorkspaceStore((s) => s.pending[key] === true)
  useEffect(() => {
    if (!writable || !pending) return
    if (!useEditWorkspaceStore.getState().consumePendingSave(key) || !isDirty(key)) return
    const draft = useCodeDrafts.getState().drafts[key]
    if (draft) codeSaveQueue.enqueue(key, { text: draft.text, allowMissing: false })
  }, [key, writable, pending])

  useEffect(() => {
    mountedPanes.set(key, (mountedPanes.get(key) ?? 0) + 1)
    return () => {
      const left = (mountedPanes.get(key) ?? 1) - 1
      if (left > 0) mountedPanes.set(key, left)
      else mountedPanes.delete(key)
      dropIfUnused(key)
      // A close flush may still be writing: drop the draft once it is clean.
      if (codeSaveQueue.isInFlight(key)) void codeSaveQueue.whenIdle(key).then(() => dropIfUnused(key))
    }
  }, [key])

  const onChange = useCallback(
    (text: string) => {
      const drafts = useCodeDrafts.getState()
      if (drafts.drafts[key]?.text === text) return
      drafts.edited(key, text)
      if (previewRef.current) usePanesStore.getState().updatePane(workspaceId, paneId, { explorerPreview: false })
      autosave.current?.changed()
    },
    [key, workspaceId, paneId],
  )
  const onBlur = useCallback(() => autosave.current?.blurred(), [])
  const saveNow = useCallback(() => autosave.current?.saveNow(), [])
  const overwrite = useCallback(() => {
    const draft = useCodeDrafts.getState().drafts[key]
    if (!writable || !draft || parseRootId(rootId)?.kind === 'project') return
    setConflict(false)
    codeSaveQueue.enqueue(key, { text: draft.text, allowMissing: true, overwrite: true })
  }, [key, writable, rootId])
  const clearConflict = useCallback(() => setConflict(false), [])

  return { onChange, onBlur, saveNow, overwrite, conflict, clearConflict }
}
