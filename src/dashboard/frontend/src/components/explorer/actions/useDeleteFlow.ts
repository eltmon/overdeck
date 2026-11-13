/**
 * Delete with confirmation and an undo toast (PAN-5190, FR-E5, D-E8, D-E9).
 *
 * One clean item deletes at once. Two or more items, or any item with an
 * unsaved code-pane draft at or under it, confirm first. After a delete, an
 * 8-second toast offers Undo, which undoes that op even when newer ops sit
 * above it in the history.
 */

import { useCallback } from 'react'
import { toast } from 'sonner'

import { useConfirm } from '../../DialogProvider'
import { isDraftDirty, useCodeDrafts } from '../code/code-drafts'
import { baseName } from '../tree/explorer-tree-model'
import { isAtOrUnder, topLevelPaths } from './name-rules'
import { peekLabel } from './undo-stack'
import type { ExplorerActions } from './useExplorerActions'

export const DELETE_TOAST_MS = 8000

/** Paths of this root's dirty drafts at or under any of `top`. */
function dirtyDraftPaths(rootId: string, top: readonly string[]): string[] {
  const out: string[] = []
  for (const [key, draft] of Object.entries(useCodeDrafts.getState().drafts)) {
    const at = key.indexOf('\u0000')
    if (key.slice(0, at) !== rootId || !isDraftDirty(draft)) continue
    const path = key.slice(at + 1)
    if (top.some((base) => isAtOrUnder(path, base))) out.push(path)
  }
  return out.sort()
}

/** "a.ts" or "3 items", from the op's label, so a partial delete reports what moved. */
function movedSubject(rootId: string, opId: string, fallback: string): string {
  const label = peekLabel(rootId, 'past', opId)
  return label?.startsWith('delete of ') ? label.slice('delete of '.length) : fallback
}

export function useDeleteFlow(actions: ExplorerActions, rootId: string): (paths: readonly string[]) => Promise<void> {
  const confirm = useConfirm()
  return useCallback(
    async (paths: readonly string[]) => {
      if (!actions.writable) return
      const top = topLevelPaths(paths)
      if (top.length === 0) return
      const dirty = dirtyDraftPaths(rootId, top)
      if (top.length > 1 || dirty.length > 0) {
        const lines = [...top]
        if (dirty.length > 0) lines.push('', `Unsaved edits in: ${dirty.join(', ')}`)
        const ok = await confirm({
          title: top.length === 1 ? `Delete ${baseName(top[0])}?` : `Delete ${top.length} items?`,
          message: lines.join('\n'),
          confirmLabel: 'Delete',
          variant: 'destructive',
        })
        if (!ok) return
      }
      const opId = await actions.remove(top)
      if (opId === '') return
      const subject = movedSubject(rootId, opId, top.length === 1 ? baseName(top[0]) : `${top.length} items`)
      toast(`Moved ${subject} to the Overdeck trash`, {
        duration: DELETE_TOAST_MS,
        action: { label: 'Undo', onClick: () => void actions.undoEntry(opId) },
      })
    },
    [actions, confirm, rootId],
  )
}
