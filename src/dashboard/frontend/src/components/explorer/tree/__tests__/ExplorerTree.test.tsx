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
})
