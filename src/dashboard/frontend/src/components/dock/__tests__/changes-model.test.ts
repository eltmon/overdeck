import { describe, expect, it } from 'vitest'
import type { ChangeCommit, ConversationChanges, UncommittedFile } from '@overdeck/contracts'
import { ancestorFolders, changedPathsOf, diffTargetOf, diffTargetsOf, toRootPath } from '../changes-model'

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

describe('diffTargetOf / diffTargetsOf', () => {
  const sameRoot = (repoPath: string): string | null => repoPath
  const commit = (sha: string, pushed: boolean, paths: string[]): ChangeCommit => ({
    sha,
    shortSha: sha,
    subject: sha,
    authoredAt: '2026-11-15T00:00:00Z',
    pushed,
    attribution: 'trailer',
    files: paths.map(file),
  })
  const uncommitted = (path: string): UncommittedFile => ({ ...file(path), attribution: 'file', turnIds: [] })

  it('builds an uncommitted target with no sha', () => {
    const data = changes({ uncommitted: [uncommitted('a.ts')] })
    expect(diffTargetOf(data, file('a.ts'), undefined, sameRoot)).toEqual({ path: 'a.ts', repoPath: 'a.ts', repoRoot: '/r' })
  })

  it('builds a commit target with sha and pushed', () => {
    const c = commit('abc', true, ['b.ts'])
    expect(diffTargetOf(changes({ commits: [c] }), file('b.ts'), c, sameRoot)).toEqual({
      path: 'b.ts',
      repoPath: 'b.ts',
      repoRoot: '/r',
      sha: 'abc',
      pushed: true,
    })
  })

  it('marks a file outside the root and keeps its repo path', () => {
    expect(diffTargetOf(changes(), file('lib/y.ts'), undefined, () => null)).toEqual({
      path: 'lib/y.ts',
      repoPath: 'lib/y.ts',
      repoRoot: '/r',
      outsideRoot: true,
    })
  })

  it('lists uncommitted targets first, then each commit in order', () => {
    const data = changes({
      uncommitted: [uncommitted('u.ts')],
      commits: [commit('c1', true, ['p.ts']), commit('c2', false, ['q.ts', 'r.ts'])],
    })
    expect(diffTargetsOf(data, sameRoot).map((t) => [t.path, t.sha ?? null, t.pushed ?? null])).toEqual([
      ['u.ts', null, null],
      ['p.ts', 'c1', true],
      ['q.ts', 'c2', false],
      ['r.ts', 'c2', false],
    ])
  })
})
