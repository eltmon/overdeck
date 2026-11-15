// Files tab of the work dock (PAN-5289 §6.8): the explorer for the dock's root.
//
// WorkDock renders this only when the scope has a root. Find in folder moves
// to the Search tab limited to that folder.

import { useCallback } from 'react'

import { ExplorerFiles } from '../explorer/ExplorerPane'
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
