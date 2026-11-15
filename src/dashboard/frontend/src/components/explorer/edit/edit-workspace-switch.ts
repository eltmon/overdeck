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
 * Before step 1 the cursor, scroll and focus of every live editor on the old
 * root are carried to the new root, so the remounted panes keep them
 * (PAN-5290 C-D12).
 * A work-dock root override on the old root moves with them, keeping its anchor
 * pane (PAN-5289 B-D16, B-D17), and the mounted dock follows a project root it
 * was showing onto the edit root.
 * `leaveEditWorkspace` is the way back after a merge, discard or pipeline
 * send: it drops the edit root's drafts, clears dock overrides on the edit
 * root and points its panes at the project.
 */
import { toast } from 'sonner'

import { usePanesStore, type WorkspacePane } from '../../../lib/panesStore'
import { draftKey, isDraftDirty, useCodeDrafts } from '../code/code-drafts'
import { carryViewStates } from '../code/view-state-registry'
import { beginEdit, explorerErrorMessage, parseRootId, rootLabel } from '../explorer-rpc'
import { useExplorerStore } from '../explorerStore'
import { useActiveDock } from '../../dock/activeDock'
import { useWorkDockStore } from '../../dock/workDockStore'
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

/** Every deck whose dock override is `fromRootId` gets `toRootId` (undefined clears it); a moved override keeps its anchor. */
function moveDockOverrides(fromRootId: string, toRootId: string | undefined): void {
  const dock = useWorkDockStore.getState()
  for (const [deckKey, state] of Object.entries(dock.byDeck)) {
    if (state.rootOverride !== fromRootId) continue
    dock.setRootOverride(deckKey, toRootId, toRootId === undefined ? undefined : state.rootOverrideAnchor)
  }
}

/** Moves drafts, panes, dock overrides and the expanded set from one root to another. */
export function switchRoot(fromRootId: string, toRootId: string, opts: { name?: string } = {}): void {
  carryViewStates(fromRootId, toRootId)
  const drafts = useCodeDrafts.getState()
  const name = opts.name ?? rootLabel(toRootId)
  for (const [key, draft] of Object.entries(drafts.drafts)) {
    const { rootId, path } = splitDraftKey(key)
    if (rootId !== fromRootId) continue
    const target = draftKey(toRootId, path)
    const targetDirty = isDraftDirty(useCodeDrafts.getState().drafts[target])
    if (targetDirty && !isDraftDirty(draft)) {
      // A clean source has nothing to save: keep the unsaved target.
      useCodeDrafts.getState().drop(key)
      continue
    }
    if (targetDirty) {
      toast.warning(`Unsaved edits to ${path} in edit workspace ${name} were replaced by your newer edit.`)
    }
    useCodeDrafts.getState().rekey(key, target)
    if (isDraftDirty(draft)) useEditWorkspaceStore.getState().markPendingSave(target)
  }

  retargetPanes(fromRootId, toRootId)
  moveDockOverrides(fromRootId, toRootId)

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
      // B-D16: a mounted dock showing the project root follows it onto the edit root,
      // so a file created in the Files tab stays visible.
      const mounted = useActiveDock.getState().current
      if (!forceNew && mounted && mounted.rootId === projectRootId) {
        useWorkDockStore.getState().setRootOverride(mounted.deckKey, result.rootId, mounted.activePaneId ?? undefined)
      }
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

/** New edit workspace: points only this deck's work dock at a fresh edit root (FR-13). */
export async function openNewEditWorkspace(projectKey: string, deckKey: string): Promise<string> {
  const rootId = await ensureEditRoot(`project:${projectKey}`, { forceNew: true })
  useWorkDockStore.getState().setRootOverride(deckKey, rootId)
  return rootId
}

/** After merge, discard or pipeline send: drop the edit root's drafts and point its panes at the project. */
export function leaveEditWorkspace(editRootId: string, projectKey: string): void {
  for (const key of Object.keys(useCodeDrafts.getState().drafts)) {
    if (splitDraftKey(key).rootId === editRootId) useCodeDrafts.getState().drop(key)
  }
  // Cleared, not moved: the dock follows the active tab again.
  moveDockOverrides(editRootId, undefined)
  carryViewStates(editRootId, `project:${projectKey}`)
  retargetPanes(editRootId, `project:${projectKey}`)
  if (useEditWorkspaceStore.getState().active[projectKey] === editRootId) {
    useEditWorkspaceStore.getState().setActive(projectKey, null)
  }
}
