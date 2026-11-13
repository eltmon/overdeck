// Pane-scoped explorer shortcuts (PAN-5186, WI-B13; D-B11).
//
// There is no keybinding registry: App.tsx binds only Cmd/Ctrl+K and +J, and
// useStageShortcuts ignores Ctrl and Shift combinations. So Cmd/Ctrl+P and
// Cmd/Ctrl+Shift+F live on the explorer pane's root `onKeyDown`, and fire only
// while focus is inside the pane. preventDefault() stops the print dialog.

import { useCallback, type KeyboardEvent } from 'react'

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function isQuickOpenKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p'
}

export function isContentSearchKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
}

export function useExplorerShortcuts({
  onQuickOpen,
  onContentSearch,
}: {
  onQuickOpen(): void
  onContentSearch(): void
}): (e: KeyboardEvent) => void {
  return useCallback(
    (e: KeyboardEvent) => {
      if (isQuickOpenKey(e)) {
        e.preventDefault()
        e.stopPropagation()
        onQuickOpen()
      } else if (isContentSearchKey(e)) {
        e.preventDefault()
        e.stopPropagation()
        onContentSearch()
      }
    },
    [onQuickOpen, onContentSearch],
  )
}
