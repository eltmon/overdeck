// Files tab of the work dock (PAN-5289 §6.8): the explorer for the dock's root.
//
// WorkDock renders this only when the scope has a root. Find in folder moves
// to the Search tab limited to that folder. Two things reveal a file: the
// active code pane (scope.revealPath) and a Reveal in files action (the
// store's `reveal`, written by openDock). A reveal is a one-shot request: it
// applies when its root is this tab's root and is then cleared, so it never
// writes a root override or re-applies after a tab change (B-D17). A caller
// revealing on another root sets the override itself before openDock.

import { useCallback, useEffect } from 'react'

import { ExplorerFiles } from '../explorer/ExplorerPane'
import { useExplorerStore } from '../explorer/explorerStore'
import type { DockScope } from './dockScope'
import { useScopeChangedPaths } from './useConversationChanges'
import { useWorkDockStore } from './workDockStore'

export interface FilesTabProps {
  deckKey: string
  scope: DockScope
}

export function FilesTab({ deckKey, scope }: FilesTabProps) {
  // The tab renders only while the dock is open; the dock publishes the same set (activeDock).
  const changedPaths = useScopeChangedPaths(scope, { open: true })
  const reveal = useWorkDockStore((s) => s.byDeck[deckKey]?.reveal)
  const rootId = scope.rootId
  useEffect(() => {
    if (!reveal || reveal.rootId !== rootId) return
    useExplorerStore.getState().revealPath(reveal.rootId, reveal.path)
    useWorkDockStore.getState().clearReveal(deckKey)
  }, [deckKey, reveal, rootId])
  const onFindInFolder = useCallback(
    (searchPath: string) => useWorkDockStore.getState().openDock(deckKey, { tab: 'search', searchPath }),
    [deckKey],
  )
  if (!scope.rootId) return null
  return (
    <ExplorerFiles
      key={scope.rootId}
      rootId={scope.rootId}
      deckKey={deckKey}
      changedPaths={changedPaths}
      conversationScope={scope.changes.kind === 'conversation'}
      revealPath={scope.revealPath}
      onFindInFolder={onFindInFolder}
    />
  )
}
