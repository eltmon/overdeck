/**
 * The explorer's drag payload (PAN-5190, FR-E6, FR-E9, D-E15).
 *
 * A tree row drag carries two DataTransfer types: root-relative paths, one per
 * line, for a conversation composer, and `{ rootId, paths }` JSON for a drag
 * move within the same tree. It sets no `text/plain`, so text fields elsewhere
 * in the dashboard ignore the drag.
 *
 * This module imports nothing from components/, so both the explorer and the
 * composer can import it without a cycle.
 */

export const EXPLORER_PATHS_MIME = 'application/x-overdeck-paths'
export const EXPLORER_MOVE_MIME = 'application/x-overdeck-explorer'

export function setExplorerDragData(dt: DataTransfer, rootId: string, paths: readonly string[]): void {
  dt.setData(EXPLORER_PATHS_MIME, paths.join('\n'))
  dt.setData(EXPLORER_MOVE_MIME, JSON.stringify({ rootId, paths: [...paths] }))
  dt.effectAllowed = 'copyMove'
}

/** True when a drag carries explorer paths. Browsers list types in lowercase during dragover. */
export function hasDragPaths(types: readonly string[]): boolean {
  return types.includes(EXPLORER_PATHS_MIME)
}

export function hasExplorerMove(types: readonly string[]): boolean {
  return types.includes(EXPLORER_MOVE_MIME)
}

/** The dragged paths, or null when the drag carries none. */
export function readDragPaths(dt: Pick<DataTransfer, 'getData'>): string[] | null {
  const paths = dt
    .getData(EXPLORER_PATHS_MIME)
    .split('\n')
    .filter((line) => line.length > 0)
  return paths.length > 0 ? paths : null
}

/** The move payload, or null when it is missing or malformed. */
export function readExplorerMove(dt: Pick<DataTransfer, 'getData'>): { rootId: string; paths: string[] } | null {
  const raw = dt.getData(EXPLORER_MOVE_MIME)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { rootId, paths } = parsed as Record<string, unknown>
    if (typeof rootId !== 'string') return null
    if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === 'string')) return null
    return { rootId, paths }
  } catch {
    return null
  }
}
