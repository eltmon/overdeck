// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/right-sidebar/file-explorer/tree/file-explorer-row-projection.ts @ c6b9ac9549b
/**
 * Explorer tree projection (PAN-5186, WI-B4).
 *
 * Turns the loaded directories of one root into the flat, ordered list of
 * visible rows the virtualized tree renders. Orca's projection reads its rows
 * from a store; this port takes the loaded directories and the expanded set
 * as plain input and builds the rows itself. The parent and first-child
 * lookups used by keyboard navigation keep Orca's depth-scan shape.
 */

import type { DirState } from '../explorerStore'
import { compareEntries } from './natural-sort'

export interface TreeRow {
  path: string
  name: string
  kind: 'file' | 'dir' | 'symlink'
  depth: number
  ignored: boolean
  expanded: boolean
  loading: boolean
  /** True for a folder the Changed filter synthesized from git status. */
  synthetic: boolean
}

/** "Showing the first 10,000 entries" after a truncated directory's children. */
export interface TruncatedRow {
  kind: 'truncated'
  path: string
  depth: number
}

export type ExplorerTreeItem = TreeRow | TruncatedRow

export function isTruncatedRow(row: ExplorerTreeItem): row is TruncatedRow {
  return row.kind === 'truncated'
}

/** 'a/b/c' → 'a/b', 'a' → '', '' → ''. */
export function parentPath(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

export function baseName(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}

function isDotName(name: string): boolean {
  return name.startsWith('.')
}

export function projectRows(input: {
  dirs: Readonly<Record<string, DirState>>
  expanded: ReadonlySet<string>
  showDotfiles: boolean
}): ExplorerTreeItem[] {
  const { dirs, expanded, showDotfiles } = input
  const rows: ExplorerTreeItem[] = []

  const walk = (dirPath: string, depth: number): void => {
    const dir = dirs[dirPath]
    if (!dir || dir.status !== 'ready') return
    const entries = [...dir.entries].sort(compareEntries)
    for (const entry of entries) {
      if (!showDotfiles && isDotName(entry.name)) continue
      const isDir = entry.kind === 'dir'
      const open = isDir && expanded.has(entry.path)
      const child = dirs[entry.path]
      rows.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        depth,
        ignored: entry.ignored,
        expanded: open,
        loading: open && child?.status !== 'ready' && child?.status !== 'error',
        synthetic: false,
      })
      if (open) walk(entry.path, depth + 1)
    }
    if (dir.truncated) rows.push({ kind: 'truncated', path: `${dirPath}\u0000truncated`, depth })
  }

  walk('', 0)
  return rows
}

/**
 * The Changed filter's rows (D-B8): every changed path plus each ancestor
 * folder, synthesized and expanded, sorted with the tree's rule. Rows come
 * from git status, not from the loaded directories, so deleted files show.
 */
export function projectChangedRows(
  paths: ReadonlyArray<{ path: string; isDeleted: boolean }>,
  showDotfiles: boolean,
): TreeRow[] {
  // children: dir path → child name → kind
  const children = new Map<string, Map<string, 'file' | 'dir'>>()
  const addChild = (dir: string, name: string, kind: 'file' | 'dir'): void => {
    let map = children.get(dir)
    if (!map) {
      map = new Map()
      children.set(dir, map)
    }
    if (map.get(name) !== 'dir') map.set(name, kind)
  }

  for (const { path } of paths) {
    if (!path) continue
    const segments = path.split('/')
    if (!showDotfiles && segments.some(isDotName)) continue
    let dir = ''
    for (let i = 0; i < segments.length - 1; i += 1) {
      addChild(dir, segments[i], 'dir')
      dir = dir ? `${dir}/${segments[i]}` : segments[i]
    }
    addChild(dir, segments[segments.length - 1], 'file')
  }

  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number): void => {
    const map = children.get(dir)
    if (!map) return
    const entries = [...map.entries()].map(([name, kind]) => ({ name, kind })).sort(compareEntries)
    for (const { name, kind } of entries) {
      const path = dir ? `${dir}/${name}` : name
      const isDir = kind === 'dir'
      rows.push({ path, name, kind, depth, ignored: false, expanded: isDir, loading: false, synthetic: isDir })
      if (isDir) walk(path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

// ─── Index lookups (Orca getParentIndex / getFirstChildIndex) ──────────────────

/** The index of the row's parent folder, or null at depth 0. */
export function getParentIndex(rows: readonly ExplorerTreeItem[], index: number): number | null {
  const current = rows[index]
  if (!current || current.depth <= 0) return null
  for (let i = index - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row && row.depth < current.depth) return i
  }
  return null
}

/** The index of an expanded folder's first child row, or null. */
export function getFirstChildIndex(rows: readonly ExplorerTreeItem[], index: number): number | null {
  const current = rows[index]
  if (!current || current.kind !== 'dir') return null
  const next = rows[index + 1]
  return next && next.depth === current.depth + 1 ? index + 1 : null
}
