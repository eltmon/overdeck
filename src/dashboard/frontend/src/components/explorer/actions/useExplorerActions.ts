/**
 * Explorer write actions (PAN-5190, FR-E1–FR-E7, D-E1–D-E7, D-E19, D-E20).
 *
 * `createExplorerActions` is a plain factory, testable without React; the
 * hook memoizes it over its deps. Every write RPC and upload goes through the
 * one `runWrite` seam (D-E3). On a `project` root (PAN-5191) a write never
 * reaches the primary checkout: `runWrite` and every action first switch to
 * the project's edit workspace (ensureEditRoot), then replay there.
 *
 * A rename or a move keeps open code panes on the file: it waits for each
 * affected draft's save, renames on disk, rekeys the drafts, then retargets
 * the panes (D-E5). Rekeying first means the old autosave controller finds no
 * draft under the old key when it disposes, so it sends nothing to a path
 * that no longer exists.
 *
 * Undo history lives in `undo-stack.ts`, never here: this factory is
 * re-created whenever its deps change, and two panes can share one root.
 */

import { useMemo } from 'react'
import { toast } from 'sonner'

import { usePanesStore } from '../../../lib/panesStore'
import { draftKey, useCodeDrafts } from '../code/code-drafts'
import { codeSaveQueue } from '../code/useCodePaneSave'
import { useEditWorkspaceStore } from '../edit/edit-workspace-store'
import { ensureEditRoot } from '../edit/edit-workspace-switch'
import {
  copyEntry,
  createEntry,
  explorerErrorCode,
  explorerErrorMessage,
  parseRootId,
  renameEntry,
  restoreEntry,
  trashPath,
} from '../explorer-rpc'
import { useExplorerStore } from '../explorerStore'
import { codePaneLabel } from '../openCodePane'
import { baseName, parentPath } from '../tree/explorer-tree-model'
import { duplicateName, isAtOrUnder, joinPath, planMoves, rewritePath, topLevelPaths } from './name-rules'
import * as history from './undo-stack'
import type { UndoStep } from './undo-stack'

export interface ExplorerActionsDeps {
  rootId: string
  /** False while the Changed filter is on (D-E2). Project roots write through an edit workspace. */
  writable: boolean
  /** Re-list these folders when they are loaded (ExplorerPane's reloadLoaded). */
  reloadDirs(paths: readonly string[]): void
  refreshGit(): void
  /** Open a file of `rootId` in a permanent code pane. */
  openFile(path: string, rootId: string): void
}

export interface ExplorerActions {
  writable: boolean
  runWrite<T>(op: (rootId: string) => Promise<T>): Promise<T>
  create(parentDir: string, name: string, kind: 'file' | 'dir'): Promise<void>
  rename(path: string, newName: string): Promise<void>
  duplicate(path: string, siblings: readonly string[]): Promise<void>
  /** Returns the op id for the toast's Undo action; '' when nothing moved. */
  remove(paths: readonly string[]): Promise<string>
  move(paths: readonly string[], destDir: string): Promise<void>
  /** Commit undo steps for entries created elsewhere, such as uploads (D-E7). */
  recordCreated(paths: readonly string[], label: string): string
  undo(): Promise<void>
  redo(): Promise<void>
  undoEntry(opId: string): Promise<void>
}

/** How many more copy names `duplicate` tries after an ALREADY_EXISTS answer (D-E12). */
const DUPLICATE_RETRIES = 10

function splitDraftKey(key: string): { rootId: string; path: string } {
  const at = key.indexOf('\u0000')
  return { rootId: key.slice(0, at), path: key.slice(at + 1) }
}

function countLabel(verb: string, paths: readonly string[], noun: string): string {
  return paths.length === 1 ? `${verb} of ${baseName(paths[0])}` : `${verb} of ${paths.length} ${noun}`
}

