// The explorer's virtualized tree (PAN-5186, WI-B7; NFR-4).
//
// Renders the visible rows from projectRows/projectChangedRows with
// @tanstack/react-virtual, so a 10,000-row tree mounts only the rows in view.
// The scroll container is the ARIA tree: it holds keyboard focus and points
// aria-activedescendant at the focused row. It forwards its ref and extra
// props, so ExplorerContextMenu can wrap it as a Radix `asChild` trigger.

import {
  forwardRef,
  useCallback,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { isInlineRow, type InlineEdit, type InlineRow } from '../actions/inline-edit'
import type { SelectMode } from '../explorerStore'
import type { Decorations } from '../git/git-decoration'
import {
  getFirstChildIndex,
  getParentIndex,
  isTruncatedRow,
  type ExplorerTreeItem,
  type TreeRow,
} from './explorer-tree-model'
import { ExplorerRow, ExplorerTruncatedRow, ROW_HEIGHT } from './ExplorerRow'

/** What the tree passes to `renderInline` for a create row or the row being renamed (PAN-5190). */
export interface InlineRenderProps {
  depth: number
  kind: 'file' | 'dir'
  renamePath?: string
}

export type ExplorerTreeRowItem = ExplorerTreeItem | InlineRow

export interface ExplorerTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect' | 'onFocus' | 'onToggle'> {
  /** Projected rows, with the inline create row from `withInlineRow` when one is open. */
  rows: readonly ExplorerTreeRowItem[]
  decorations: Decorations
  selection: readonly string[]
  focused: string | null
  onToggle(path: string): void
  onSelect(path: string, mode: SelectMode): void
  onOpen(path: string): void
  /** A plain click on a file row: open it in the root's preview pane (PAN-5187). */
  onPreview?(path: string): void
  onFocus(path: string): void
  onContextMenuRow(path: string): void
  /** The open inline edit; a rename renders its row through `renderInline` (PAN-5190). */
  inlineEdit?: InlineEdit | null
  renderInline?(props: InlineRenderProps): ReactNode
}

/** A focusable row: not a truncated row and not an inline name row. */
function isTreeRow(row: ExplorerTreeRowItem | undefined): row is TreeRow {
  return !!row && !isInlineRow(row) && !isTruncatedRow(row)
}

export const ExplorerTree = forwardRef<HTMLDivElement, ExplorerTreeProps>(function ExplorerTree(
  {
    rows,
    decorations,
    selection,
    focused,
    onToggle,
    onSelect,
    onOpen,
    onPreview,
    onFocus,
    onContextMenuRow,
    inlineEdit = null,
    renderInline,
    className,
    onKeyDown,
    ...rest
  },
  forwardedRef,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const idPrefix = useId()
  const selected = useMemo(() => new Set(selection), [selection])

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const focusedIndex = useMemo(() => (focused === null ? -1 : rows.findIndex((r) => r.path === focused)), [rows, focused])

  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' })
  }, [focusedIndex, virtualizer])

  const rowId = (index: number) => `${idPrefix}-row-${index}`

  /** The next focusable row from `from` in direction `step`, skipping truncated rows. */
  const step = (from: number, delta: 1 | -1): number => {
    let i = from + delta
    while (i >= 0 && i < rows.length && !isTreeRow(rows[i])) i += delta
    return i >= 0 && i < rows.length ? i : -1
  }

  const handleRowClick = useCallback(
    (event: MouseEvent, row: TreeRow) => {
      if (event.shiftKey) onSelect(row.path, 'range')
      else if (event.ctrlKey || event.metaKey) onSelect(row.path, 'toggle')
      else {
        onSelect(row.path, 'replace')
        if (row.kind === 'dir') onToggle(row.path)
        else onPreview?.(row.path)
      }
    },
    [onSelect, onToggle, onPreview],
  )

  const handleRowDoubleClick = useCallback(
    (row: TreeRow) => {
      if (row.kind !== 'dir') onOpen(row.path)
    },
    [onOpen],
  )

  const handleRowContextMenu = useCallback((row: TreeRow) => onContextMenuRow(row.path), [onContextMenuRow])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || rows.length === 0) return
    const current = rows[focusedIndex]
    const row = isTreeRow(current) ? current : undefined
    const move = (index: number, extend: boolean) => {
      const target = rows[index]
      if (!isTreeRow(target)) return
      if (extend) onSelect(target.path, 'range')
      else onFocus(target.path)
    }

    switch (event.key) {
      case 'ArrowDown': {
        const next = step(focusedIndex, 1)
        if (next !== -1) move(next, event.shiftKey)
        break
      }
      case 'ArrowUp': {
        const prev = focusedIndex === -1 ? step(rows.length, -1) : step(focusedIndex, -1)
        if (prev !== -1) move(prev, event.shiftKey)
        break
      }
      case 'ArrowRight': {
        if (!row || row.kind !== 'dir') return
        if (!row.expanded) onToggle(row.path)
        else {
          const child = getFirstChildIndex(rows as readonly ExplorerTreeItem[], focusedIndex)
          if (child !== null) move(child, false)
        }
        break
      }
      case 'ArrowLeft': {
        if (!row) return
        if (row.kind === 'dir' && row.expanded) onToggle(row.path)
        else {
          const parent = getParentIndex(rows as readonly ExplorerTreeItem[], focusedIndex)
          if (parent !== null) move(parent, false)
        }
        break
      }
      case 'Enter': {
        if (!row) return
        if (row.kind === 'dir') onToggle(row.path)
        else onOpen(row.path)
        break
      }
      case ' ': {
        if (!row) return
        if (row.kind === 'dir') onToggle(row.path)
        else onSelect(row.path, 'toggle')
        break
      }
      default:
        return
    }
    event.preventDefault()
  }

  const virtualItems = virtualizer.getVirtualItems()
  // Point aria-activedescendant only at a mounted row: once the focused row
  // scrolls out of the virtual range its element is gone.
  const focusedMounted = focusedIndex >= 0 && virtualItems.some((item) => item.index === focusedIndex)

  return (
    <div
      {...rest}
      ref={setRefs}
      role="tree"
      tabIndex={0}
      aria-multiselectable
      aria-activedescendant={focusedMounted ? rowId(focusedIndex) : undefined}
      onKeyDown={handleKeyDown}
      className={`min-h-0 flex-1 overflow-auto outline-none ${className ?? ''}`}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualItems.map((item) => {
          const row = rows[item.index]
          if (!row) return null
          const renaming = inlineEdit?.mode === 'rename' && !isInlineRow(row) && !isTruncatedRow(row) && row.path === inlineEdit.path
          const inline = isInlineRow(row) || renaming
          return (
            <div
              key={row.path}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
                // The inline row's error line hangs below it, over the next row.
                zIndex: inline ? 1 : undefined,
              }}
            >
              {isInlineRow(row) ? (
                renderInline?.({ depth: row.depth, kind: row.kind })
              ) : renaming ? (
                renderInline?.({ depth: row.depth, kind: row.kind === 'dir' ? 'dir' : 'file', renamePath: row.path })
              ) : isTruncatedRow(row) ? (
                <ExplorerTruncatedRow depth={row.depth} />
              ) : (
                <ExplorerRow
                  id={rowId(item.index)}
                  row={row}
                  decoration={row.kind === 'dir' ? decorations.folders.get(row.path) : decorations.files.get(row.path)}
                  selected={selected.has(row.path)}
                  focused={item.index === focusedIndex}
                  onClick={handleRowClick}
                  onDoubleClick={handleRowDoubleClick}
                  onContextMenu={handleRowContextMenu}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
