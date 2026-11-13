// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/right-sidebar/file-explorer/mutations/file-explorer-drag-edge-scroll.ts @ c6b9ac9549b
/**
 * Explorer drag and drop (PAN-5190, FR-E6, FR-E8, D-E10, D-E13–D-E15).
 *
 * A row drag carries the dragged paths (lib/explorer-drag-paths). The drop
 * zone wraps the tree body: it moves rows dropped on a folder, hands OS files
 * to `onFiles`, expands a collapsed folder after 600 ms of hover, and scrolls
 * the tree near its top and bottom edges. Only `getDragEdgeScrollTarget` is
 * ported from Orca.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'

import { hasExplorerMove, readExplorerMove, setExplorerDragData } from '../../../lib/explorer-drag-paths'
import { parentPath } from '../tree/explorer-tree-model'
import { topLevelPaths } from './name-rules'

export const HOVER_EXPAND_MS = 600
export const DRAG_EDGE_ZONE_PX = 24

export const FOREIGN_ROOT_MESSAGE = 'Files can only be moved within the same tree.'

/** D-E15: the whole selection when the dragged row is in it, else the dragged row alone. */
export function dragPathsFor(rowPath: string, selection: readonly string[]): string[] {
  return selection.includes(rowPath) ? topLevelPaths(selection) : [rowPath]
}

export function startRowDrag(dt: DataTransfer, rootId: string, rowPath: string, selection: readonly string[]): void {
  setExplorerDragData(dt, rootId, dragPathsFor(rowPath, selection))
}

/** Orca's edge scroll: the next scrollTop while dragging near an edge, or null. */
export function getDragEdgeScrollTarget({
  scrollTop,
  scrollHeight,
  clientHeight,
  localY,
  edgeZonePx = DRAG_EDGE_ZONE_PX,
}: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  localY: number
  edgeZonePx?: number
}): number | null {
  let delta = 0
  if (localY < edgeZonePx) {
    const strength = (edgeZonePx - localY) / edgeZonePx
    delta = -(1.25 + strength * 9)
  } else if (localY > clientHeight - edgeZonePx) {
    const strength = (localY - (clientHeight - edgeZonePx)) / edgeZonePx
    delta = 1.25 + strength * 9
  }
  if (delta === 0) return null
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const nextScrollTop = Math.max(0, Math.min(maxScroll, scrollTop + delta))
  return nextScrollTop === scrollTop ? null : nextScrollTop
}

/** D-E10: a folder row is the target; a file row targets its parent; blank space the root. */
export function resolveDropDir(rowPath: string | null, rowKind: 'file' | 'dir' | 'symlink' | null): string {
  if (rowPath === null) return ''
  return rowKind === 'dir' ? rowPath : parentPath(rowPath)
}

export interface TreeDropZoneOptions {
  rootId: string
  writable: boolean
  changedOnly: boolean
  getRow(path: string): { kind: 'file' | 'dir' | 'symlink'; expanded: boolean } | undefined
  expand(path: string): void
  onMove(paths: string[], destDir: string): void
  /** OS files dropped; the caller decides read-only handling (D-E16). */
  onFiles?(dt: DataTransfer, destDir: string): void
}

export interface TreeDropZone {
  /** The folder a drop would land in while a drag is over the zone; '' is the root. */
  dropDir: string | null
  zoneProps: {
    onDragOver(event: DragEvent<HTMLElement>): void
    onDragLeave(event: DragEvent<HTMLElement>): void
    onDrop(event: DragEvent<HTMLElement>): void
  }
}

type DragKind = 'move' | 'files' | null

function rowPathOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('[data-path]')?.getAttribute('data-path') ?? null) : null
}

export function useTreeDropZone(opts: TreeDropZoneOptions): TreeDropZone {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [dropDir, setDropDir] = useState<string | null>(null)
  const timerRef = useRef<{ path: string; id: ReturnType<typeof setTimeout> } | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current.id)
    timerRef.current = null
  }, [])
  const reset = useCallback(() => {
    clearTimer()
    setDropDir(null)
  }, [clearTimer])
  useEffect(() => clearTimer, [clearTimer])

  /** Which drop this zone accepts for the drag's types, or null when it accepts none. */
  const acceptedKind = (types: readonly string[]): DragKind => {
    const o = optsRef.current
    if (hasExplorerMove(types)) return o.writable ? 'move' : null
    if (types.includes('Files')) return o.onFiles ? 'files' : null
    return null
  }

  const targetDir = (target: EventTarget | null): { dir: string; hoverFolder: string | null } => {
    const path = rowPathOf(target)
    const row = path === null ? undefined : optsRef.current.getRow(path)
    const dir = resolveDropDir(path, row?.kind ?? null)
    return { dir, hoverFolder: row && row.kind === 'dir' && !row.expanded && path !== null ? path : null }
  }

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const kind = acceptedKind(Array.from(event.dataTransfer.types))
      if (!kind) return
      event.preventDefault()
      event.dataTransfer.dropEffect = kind === 'move' ? 'move' : 'copy'
      const { dir, hoverFolder } = targetDir(event.target)
      setDropDir(dir)

      const expandPath = optsRef.current.changedOnly ? null : hoverFolder
      if (timerRef.current?.path !== expandPath) {
        clearTimer()
        if (expandPath !== null) {
          timerRef.current = {
            path: expandPath,
            id: setTimeout(() => {
              timerRef.current = null
              optsRef.current.expand(expandPath)
            }, HOVER_EXPAND_MS),
          }
        }
      }

      const tree = event.currentTarget.querySelector('[role="tree"]')
      if (tree instanceof HTMLElement) {
        const localY = event.clientY - tree.getBoundingClientRect().top
        if (localY >= 0 && localY <= tree.clientHeight) {
          const next = getDragEdgeScrollTarget({
            scrollTop: tree.scrollTop,
            scrollHeight: tree.scrollHeight,
            clientHeight: tree.clientHeight,
            localY,
            edgeZonePx: DRAG_EDGE_ZONE_PX,
          })
          if (next !== null) tree.scrollTop = next
        }
      }
    },
    // acceptedKind and targetDir read only optsRef, so they need no deps.
    [clearTimer],
  )

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const related = event.relatedTarget
      if (related instanceof Node && event.currentTarget.contains(related)) return
      reset()
    },
    [reset],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const kind = acceptedKind(Array.from(event.dataTransfer.types))
      if (!kind) return
      event.preventDefault()
      const { dir } = targetDir(event.target)
      reset()
      const o = optsRef.current
      if (kind === 'files') {
        // Synchronous: DataTransfer items are unreadable once the handler returns.
        o.onFiles?.(event.dataTransfer, dir)
        return
      }
      const payload = readExplorerMove(event.dataTransfer)
      if (!payload) return
      if (payload.rootId !== o.rootId) {
        toast.error(FOREIGN_ROOT_MESSAGE)
        return
      }
      o.onMove(payload.paths, dir)
    },
    // acceptedKind and targetDir read only optsRef, so they need no deps.
    [reset],
  )

  return { dropDir, zoneProps: { onDragOver, onDragLeave, onDrop } }
}
