import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const virt = vi.hoisted(() => ({ visible: Number.POSITIVE_INFINITY }))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize?: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, virt.visible) }, (_, index) => ({ index, key: index, start: index * 22, size: estimateSize?.(index) ?? 22 })),
    getTotalSize: () => count * 22,
    scrollToIndex: () => {},
  }),
}))

import { ExplorerTree, type ExplorerTreeProps } from '../ExplorerTree'
import { buildDecorations, EMPTY_DECORATIONS } from '../../git/git-decoration'
import type { ExplorerTreeItem, TreeRow } from '../explorer-tree-model'
import { withInlineRow } from '../../actions/inline-edit'

function row(path: string, over: Partial<TreeRow> = {}): TreeRow {
  return {
    path,
    name: path.split('/').pop() ?? path,
    kind: 'file',
    depth: path.split('/').length - 1,
    ignored: false,
    expanded: false,
    loading: false,
    synthetic: false,
    ...over,
  }
}

const ROWS: ExplorerTreeItem[] = [
  row('src', { kind: 'dir', expanded: true }),
  row('src/a.ts'),
  row('src/b.ts'),
  row('lib', { kind: 'dir' }),
  row('dist', { kind: 'dir', ignored: true }),
]

function renderTree(over: Partial<ExplorerTreeProps> = {}) {
  const props: ExplorerTreeProps = {
    rows: ROWS,
    decorations: EMPTY_DECORATIONS,
    selection: [],
    focused: null,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onFocus: vi.fn(),
    onContextMenuRow: vi.fn(),
    ...over,
  }
  render(<ExplorerTree {...props} />)
  return props
}

const item = (name: string) => screen.getByText(name).closest('[role="treeitem"]') as HTMLElement

