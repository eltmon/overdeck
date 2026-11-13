import { describe, it, expect } from 'vitest'
import { buildDecorations, dominantStatus, STATUS_LETTER, STATUS_TEXT_CLASS } from '../git-decoration'

describe('dominantStatus', () => {
  it('ranks renamed above added and untracked', () => {
    expect(dominantStatus(['untracked', 'renamed', 'added'])).toBe('renamed')
  })

  it('ranks conflicted above deleted', () => {
    expect(dominantStatus(['deleted', 'conflicted', 'modified'])).toBe('conflicted')
  })

  it('returns null for no statuses', () => {
    expect(dominantStatus([])).toBeNull()
  })
})

describe('buildDecorations', () => {
  it('marks a folder with one modified and one untracked file as modified', () => {
    const { folders, files } = buildDecorations({
      entries: [
        { path: 'src/a.ts', status: 'modified', staged: false },
        { path: 'src/b.ts', status: 'untracked', staged: false },
      ],
      committed: [],
    })
    expect(folders.get('src')).toEqual({ status: 'modified', committedOnly: false })
    expect(files.get('src/b.ts')).toEqual({ status: 'untracked', staged: false, committedOnly: false })
  })

  it('propagates to every ancestor folder', () => {
    const { folders } = buildDecorations({ entries: [{ path: 'a/b/c.ts', status: 'deleted', staged: true }], committed: [] })
    expect(folders.get('a')?.status).toBe('deleted')
    expect(folders.get('a/b')?.status).toBe('deleted')
  })

  it('marks a committed-only file committedOnly', () => {
    const { files, folders } = buildDecorations({ entries: [], committed: [{ path: 'docs/x.md', status: 'added' }] })
    expect(files.get('docs/x.md')).toEqual({ status: 'added', staged: false, committedOnly: true })
    expect(folders.get('docs')).toEqual({ status: 'added', committedOnly: true })
  })

  it('lets a working-tree change override a committed change for the same path', () => {
    const { files, folders } = buildDecorations({
      entries: [{ path: 'docs/x.md', status: 'modified', staged: false }],
      committed: [{ path: 'docs/x.md', status: 'added' }],
    })
    expect(files.get('docs/x.md')).toEqual({ status: 'modified', staged: false, committedOnly: false })
    expect(folders.get('docs')).toEqual({ status: 'modified', committedOnly: false })
  })

  it('gives a folder its working-tree status when it also has committed-only descendants', () => {
    const { folders } = buildDecorations({
      entries: [{ path: 'src/a.ts', status: 'untracked', staged: false }],
      committed: [{ path: 'src/b.ts', status: 'deleted' }],
    })
    expect(folders.get('src')).toEqual({ status: 'untracked', committedOnly: false })
  })
})

describe('tables', () => {
  it('maps letters and colors', () => {
    expect(STATUS_LETTER.modified).toBe('M')
    expect(STATUS_TEXT_CLASS.modified).toBe('text-warning')
    expect(STATUS_TEXT_CLASS.untracked).toBe('text-success')
    expect(STATUS_TEXT_CLASS.conflicted).toBe('text-destructive')
  })
})
