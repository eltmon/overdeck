import { describe, expect, it } from 'vitest'
import type { ConversationChanges } from '@overdeck/contracts'
import { ancestorFolders, changedPathsOf, toRootPath } from '../changes-model'

function changes(over: Partial<ConversationChanges> = {}): ConversationChanges {
  return {
    conversation: 'c1',
    repoRoot: '/r',
    rootId: 'project:r',
    branch: 'main',
    scope: 'conversation',
    uncommitted: [],
    commits: [],
    totals: { files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 },
    ...over,
  }
}

const file = (path: string) => ({ path, status: 'M' as const, additions: 1, deletions: 0 })

describe('toRootPath', () => {
  it('strips the root folder prefix and drops paths outside it', () => {
    expect(toRootPath('/r', '/r/app', 'app/x.ts')).toBe('x.ts')
    expect(toRootPath('/r', '/r/app', 'lib/y.ts')).toBeNull()
  })

  it('keeps the path when the root is the repo or unknown', () => {
    expect(toRootPath('/r', '/r', 'app/x.ts')).toBe('app/x.ts')
    expect(toRootPath('/r/', '/r', 'app/x.ts')).toBe('app/x.ts')
    expect(toRootPath('/r', null, 'app/x.ts')).toBe('app/x.ts')
  })

  it('maps nothing when the root is outside the repo', () => {
    expect(toRootPath('/r', '/elsewhere', 'app/x.ts')).toBeNull()
  })
})

describe('changedPathsOf', () => {
  it('collects uncommitted and committed files as root paths', () => {
    const body = changes({
      uncommitted: [{ ...file('src/a.ts'), attribution: 'file', turnIds: [] }],
      commits: [
        {
          sha: 'abc',
          shortSha: 'abc',
          subject: 'x',
          authoredAt: '2026-11-14T00:00:00Z',
          pushed: false,
          attribution: 'trailer',
          files: [file('src/b.ts'), file('README.md')],
        },
      ],
    })
    expect(changedPathsOf(body, '/r')).toEqual(new Set(['src/a.ts', 'src/b.ts', 'README.md']))
    expect(changedPathsOf(body, '/r/src')).toEqual(new Set(['a.ts', 'b.ts']))
  })
})

describe('ancestorFolders', () => {
  it('lists every parent folder', () => {
    expect(ancestorFolders(['a/b/c.ts'])).toEqual(new Set(['a', 'a/b']))
    expect(ancestorFolders(['top.ts', 'x/y.ts'])).toEqual(new Set(['x']))
  })
})
