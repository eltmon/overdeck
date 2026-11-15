// Files tab of the work dock (PAN-5289 §6.8): the explorer for the dock's root.
//
// WorkDock renders this only when the scope has a root. Find in folder moves
// to the Search tab limited to that folder.

import { useCallback } from 'react'

import { ExplorerFiles } from '../explorer/ExplorerPane'
import type { DockScope } from './dockScope'
import { useWorkDockStore } from './workDockStore'

export interface FilesTabProps {
  deckKey: string
  scope: DockScope
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export function FilesTab({ deckKey, scope }: FilesTabProps) {
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
      changedPaths={EMPTY_SET}
      conversationScope={scope.changes.kind === 'conversation'}
      revealPath={scope.revealPath}
      onFindInFolder={onFindInFolder}
    />
  )
}
