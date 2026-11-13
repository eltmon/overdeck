import { describe, expect, it } from 'vitest'

import {
  duplicateName,
  isAtOrUnder,
  joinPath,
  planMoves,
  rewritePath,
  topLevelPaths,
  validateEntryName,
} from '../name-rules'

describe('joinPath', () => {
  it('joins at the root and under a folder', () => {
    expect(joinPath('', 'a')).toBe('a')
    expect(joinPath('src', 'a')).toBe('src/a')
  })
})

describe('validateEntryName', () => {
  it.each([
    ['', 'Enter a name.'],
    ['   ', 'Enter a name.'],
    ['.', 'This name is reserved.'],
    ['..', 'This name is reserved.'],
    ['a/b', 'Names cannot contain / or \\.'],
    ['a\\b', 'Names cannot contain / or \\.'],
    ['a\0b', 'Names cannot contain / or \\.'],
    ['.git', 'Overdeck does not write .git folders.'],
    ['.GIT', 'Overdeck does not write .git folders.'],
    ['b.ts', 'b.ts already exists here.'],
  ])('refuses %j with the D-E11 message', (raw, error) => {
    expect(validateEntryName(raw, ['b.ts', 'src'])).toEqual({ error })
  })

  it('trims a valid name', () => {
    expect(validateEntryName('  c.ts ', ['b.ts'])).toEqual({ name: 'c.ts' })
  })

  it('accepts renaming to the current name', () => {
    expect(validateEntryName('b.ts', ['b.ts', 'src'], 'b.ts')).toEqual({ name: 'b.ts' })
  })

  it('compares siblings exactly', () => {
    expect(validateEntryName('B.ts', ['b.ts'])).toEqual({ name: 'B.ts' })
  })
})

describe('duplicateName', () => {
  it('skips taken copy names', () => {
    expect(duplicateName('a.ts', ['a.ts'])).toBe('a copy.ts')
    expect(duplicateName('a.ts', ['a.ts', 'a copy.ts'])).toBe('a copy 2.ts')
    expect(duplicateName('a.ts', ['a.ts', 'a copy.ts', 'a copy 2.ts'])).toBe('a copy 3.ts')
  })

  it('keeps a leading dot in the stem and splits on the last dot', () => {
    expect(duplicateName('.env', ['.env'])).toBe('.env copy')
    expect(duplicateName('archive.tar.gz', ['archive.tar.gz'])).toBe('archive.tar copy.gz')
  })

  it('names a folder without a dot', () => {
    expect(duplicateName('src', ['src'])).toBe('src copy')
  })

  it('passes over the first n free candidates with skip', () => {
    expect(duplicateName('a.ts', ['a.ts', 'a copy 2.ts'], 1)).toBe('a copy 3.ts')
  })
})

describe('topLevelPaths', () => {
  it('drops descendants and duplicates, keeping order', () => {
    expect(topLevelPaths(['a/b', 'a', 'c'])).toEqual(['a', 'c'])
    expect(topLevelPaths(['c', 'c', 'ab', 'a'])).toEqual(['c', 'ab', 'a'])
  })
})

describe('planMoves', () => {
  it('omits a same-folder source and reports an into-itself source', () => {
    expect(planMoves(['src/inner/x.ts', 'src', 'lib/y.ts'], 'src/inner')).toEqual({
      moves: [{ from: 'lib/y.ts', to: 'src/inner/y.ts' }],
      intoItself: ['src'],
    })
    expect(planMoves(['dest/x.ts', 'a.ts'], 'dest')).toEqual({ moves: [{ from: 'a.ts', to: 'dest/a.ts' }], intoItself: [] })
  })

  it('reports a folder dropped on itself and moves to the root', () => {
    expect(planMoves(['src'], 'src')).toEqual({ moves: [], intoItself: ['src'] })
    expect(planMoves(['src/a.ts'], '')).toEqual({ moves: [{ from: 'src/a.ts', to: 'a.ts' }], intoItself: [] })
  })
})

describe('rewritePath and isAtOrUnder', () => {
  it('rewrites exact and descendant paths only', () => {
    expect(rewritePath('a', 'a', 'z')).toBe('z')
    expect(rewritePath('a/b/c.ts', 'a', 'z')).toBe('z/b/c.ts')
    expect(rewritePath('ab', 'a', 'z')).toBe('ab')
  })

  it('treats ab as outside a, and everything as under the root', () => {
    expect(isAtOrUnder('a/b', 'a')).toBe(true)
    expect(isAtOrUnder('a', 'a')).toBe(true)
    expect(isAtOrUnder('ab', 'a')).toBe(false)
    expect(isAtOrUnder('ab', '')).toBe(true)
  })
})
