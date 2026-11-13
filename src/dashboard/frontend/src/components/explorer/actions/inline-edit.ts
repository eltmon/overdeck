/**
 * The inline name row's place in the tree (PAN-5190, FR-E2, FR-E3, D-E10).
 *
 * Pure projection: a create edit inserts one inline row as the first child of
 * its folder, whether or not the folder's listing has loaded. A rename edit
 * changes no rows; the tree renders the renamed row itself as the input.
 */

import { isTruncatedRow, type ExplorerTreeItem } from '../tree/explorer-tree-model'

export type InlineEdit =
  | { mode: 'create'; kind: 'file' | 'dir'; parentDir: string }
  | { mode: 'rename'; path: string }

/** A create row. Its path, `${parentDir}\u0000new`, can never collide with a real path. */
export interface InlineRow {
  inline: true
  path: string
  depth: number
  kind: 'file' | 'dir'
}

export function isInlineRow(row: unknown): row is InlineRow {
  return typeof row === 'object' && row !== null && (row as { inline?: unknown }).inline === true
}

export function inlineRowPath(parentDir: string): string {
  return `${parentDir}\u0000new`
}

/**
 * Insert the create row as the first child of `edit.parentDir` (index 0 for
 * the root, ''). Rows are returned unchanged for a rename, for no edit, and
 * when the parent folder's row is not visible.
 */
export function withInlineRow(
  rows: readonly ExplorerTreeItem[],
  edit: InlineEdit | null,
): (ExplorerTreeItem | InlineRow)[] {
  if (!edit || edit.mode !== 'create') return [...rows]
  const inline = (depth: number): InlineRow => ({ inline: true, path: inlineRowPath(edit.parentDir), depth, kind: edit.kind })
  if (edit.parentDir === '') return [inline(0), ...rows]
  const parentIndex = rows.findIndex((row) => !isTruncatedRow(row) && row.path === edit.parentDir)
  if (parentIndex === -1) return [...rows]
  const parent = rows[parentIndex]
  return [...rows.slice(0, parentIndex + 1), inline(parent.depth + 1), ...rows.slice(parentIndex + 1)]
}
