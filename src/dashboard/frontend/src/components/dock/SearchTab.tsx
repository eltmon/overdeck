// Search tab of the work dock (PAN-5289 WI-14, FR-8): content search in the dock's root.
//
// Find in folder limits it to the store's searchPath; a hit opens beside the
// chat. Every openDock bumps openSeq, so Ctrl+Shift+F focuses the input again.

import { useCallback } from 'react'

import { ContentSearch, type ContentSearchTarget } from '../explorer/search/ContentSearch'
import { useStageDeck } from '../Stage/StageDeckContext'
import type { DockScope } from './dockScope'
import { useScopeChangedPaths } from './useConversationChanges'
import { useWorkDockStore } from './workDockStore'

export interface SearchTabProps {
  deckKey: string
  scope: DockScope
}

export function SearchTab({ deckKey, scope }: SearchTabProps) {
  const deck = useStageDeck()
  const searchPath = useWorkDockStore((s) => s.byDeck[deckKey]?.searchPath)
  const openSeq = useWorkDockStore((s) => s.byDeck[deckKey]?.openSeq ?? 0)
  // The tab renders only while the dock is open.
  const changedPaths = useScopeChangedPaths(scope, { open: true })
  const rootId = scope.rootId
  const onScopeClear = useCallback(() => useWorkDockStore.getState().openDock(deckKey, { tab: 'search' }), [deckKey])
  const onPick = useCallback(
    (target: ContentSearchTarget) => {
      if (rootId) deck?.openBeside?.({ rootId, path: target.path, line: target.line })
    },
    [deck, rootId],
  )
  if (!rootId) return null
  return (
    <ContentSearch
      key={rootId}
      rootId={rootId}
      scopePath={searchPath}
      onScopeClear={onScopeClear}
      onPick={onPick}
      changedPaths={changedPaths}
      focusSignal={openSeq}
    />
  )
}
