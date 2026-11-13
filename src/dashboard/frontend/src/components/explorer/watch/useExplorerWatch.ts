// useExplorerWatch (PAN-5186, WI-B8): turns watch signals for a root into the
// directories whose listings changed. ExplorerPane re-lists the loaded ones.

import { useEffect, useRef } from 'react'
import type { ExplorerWatchEvent } from '@overdeck/contracts'

import { parentPath } from '../tree/explorer-tree-model'
import { subscribeExplorerWatch } from './explorer-watch-hub'

export interface ExplorerWatchHandlers {
  onDirsChanged(dirs: string[]): void
  onResync(): void
}

/** The directories whose listing an event batch changed. */
export function changedDirs(events: readonly ExplorerWatchEvent[]): string[] {
  const dirs = new Set<string>()
  for (const event of events) {
    dirs.add(parentPath(event.path))
    if (event.kind === 'rename' && event.oldPath !== undefined) dirs.add(parentPath(event.oldPath))
    // A deleted directory's own listing is gone too.
    if (event.kind === 'delete' && event.isDirectory) dirs.add(event.path)
  }
  return [...dirs]
}

export function useExplorerWatch(rootId: string | undefined, handlers: ExplorerWatchHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!rootId) return
    return subscribeExplorerWatch(rootId, (signal) => {
      if (signal.kind === 'resync') latest.current.onResync()
      else latest.current.onDirsChanged(changedDirs(signal.events))
    })
  }, [rootId])
}
