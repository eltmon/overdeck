/**
 * Write-action keys while the explorer tree has focus (PAN-5190, FR-E3,
 * FR-E5, FR-E7, D-E18).
 *
 * F2 renames the single selected row; Delete, or Meta+Backspace, deletes the
 * selection; Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Only keys aimed at
 * the tree element itself count, so typing in an inline name input (whose
 * keys stop at the input anyway) or any other child never triggers them.
 */

import { useCallback, type KeyboardEvent } from 'react'

export interface TreeActionKeyOptions {
  writable: boolean
  isProjectRoot: boolean
  getSelection(): readonly string[]
  startRename(path: string): void
  requestDelete(paths: readonly string[]): void
  undo(): void
  redo(): void
}

export function useTreeActionKeys({
  writable,
  isProjectRoot,
  getSelection,
  startRename,
  requestDelete,
  undo,
  redo,
}: TreeActionKeyOptions): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.target !== event.currentTarget) return
      const selection = getSelection()
      const handled = (run: () => void) => {
        event.preventDefault()
        run()
      }

      if (event.key === 'F2') {
        if (writable && selection.length === 1) handled(() => startRename(selection[0]))
        return
      }
      if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)) {
        if (writable && selection.length > 0) handled(() => requestDelete(selection))
        return
      }
      if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        if (!isProjectRoot) handled(event.shiftKey ? redo : undo)
      }
    },
    [writable, isProjectRoot, getSelection, startRename, requestDelete, undo, redo],
  )
}
