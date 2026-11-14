/**
 * Root switch for edit workspaces (PAN-5191, WI-F9).
 *
 * A `project:<key>` root never writes the primary checkout. The first save
 * or file action calls `ensureEditRoot`, which asks the server for an edit
 * workspace and then moves everything bound to the project root onto it:
 *   1. drafts are re-keyed first, so the old pane's unmount flush finds
 *      nothing under the old key; a dirty one is marked for a pending save;
 *   2. explorer and code panes are retargeted (or closed when the deck
 *      already has the same pane on the edit root);
 *   3. the expanded-folder set is copied.
 * `leaveEditWorkspace` is the way back after a merge, discard or pipeline
 * send: it drops the edit root's drafts and points its panes at the project.
 */
import { toast } from 'sonner'

import { usePanesStore, type WorkspacePane } from '../../../lib/panesStore'
import { draftKey, isDraftDirty, useCodeDrafts } from '../code/code-drafts'
import { beginEdit, explorerErrorMessage, parseRootId, rootLabel } from '../explorer-rpc'
import { useExplorerStore } from '../explorerStore'
import { useEditWorkspaceStore } from './edit-workspace-store'

function splitDraftKey(key: string): { rootId: string; path: string } {
  const at = key.indexOf('\u0000')
  return { rootId: key.slice(0, at), path: key.slice(at + 1) }
}

function isSwitchable(pane: WorkspacePane): boolean {
  return pane.paneType === 'files' || pane.paneType === 'code'
}

/** Step 2: retarget every explorer and code pane on `fromRootId`, closing duplicates. */
function retargetPanes(fromRootId: string, toRootId: string): void {
  const store = usePanesStore.getState()
  for (const [deck, panes] of Object.entries(store.panesByWorkspace)) {
    for (const pane of panes) {
      if (pane.explorerRootId !== fromRootId || !isSwitchable(pane)) continue
      const current = usePanesStore.getState().panesByWorkspace[deck] ?? []
      const duplicate = current.some(
        (p) =>
          p.paneId !== pane.paneId &&
          p.paneType === pane.paneType &&
          p.explorerRootId === toRootId &&
          (pane.paneType !== 'code' || p.explorerPath === pane.explorerPath),
      )
      if (duplicate) usePanesStore.getState().closePane(deck, pane.paneId)
      else usePanesStore.getState().updatePane(deck, pane.paneId, { explorerRootId: toRootId })
    }
  }
}

/** Moves drafts, panes and the expanded set from one root to another. */
export function switchRoot(fromRootId: string, toRootId: string, opts: { name?: string } = {}): void {
  const drafts = useCodeDrafts.getState()
  const name = opts.name ?? rootLabel(toRootId)
  for (const [key, draft] of Object.entries(drafts.drafts)) {
    const { rootId, path } = splitDraftKey(key)
    if (rootId !== fromRootId) continue
    const target = draftKey(toRootId, path)
    if (isDraftDirty(useCodeDrafts.getState().drafts[target])) {
      toast.warning(`Unsaved edits to ${path} in edit workspace ${name} were replaced by your newer edit.`)
    }
    useCodeDrafts.getState().rekey(key, target)
    if (isDraftDirty(draft)) useEditWorkspaceStore.getState().markPendingSave(target)
  }

  retargetPanes(fromRootId, toRootId)

  const explorer = useExplorerStore.getState()
  const expanded = explorer.roots[fromRootId]?.expanded ?? []
  explorer.ensureRoot(toRootId)
  if (expanded.length > 0) useExplorerStore.getState().setExpandedMany(toRootId, expanded)
}

const inFlight = new Map<string, Promise<string>>()

/**
 * The edit root for a project root, created or reused on the server. Shared
 * per project key unless `forceNew`. Without `forceNew` the project root's
 * panes and drafts switch to it.
 */
export function ensureEditRoot(projectRootId: string, opts: { forceNew?: boolean } = {}): Promise<string> {
  const parsed = parseRootId(projectRootId)
  if (parsed?.kind !== 'project') return Promise.reject(new Error(`${projectRootId} is not a project root`))
  const projectKey = parsed.key
  const forceNew = opts.forceNew ?? false
  if (!forceNew) {
    const shared = inFlight.get(projectKey)
    if (shared) return shared
  }
  const run = (async () => {
    const store = useEditWorkspaceStore.getState()
    store.setCreating(projectKey, true)
    try {
      const result = await beginEdit(projectKey, forceNew)
      if (!forceNew) switchRoot(projectRootId, result.rootId, { name: result.name })
      useEditWorkspaceStore.getState().setActive(projectKey, result.rootId)
      return result.rootId
    } catch (error) {
      toast.error(`Couldn't create an edit workspace: ${explorerErrorMessage(error)}`)
      throw error
    } finally {
      useEditWorkspaceStore.getState().setCreating(projectKey, false)
    }
  })()
  if (!forceNew) {
    inFlight.set(projectKey, run)
    void run.then(
      () => inFlight.delete(projectKey),
      () => inFlight.delete(projectKey),
    )
  }
  return run
}

/** New edit workspace: points only this explorer pane at a fresh edit root (FR-13). */
export async function openNewEditWorkspace(projectKey: string, deckKey: string, paneId: string): Promise<string> {
  const rootId = await ensureEditRoot(`project:${projectKey}`, { forceNew: true })
  usePanesStore.getState().updatePane(deckKey, paneId, { explorerRootId: rootId })
  return rootId
}

/** After merge, discard or pipeline send: drop the edit root's drafts and point its panes at the project. */
export function leaveEditWorkspace(editRootId: string, projectKey: string): void {
  for (const key of Object.keys(useCodeDrafts.getState().drafts)) {
    if (splitDraftKey(key).rootId === editRootId) useCodeDrafts.getState().drop(key)
  }
  retargetPanes(editRootId, `project:${projectKey}`)
  if (useEditWorkspaceStore.getState().active[projectKey] === editRootId) {
    useEditWorkspaceStore.getState().setActive(projectKey, null)
  }
}
