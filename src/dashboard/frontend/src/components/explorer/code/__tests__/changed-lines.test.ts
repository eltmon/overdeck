import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchChangedLines, toRepoPath } from '../changed-lines'

describe('toRepoPath (PAN-5290 C-D4)', () => {
  it('keeps the path when the root is the repo, with or without a trailing slash', () => {
    expect(toRepoPath('/home/u/p', '/home/u/p', 'docs/a.md')).toBe('docs/a.md')
    expect(toRepoPath('/home/u/p/', '/home/u/p', 'docs/a.md')).toBe('docs/a.md')
    expect(toRepoPath('/home/u/p', '/home/u/p/', 'docs/a.md')).toBe('docs/a.md')
  })

  it('prefixes the path when the root is a folder inside the repo', () => {
    expect(toRepoPath('/home/u/p', '/home/u/p/packages/core', 'src/a.ts')).toBe('packages/core/src/a.ts')
  })

  it('returns null for a root outside the repo, such as another worktree', () => {
    expect(toRepoPath('/home/u/p', '/home/u/p-edit', 'src/a.ts')).toBeNull()
    expect(toRepoPath('/home/u/p', '/home/u/.overdeck/workspaces/edit-1', 'src/a.ts')).toBeNull()
  })

  it('keeps the path while the root folder is unknown', () => {
    expect(toRepoPath('/home/u/p', null, 'src/a.ts')).toBe('src/a.ts')
  })
})

describe('fetchChangedLines', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the lines route with the encoded name and file', async () => {
    const fetchMock = vi.fn(async () => Response.json({ path: 'docs/a b.md', lines: [3] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchChangedLines('conv 1', 'docs/a b.md')).toEqual({ path: 'docs/a b.md', lines: [3] })
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv%201/changes/lines?file=docs%2Fa%20b.md')
  })

  it("throws the route's error on a non-2xx answer", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Invalid file' }, { status: 400 })))
    await expect(fetchChangedLines('c', '../x')).rejects.toThrow('Invalid file')
  })
})
