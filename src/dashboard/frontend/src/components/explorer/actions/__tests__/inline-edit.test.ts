import { describe, expect, it } from 'vitest'

import type { ExplorerTreeItem, TreeRow } from '../../tree/explorer-tree-model'
import { inlineRowPath, isInlineRow, withInlineRow } from '../inline-edit'

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

const ROWS: ExplorerTreeItem[] = [row('src', { kind: 'dir', expanded: true }), row('src/a.ts'), row('lib', { kind: 'dir' })]

describe('withInlineRow', () => {
  it('inserts a create row directly after its folder, one level deeper', () => {
    const rows = withInlineRow(ROWS, { mode: 'create', kind: 'file', parentDir: 'src' })
    expect(rows.map((r) => r.path)).toEqual(['src', inlineRowPath('src'), 'src/a.ts', 'lib'])
    expect(rows[1]).toEqual({ inline: true, path: 'src\u0000new', depth: 1, kind: 'file' })
    expect(isInlineRow(rows[1])).toBe(true)
    expect(isInlineRow(rows[0])).toBe(false)
  })

  it('inserts a root create row at index 0 with depth 0', () => {
    const rows = withInlineRow(ROWS, { mode: 'create', kind: 'dir', parentDir: '' })
    expect(rows[0]).toEqual({ inline: true, path: '\u0000new', depth: 0, kind: 'dir' })
    expect(rows).toHaveLength(4)
  })

  it('inserts under a collapsed folder whose listing has not loaded', () => {
    const rows = withInlineRow(ROWS, { mode: 'create', kind: 'file', parentDir: 'lib' })
    expect(rows.at(-1)).toMatchObject({ inline: true, depth: 1 })
  })

  it('leaves rows unchanged when the parent is not visible, for a rename and for no edit', () => {
    expect(withInlineRow(ROWS, { mode: 'create', kind: 'file', parentDir: 'missing' })).toEqual(ROWS)
    expect(withInlineRow(ROWS, { mode: 'rename', path: 'src/a.ts' })).toEqual(ROWS)
    expect(withInlineRow(ROWS, null)).toEqual(ROWS)
  })
})
