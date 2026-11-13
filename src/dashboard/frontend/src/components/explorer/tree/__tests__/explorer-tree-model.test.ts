import { describe, it, expect } from 'vitest'
import type { ExplorerEntry } from '@overdeck/contracts'
import type { DirState } from '../../explorerStore'
import {
  getFirstChildIndex,
  getParentIndex,
  isTruncatedRow,
  parentPath,
  projectChangedRows,
  projectRows,
  type ExplorerTreeItem,
} from '../explorer-tree-model'

function entry(path: string, kind: ExplorerEntry['kind'] = 'file', ignored = false): ExplorerEntry {
  return { name: path.split('/').pop() ?? path, path, kind, mtimeMs: 0, ignored }
}

function dir(entries: ExplorerEntry[], truncated = false): DirState {
  return { status: 'ready', entries, truncated, absPath: '/r' }
}

const paths = (rows: ExplorerTreeItem[]) => rows.map((r) => r.path)

describe('projectRows', () => {
  it('puts directories first and sorts names naturally', () => {
    const rows = projectRows({
      dirs: { '': dir([entry('file100'), entry('z', 'dir'), entry('file9'), entry('file99')]) },
      expanded: new Set(),
      showDotfiles: true,
    })
    expect(paths(rows)).toEqual(['z', 'file9', 'file99', 'file100'])
  })

  it('flattens an expanded folder after it at depth + 1', () => {
    const dirs = {
      '': dir([entry('src', 'dir'), entry('README.md')]),
      src: dir([entry('src/b.ts'), entry('src/a.ts')]),
    }
    const rows = projectRows({ dirs, expanded: new Set(['src']), showDotfiles: true })
    expect(paths(rows)).toEqual(['src', 'src/a.ts', 'src/b.ts', 'README.md'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0])
    expect((rows[0] as { expanded: boolean }).expanded).toBe(true)
  })

  it('hides the children of a collapsed folder', () => {
    const dirs = { '': dir([entry('src', 'dir')]), src: dir([entry('src/a.ts')]) }
    expect(paths(projectRows({ dirs, expanded: new Set(), showDotfiles: true }))).toEqual(['src'])
  })

  it('marks an expanded folder without a ready listing as loading', () => {
    const dirs = { '': dir([entry('src', 'dir')]) }
    const [row] = projectRows({ dirs, expanded: new Set(['src']), showDotfiles: true })
    expect(row).toMatchObject({ path: 'src', expanded: true, loading: true })
  })

  it('drops dot entries when showDotfiles is false', () => {
    const dirs = { '': dir([entry('.github', 'dir'), entry('.env'), entry('a.ts')]) }
    expect(paths(projectRows({ dirs, expanded: new Set(), showDotfiles: false }))).toEqual(['a.ts'])
    expect(paths(projectRows({ dirs, expanded: new Set(), showDotfiles: true }))).toEqual(['.github', '.env', 'a.ts'])
  })

  it('appends one TruncatedRow after a truncated directory’s children', () => {
    const dirs = {
      '': dir([entry('big', 'dir'), entry('z.ts')]),
      big: dir([entry('big/1.ts'), entry('big/2.ts')], true),
    }
    const rows = projectRows({ dirs, expanded: new Set(['big']), showDotfiles: true })
    expect(rows.map((r) => (isTruncatedRow(r) ? 'TRUNCATED' : r.path))).toEqual(['big', 'big/1.ts', 'big/2.ts', 'TRUNCATED', 'z.ts'])
    expect(rows.filter(isTruncatedRow)).toHaveLength(1)
    expect(rows[3].depth).toBe(1)
  })

  it('carries the ignored flag', () => {
    const rows = projectRows({ dirs: { '': dir([entry('dist', 'dir', true)]) }, expanded: new Set(), showDotfiles: true })
    expect(rows[0]).toMatchObject({ ignored: true })
  })
})

describe('projectChangedRows', () => {
  it('synthesizes every ancestor folder, expanded, in order', () => {
    const rows = projectChangedRows([{ path: 'src/a/b.ts', isDeleted: false }], true)
    expect(rows.map((r) => r.path)).toEqual(['src', 'src/a', 'src/a/b.ts'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2])
    expect(rows[0]).toMatchObject({ kind: 'dir', synthetic: true, expanded: true })
    expect(rows[1]).toMatchObject({ kind: 'dir', synthetic: true, expanded: true })
    expect(rows[2]).toMatchObject({ kind: 'file', synthetic: false })
  })

  it('merges shared ancestors and sorts with the tree rule', () => {
    const rows = projectChangedRows(
      [
        { path: 'z.ts', isDeleted: false },
        { path: 'src/b.ts', isDeleted: true },
        { path: 'src/a.ts', isDeleted: false },
      ],
      true,
    )
    expect(rows.map((r) => r.path)).toEqual(['src', 'src/a.ts', 'src/b.ts', 'z.ts'])
  })

  it('drops dot paths when showDotfiles is false', () => {
    const rows = projectChangedRows([{ path: '.github/ci.yml', isDeleted: false }, { path: 'a.ts', isDeleted: false }], false)
    expect(rows.map((r) => r.path)).toEqual(['a.ts'])
  })
})

describe('helpers', () => {
  it('parentPath returns the containing directory', () => {
    expect(parentPath('a/b/c')).toBe('a/b')
    expect(parentPath('a')).toBe('')
  })

  it('getParentIndex and getFirstChildIndex follow depth', () => {
    const rows = projectChangedRows([{ path: 'src/a.ts', isDeleted: false }], true)
    expect(getParentIndex(rows, 1)).toBe(0)
    expect(getParentIndex(rows, 0)).toBeNull()
    expect(getFirstChildIndex(rows, 0)).toBe(1)
    expect(getFirstChildIndex(rows, 1)).toBeNull()
  })
})
