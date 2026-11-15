// Files tab of the work dock (PAN-5289 §6.8): the explorer for the dock's root.
//
// WorkDock renders this only when the scope has a root. Find in folder moves
// to the Search tab limited to that folder. Two things reveal a file: the
// active code pane (scope.revealPath) and a Reveal in files action (the
// store's `reveal`, written by openDock with each openSeq). A reveal on
// another root first points the dock at that root, anchored to the active tab.

import { useCallback, useEffect } from 'react'

import { ExplorerFiles } from '../explorer/ExplorerPane'
import { useExplorerStore } from '../explorer/explorerStore'
import { useActiveDock } from './activeDock'
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
  const openSeq = useWorkDockStore((s) => s.byDeck[deckKey]?.openSeq ?? 0)
  const rootId = scope.rootId
  useEffect(() => {
    if (!reveal) return
    if (reveal.rootId !== rootId) {
      const anchor = useActiveDock.getState().current?.activePaneId ?? undefined
      useWorkDockStore.getState().setRootOverride(deckKey, reveal.rootId, anchor)
      return
    }
    useExplorerStore.getState().revealPath(reveal.rootId, reveal.path)
    // openSeq: a second Reveal of the same path selects it again.
  }, [deckKey, reveal, rootId, openSeq])
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
