// One explorer tree row (PAN-5186, WI-B7). Folders show their dominant git
// color; files show the color and a one-letter badge (D-B10). Ignored rows
// are italic and dimmed. Badges are plain monospace letters, never pills.

import { memo, type MouseEvent } from 'react'
import { File, FileSymlink, Folder, FolderOpen } from 'lucide-react'

import {
  COMMITTED_ONLY_BADGE_CLASS,
  IGNORED_TEXT_CLASS,
  STATUS_LETTER,
  STATUS_TEXT_CLASS,
  type FileDecoration,
  type FolderDecoration,
} from '../git/git-decoration'
import type { TreeRow } from './explorer-tree-model'

export const ROW_HEIGHT = 22
const INDENT_PX = 12

export interface ExplorerRowProps {
  id: string
  row: TreeRow
  decoration: FileDecoration | FolderDecoration | undefined
  selected: boolean
  focused: boolean
  onClick(event: MouseEvent, row: TreeRow): void
  onDoubleClick(row: TreeRow): void
  onContextMenu(row: TreeRow): void
}

function nameClass(row: TreeRow, decoration: ExplorerRowProps['decoration']): string {
  if (decoration && !decoration.committedOnly) return STATUS_TEXT_CLASS[decoration.status]
  if (row.ignored) return IGNORED_TEXT_CLASS
  return 'text-foreground'
}

export const ExplorerRow = memo(function ExplorerRow({
  id,
  row,
  decoration,
  selected,
  focused,
  onClick,
  onDoubleClick,
  onContextMenu,
}: ExplorerRowProps) {
  const isDir = row.kind === 'dir'
  const Icon = isDir ? (row.expanded ? FolderOpen : Folder) : row.kind === 'symlink' ? FileSymlink : File
  const letter = !isDir && decoration ? STATUS_LETTER[decoration.status] : null
  const letterClass = decoration
    ? decoration.committedOnly
      ? COMMITTED_ONLY_BADGE_CLASS
      : STATUS_TEXT_CLASS[decoration.status]
    : ''

  return (
    <div
      id={id}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={isDir ? row.expanded : undefined}
      aria-selected={selected}
      aria-busy={row.loading || undefined}
      data-path={row.path}
      className={`list-row flex cursor-pointer select-none items-center gap-1.5 pr-2 text-xs ${
        selected ? 'bg-accent text-accent-foreground' : ''
      } ${focused ? 'outline outline-1 -outline-offset-1 outline-ring' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 6 + row.depth * INDENT_PX }}
      onClick={(e) => onClick(e, row)}
      onDoubleClick={() => onDoubleClick(row)}
      onContextMenu={() => onContextMenu(row)}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${row.ignored ? 'text-faint-foreground' : 'text-muted-foreground'}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate ${nameClass(row, decoration)}`}>{row.name}</span>
      {letter && (
        <span className={`shrink-0 font-mono text-[11px] ${letterClass}`} aria-label={`git ${decoration?.status}`}>
          {letter}
        </span>
      )}
    </div>
  )
})

/** "Showing the first 10,000 entries" after a truncated directory. Not focusable. */
export function ExplorerTruncatedRow({ depth }: { depth: number }) {
  return (
    <div
      role="none"
      className="flex items-center text-xs italic text-faint-foreground"
      style={{ height: ROW_HEIGHT, paddingLeft: 6 + depth * INDENT_PX }}
    >
      Showing the first 10,000 entries
    </div>
  )
}
