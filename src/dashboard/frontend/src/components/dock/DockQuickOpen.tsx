// Go to file for the work dock (PAN-5289 §6.3).
//
// Searches the dock's root, or the deck's project root when the dock has none.
// With neither, opening it shows a toast and closes it again, so the Stage +
// menu and Ctrl+P share one behavior. A pick opens the file beside the chat;
// Shift+Enter reveals it in the Files tab. Files the scoped conversation
// changed rank first.

import { useEffect } from 'react'
import { toast } from 'sonner'

import { QuickOpen } from '../explorer/search/QuickOpen'
import { useStageDeck } from '../Stage/StageDeckContext'
import type { DockScope } from './dockScope'
import { useScopeChangedPaths } from './useConversationChanges'
import { useWorkDockStore } from './workDockStore'

export const NO_FILES_TOAST = 'No project files to search here.'

export interface DockQuickOpenProps {
  deckKey: string
  scope: DockScope
  open: boolean
  onClose(): void
}

export function DockQuickOpen({ deckKey, scope, open, onClose }: DockQuickOpenProps) {
  const deck = useStageDeck()
  const rootId = scope.rootId ?? scope.deckRootId
  const changedPaths = useScopeChangedPaths(scope, { open })

  useEffect(() => {
    if (!open || rootId) return
    toast(NO_FILES_TOAST)
    onClose()
  }, [open, rootId, onClose])

  if (!rootId) return null
  return (
    <QuickOpen
      rootId={rootId}
      open={open}
      onClose={onClose}
      changedPaths={changedPaths}
      onPick={(path) => deck?.openBeside?.({ rootId, path })}
      onReveal={(path) => useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path } })}
    />
  )
}
