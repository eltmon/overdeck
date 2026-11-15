// One explorer tree row (PAN-5186, WI-B7). Folders show their dominant git
// color; files show the color and a one-letter badge (D-B10). Ignored rows
// are italic and dimmed. Badges are plain monospace letters, never pills.
// Files show a neutral extension label or glyph from fileIcons (PAN-5289).
// Folders lead with a chevron, files with a same-width spacer, and every depth
// level draws a 1 px indent guide; the git letter follows the name.

import { memo, type DragEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import {
  COMMITTED_ONLY_BADGE_CLASS,
  IGNORED_TEXT_CLASS,
  STATUS_LETTER,
  STATUS_TEXT_CLASS,
  type FileDecoration,
  type FolderDecoration,
} from '../git/git-decoration'
import type { TreeRow } from './explorer-tree-model'
import { fileIconFor } from './fileIcons'

export const ROW_HEIGHT = 22
export const INDENT_PX = 16
/** Row padding before depth 0. */
const BASE_PAD_PX = 6
/** Guide offset inside one indent level: the centre of the 14 px chevron. */
const GUIDE_OFFSET_PX = 7

function IndentGuides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          data-indent-guide
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-border"
          style={{ left: BASE_PAD_PX + level * INDENT_PX + GUIDE_OFFSET_PX }}
        />
      ))}
    </>
  )
}

export interface ExplorerRowProps {
  id: string
  row: TreeRow
  decoration: FileDecoration | FolderDecoration | undefined
  selected: boolean
  focused: boolean
  onClick(event: MouseEvent, row: TreeRow): void
  onDoubleClick(row: TreeRow): void
  onContextMenu(row: TreeRow): void
  /** Rows drag their paths on every root kind, so a project root can still drop paths in a composer (PAN-5190). */
  draggable?: boolean
  onDragStart?(event: DragEvent, row: TreeRow): void
  /** The folder a drag would drop into (PAN-5190, D-E14). */
  dropTarget?: boolean
  /** The scoped conversation changed this file, or files under this folder (PAN-5289). */
  changedHere?: 'file' | 'folder' | null
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
  draggable = false,
  onDragStart,
  dropTarget = false,
  changedHere = null,
}: ExplorerRowProps) {
  const isDir = row.kind === 'dir'
  const { Icon, label } = fileIconFor(row.name, row.kind, row.expanded)
  const iconTone = row.ignored ? 'text-faint-foreground' : 'text-muted-foreground'
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
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, row) : undefined}
      className={`list-row relative flex cursor-pointer select-none items-center gap-1.5 pr-2 text-xs ${
        selected ? 'bg-accent text-accent-foreground' : dropTarget ? 'bg-accent/60' : ''
      } ${focused || dropTarget ? 'outline outline-1 -outline-offset-1 outline-ring' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: BASE_PAD_PX + row.depth * INDENT_PX }}
      onClick={(e) => onClick(e, row)}
      onDoubleClick={() => onDoubleClick(row)}
      onContextMenu={() => onContextMenu(row)}
    >
      <IndentGuides depth={row.depth} />
      {isDir ? (
        row.expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden data-chevron="down" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden data-chevron="right" />
        )
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" aria-hidden data-chevron-spacer />
      )}
      {label ? (
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[9px] font-medium leading-none tracking-tighter ${iconTone}`} aria-hidden>
          {label}
        </span>
      ) : (
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconTone}`} aria-hidden />
      )}
      <span className={`min-w-0 truncate ${nameClass(row, decoration)}`} data-row-name>
        {row.name}
      </span>
      {letter && (
        <span className={`shrink-0 font-mono text-[11px] ${letterClass}`} aria-label={`git ${decoration?.status}`}>
          {letter}
        </span>
      )}
      {changedHere ? (
        <span
          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          aria-label={changedHere === 'file' ? 'Changed by this conversation' : 'Contains files this conversation changed'}
          data-changed-here={changedHere}
        />
      ) : (
        <span className="ml-auto" aria-hidden />
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
      style={{ height: ROW_HEIGHT, paddingLeft: BASE_PAD_PX + depth * INDENT_PX }}
    >
      Showing the first 10,000 entries
    </div>
  )
}