describe('ExplorerTree', () => {
  it('renders rows as treeitems with aria-level', () => {
    renderTree()
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem')).toHaveLength(5)
    expect(item('a.ts')).toHaveAttribute('aria-level', '2')
    expect(item('src')).toHaveAttribute('aria-expanded', 'true')
    expect(item('lib')).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows an extension label in place of the generic file glyph (PAN-5289)', () => {
    renderTree({ rows: [row('x.ts'), row('notes')] })
    expect(item('x.ts').textContent).toContain('TS')
    expect(item('x.ts').querySelector('svg')).toBeNull()
    expect(item('notes').querySelector('svg')).not.toBeNull()
  })

  it('indents 16 px per level and draws one guide per level (PAN-5289)', () => {
    renderTree({ rows: [row('a/b/c.ts')] })
    expect(item('c.ts')).toHaveStyle({ paddingLeft: '38px' })
    const guides = item('c.ts').querySelectorAll('[data-indent-guide]')
    expect(guides).toHaveLength(2)
    expect((guides[0] as HTMLElement).style.left).toBe('13px')
    expect((guides[1] as HTMLElement).style.left).toBe('29px')
  })

  it('leads folders with a chevron and files with a same-width spacer', () => {
    renderTree()
    expect(item('src').querySelector('[data-chevron="down"]')).not.toBeNull()
    expect(item('lib').querySelector('[data-chevron="right"]')).not.toBeNull()
    const spacer = item('a.ts').querySelector('[data-chevron-spacer]')
    expect(spacer).not.toBeNull()
    expect(spacer).toHaveClass('h-3.5', 'w-3.5')
    expect(item('src').querySelector('[data-chevron]')).toHaveClass('h-3.5', 'w-3.5')
  })

  it('puts the git letter right after the name', () => {
    renderTree({
      decorations: buildDecorations({ entries: [{ path: 'src/a.ts', status: 'modified', staged: false }], committed: [] }),
    })
    const name = item('a.ts').querySelector('[data-row-name]')
    expect(name?.nextElementSibling).toHaveAttribute('aria-label', 'git modified')
    expect(name?.nextElementSibling).toHaveTextContent('M')
    expect(name).not.toHaveClass('flex-1')
  })

  it('colors a modified file with its letter and its folder in the warning color', () => {
    renderTree({
      decorations: buildDecorations({ entries: [{ path: 'src/a.ts', status: 'modified', staged: false }], committed: [] }),
    })
    const badge = item('a.ts').querySelector('[aria-label="git modified"]')
    expect(badge).toHaveTextContent('M')
    expect(badge).toHaveClass('text-warning')
    expect(screen.getByText('a.ts')).toHaveClass('text-warning')
    expect(screen.getByText('src')).toHaveClass('text-warning')
    expect(item('src').querySelector('[aria-label^="git"]')).toBeNull()
  })

  it('mutes the letter of a committed-only file and keeps its name color', () => {
    renderTree({ decorations: buildDecorations({ entries: [], committed: [{ path: 'src/b.ts', status: 'added' }] }) })
    expect(item('b.ts').querySelector('[aria-label="git added"]')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('b.ts')).not.toHaveClass('text-success')
  })

  it('renders an ignored row italic', () => {
    renderTree()
    expect(screen.getByText('dist')).toHaveClass('italic')
  })

  it('renders a truncated row as text, not a treeitem', () => {
    renderTree({ rows: [row('a.ts'), { kind: 'truncated', path: '\u0000t', depth: 0 }] })
    expect(screen.getByText('Showing the first 10,000 entries')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem')).toHaveLength(1)
  })

  it('maps clicks to selection modes and toggles a folder on a plain click', () => {
    const props = renderTree()
    fireEvent.click(item('b.ts'), { shiftKey: true })
    expect(props.onSelect).toHaveBeenLastCalledWith('src/b.ts', 'range')
    fireEvent.click(item('a.ts'), { ctrlKey: true })
    expect(props.onSelect).toHaveBeenLastCalledWith('src/a.ts', 'toggle')
    fireEvent.click(item('lib'))
    expect(props.onSelect).toHaveBeenLastCalledWith('lib', 'replace')
    expect(props.onToggle).toHaveBeenCalledWith('lib')
  })

  it('previews a file on a plain click, but not on a modifier click or a folder click', () => {
    const onPreview = vi.fn()
    const props = renderTree({ onPreview })
    fireEvent.click(item('a.ts'))
    expect(props.onSelect).toHaveBeenLastCalledWith('src/a.ts', 'replace')
    expect(onPreview).toHaveBeenCalledWith('src/a.ts')
    fireEvent.click(item('b.ts'), { ctrlKey: true })
    fireEvent.click(item('b.ts'), { metaKey: true })
    fireEvent.click(item('b.ts'), { shiftKey: true })
    fireEvent.click(item('lib'))
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('opens a file on double click, and reports the row on right click', () => {
    const props = renderTree()
    fireEvent.doubleClick(item('a.ts'))
    expect(props.onOpen).toHaveBeenCalledWith('src/a.ts')
    fireEvent.doubleClick(item('lib'))
    expect(props.onOpen).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(item('b.ts'))
    expect(props.onContextMenuRow).toHaveBeenCalledWith('src/b.ts')
  })

  it('expands a collapsed folder on ArrowRight and opens a file on Enter', () => {
    const lib = renderTree({ focused: 'lib' })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowRight' })
    expect(lib.onToggle).toHaveBeenCalledWith('lib')
  })

  it('opens the focused file on Enter', () => {
    const props = renderTree({ focused: 'src/a.ts' })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Enter' })
    expect(props.onOpen).toHaveBeenCalledWith('src/a.ts')
  })

  it('moves focus with the arrows, to the first child and to the parent', () => {
    const down = renderTree({ focused: 'src/a.ts' })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })
    expect(down.onFocus).toHaveBeenLastCalledWith('src/b.ts')
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown', shiftKey: true })
    expect(down.onSelect).toHaveBeenLastCalledWith('src/b.ts', 'range')
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowLeft' })
    expect(down.onFocus).toHaveBeenLastCalledWith('src')
  })

  it('drops aria-activedescendant while the focused row is outside the rendered range', () => {
    virt.visible = 2
    try {
      renderTree({ focused: 'lib' })
      expect(screen.getAllByRole('treeitem')).toHaveLength(2)
      expect(screen.getByRole('tree')).not.toHaveAttribute('aria-activedescendant')
    } finally {
      virt.visible = Number.POSITIVE_INFINITY
    }
  })

  it('points aria-activedescendant at the focused row', () => {
    renderTree({ focused: 'src/b.ts' })
    expect(screen.getByRole('tree').getAttribute('aria-activedescendant')).toBe(item('b.ts').id)
  })

  it('renders an inline create row through renderInline, and ArrowDown skips it', () => {
    const rows = withInlineRow(ROWS, { mode: 'create', kind: 'file', parentDir: 'src' })
    const renderInline = vi.fn(({ depth }: { depth: number }) => <input aria-label="inline" data-depth={depth} />)
    const props = renderTree({ rows, focused: 'src', inlineEdit: { mode: 'create', kind: 'file', parentDir: 'src' }, renderInline })
    expect(screen.getByLabelText('inline')).toHaveAttribute('data-depth', '1')
    expect(screen.getAllByRole('treeitem')).toHaveLength(5)
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })
    expect(props.onFocus).toHaveBeenLastCalledWith('src/a.ts')
  })

  it('renders the renamed row through renderInline with its path', () => {
    const renderInline = vi.fn(({ renamePath }: { renamePath?: string }) => <input aria-label="rename" defaultValue={renamePath} />)
    renderTree({ inlineEdit: { mode: 'rename', path: 'src/a.ts' }, renderInline })
    expect(screen.getByLabelText('rename')).toHaveValue('src/a.ts')
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(renderInline).toHaveBeenCalledWith({ depth: 1, kind: 'file', renamePath: 'src/a.ts' })
  })

  it('renders rows draggable when a drag handler is set, on any root kind', () => {
    const onRowDragStart = vi.fn()
    renderTree({ onRowDragStart })
    expect(item('a.ts')).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(item('a.ts'))
    expect(onRowDragStart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: 'src/a.ts' }))
  })

  it('renders rows not draggable without a drag handler', () => {
    renderTree()
    expect(item('a.ts')).toHaveAttribute('draggable', 'false')
  })

  it('highlights the drop folder row only', () => {
    renderTree({ dropDir: 'src' })
    expect(item('src')).toHaveClass('bg-accent/60')
    expect(item('lib')).not.toHaveClass('bg-accent/60')
  })
})