export function createExplorerActions(deps: ExplorerActionsDeps): ExplorerActions {
  const { rootId, writable } = deps
  const parsedRoot = parseRootId(rootId)
  const isProject = parsedRoot?.kind === 'project'

  /** PAN-5191: the same actions on an edit root of this project. */
  const actionsOn = (editRootId: string): ExplorerActions =>
    createExplorerActions({ ...deps, rootId: editRootId, reloadDirs: () => {}, refreshGit: () => {} })
  /** The edit root the last write from these actions went to; undo and redo follow it. */
  let lastEditRoot: string | null = null
  /** Op ids from a project-root delete, by the edit root that holds their history. */
  const opRoots = new Map<string, string>()
  const editActions = async (): Promise<ExplorerActions> => {
    lastEditRoot = await ensureEditRoot(rootId)
    return actionsOn(lastEditRoot)
  }
  /** History calls go to the edit root a write used, else the project's active one. */
  const historyActions = (editRootId?: string): ExplorerActions | null => {
    const target = editRootId ?? lastEditRoot ?? (parsedRoot ? useEditWorkspaceStore.getState().active[parsedRoot.key] : undefined)
    return target ? actionsOn(target) : null
  }

  const runWrite = async <T>(op: (id: string) => Promise<T>): Promise<T> => {
    if (isProject) {
      lastEditRoot = await ensureEditRoot(rootId)
      return op(lastEditRoot)
    }
    return op(rootId)
  }

  /** D-E19: re-list the affected folders and refresh git status after every write. */
  const afterWrite = (dirs: readonly string[]): void => {
    deps.reloadDirs([...new Set(dirs)])
    deps.refreshGit()
  }

  /** D-E5: rename `from` to `to` on disk, keeping open code panes and drafts on the file. */
  const applyMove = async (from: string, to: string): Promise<void> => {
    const affected = Object.keys(useCodeDrafts.getState().drafts).filter((key) => {
      const parts = splitDraftKey(key)
      return parts.rootId === rootId && isAtOrUnder(parts.path, from)
    })
    for (const key of affected) await codeSaveQueue.whenIdle(key)

    await runWrite((id) => renameEntry(id, from, to))

    const drafts = useCodeDrafts.getState()
    for (const key of affected) drafts.rekey(key, draftKey(rootId, rewritePath(splitDraftKey(key).path, from, to)))

    const panes = usePanesStore.getState()
    for (const [deck, deckPanes] of Object.entries(panes.panesByWorkspace)) {
      for (const pane of deckPanes) {
        if (pane.paneType !== 'code' || pane.explorerRootId !== rootId || !pane.explorerPath) continue
        if (!isAtOrUnder(pane.explorerPath, from)) continue
        const next = rewritePath(pane.explorerPath, from, to)
        panes.updatePane(deck, pane.paneId, { explorerPath: next, label: codePaneLabel(next) })
      }
    }

    useExplorerStore.getState().renamePaths(rootId, from, to)
    afterWrite([parentPath(from), parentPath(to)])
  }

  const moveStep = (from: string, to: string): UndoStep => ({
    undo: () => applyMove(to, from),
    redo: () => applyMove(from, to),
  })

  /** D-E7: undo of a created entry trashes it, so content written since survives a redo. */
  const createdStep = (path: string): UndoStep => {
    let trashId = ''
    return {
      undo: async () => {
        trashId = await runWrite((id) => trashPath(id, path))
        afterWrite([parentPath(path)])
      },
      redo: async () => {
        await runWrite((id) => restoreEntry(id, trashId))
        afterWrite([parentPath(path)])
      },
    }
  }

  /** D-E6: the trash id changes on every redo, so the step keeps the latest. */
  const deletedStep = (path: string, firstTrashId: string): UndoStep => {
    let trashId = firstTrashId
    return {
      undo: async () => {
        await runWrite((id) => restoreEntry(id, trashId))
        afterWrite([parentPath(path)])
      },
      redo: async () => {
        trashId = await runWrite((id) => trashPath(id, path))
        afterWrite([parentPath(path)])
      },
    }
  }

  const selectOnly = (path: string): void => useExplorerStore.getState().select(rootId, path, 'replace', [path])

  /** D-E20: run an undo-stack call and toast its outcome. */
  const runHistory = async (
    verb: 'Undid' | 'Redid',
    failVerb: 'undo' | 'redo',
    label: string | null,
    run: () => Promise<string | null>,
  ): Promise<void> => {
    if (isProject) return
    try {
      const done = await run()
      if (done !== null) toast(`${verb} ${done}`)
    } catch (error) {
      toast.error(`Couldn't ${failVerb} ${label ?? 'the last action'}: ${explorerErrorMessage(error)}`)
    }
  }

  const actions: ExplorerActions = {
    writable,
    runWrite,

    create: async (parentDir, name, kind) => {
      if (!writable) return
      const path = joinPath(parentDir, name)
      await runWrite((id) => createEntry(id, path, kind))
      selectOnly(path)
      if (kind === 'file') deps.openFile(path, rootId)
      history.commitOp(rootId, {
        label: `${kind === 'file' ? 'new file' : 'new folder'} ${name}`,
        steps: [createdStep(path)],
      })
      afterWrite([parentDir])
    },

    rename: async (path, newName) => {
      if (!writable) return
      const to = joinPath(parentPath(path), newName)
      if (to === path) return
      await applyMove(path, to)
      history.commitOp(rootId, { label: `rename of ${baseName(path)}`, steps: [moveStep(path, to)] })
    },

    duplicate: async (path, siblings) => {
      if (!writable) return
      const name = baseName(path)
      const dir = parentPath(path)
      for (let skip = 0; skip <= DUPLICATE_RETRIES; skip += 1) {
        const target = joinPath(dir, duplicateName(name, siblings, skip))
        try {
          await runWrite((id) => copyEntry(id, path, target))
        } catch (error) {
          if (explorerErrorCode(error) === 'ALREADY_EXISTS' && skip < DUPLICATE_RETRIES) continue
          toast.error(`Couldn't duplicate ${name}: ${explorerErrorMessage(error)}`)
          return
        }
        selectOnly(target)
        history.commitOp(rootId, { label: `duplicate of ${name}`, steps: [createdStep(target)] })
        afterWrite([dir])
        return
      }
    },

    remove: async (paths) => {
      if (!writable) return ''
      const steps: UndoStep[] = []
      const moved: string[] = []
      for (const path of topLevelPaths(paths)) {
        try {
          const trashId = await runWrite((id) => trashPath(id, path))
          steps.push(deletedStep(path, trashId))
          moved.push(path)
        } catch (error) {
          toast.error(`Couldn't delete ${path}: ${explorerErrorMessage(error)}`)
          break
        }
      }
      if (moved.length === 0) return ''
      afterWrite(moved.map(parentPath))
      return history.commitOp(rootId, { label: countLabel('delete', moved, 'items'), steps })
    },

    move: async (paths, destDir) => {
      if (!writable) return
      const { moves, intoItself } = planMoves(paths, destDir)
      intoItself.forEach(() => toast.error("Can't move a folder into itself."))
      const done: { from: string; to: string }[] = []
      for (const { from, to } of moves) {
        try {
          await applyMove(from, to)
          done.push({ from, to })
        } catch (error) {
          toast.error(`Couldn't move ${from}: ${explorerErrorMessage(error)}`)
          break
        }
      }
      if (done.length === 0) return
      history.commitOp(rootId, {
        label: countLabel('move', done.map((m) => m.from), 'items'),
        steps: done.map(({ from, to }) => moveStep(from, to)),
      })
    },

    recordCreated: (paths, label) => {
      if (isProject) {
        // An upload ran runWrite first, which switched the project to its edit root.
        return historyActions()?.recordCreated(paths, label) ?? ''
      }
      if (!writable || paths.length === 0) return ''
      afterWrite(paths.map(parentPath))
      return history.commitOp(rootId, { label, steps: paths.map(createdStep) })
    },

    undo: () => runHistory('Undid', 'undo', history.peekLabel(rootId, 'past'), () => history.undo(rootId)),
    redo: () => runHistory('Redid', 'redo', history.peekLabel(rootId, 'future'), () => history.redo(rootId)),
    undoEntry: (opId) =>
      runHistory('Undid', 'undo', history.peekLabel(rootId, 'past', opId), () => history.undoEntry(rootId, opId)),
  }

  if (!isProject) return actions
  return {
    ...actions,
    create: async (...args) => (await editActions()).create(...args),
    rename: async (...args) => (await editActions()).rename(...args),
    duplicate: async (...args) => (await editActions()).duplicate(...args),
    remove: async (...args) => {
      const opId = await (await editActions()).remove(...args)
      if (opId && lastEditRoot) opRoots.set(opId, lastEditRoot)
      return opId
    },
    move: async (...args) => (await editActions()).move(...args),
    undo: async () => historyActions()?.undo(),
    redo: async () => historyActions()?.redo(),
    undoEntry: async (opId) => historyActions(opRoots.get(opId))?.undoEntry(opId),
  }
}

export function useExplorerActions(deps: ExplorerActionsDeps): ExplorerActions {
  const { rootId, writable, reloadDirs, refreshGit, openFile } = deps
  return useMemo(
    () => createExplorerActions({ rootId, writable, reloadDirs, refreshGit, openFile }),
    [rootId, writable, reloadDirs, refreshGit, openFile],
  )
}
