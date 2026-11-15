import { describe, expect, it } from 'vitest'
import cases from './file-match-cases.json'
import { fileMatchTier, matchRanges, rankFileMatches } from '../fileMatch'

describe('fileMatchTier (shared case table)', () => {
  it.each(cases as Array<{ path: string; query: string; tier: number | null }>)('$path ~ "$query" → tier $tier', ({ path, query, tier }) => {
    expect(fileMatchTier(path, query)).toBe(tier)
  })

  it('covers every tier, a slash query, a case-insensitive match and a non-match', () => {
    const tiers = new Set(cases.map((c) => c.tier))
    for (const tier of [0, 1, 2, 3, 4, null]) expect(tiers.has(tier)).toBe(true)
    expect(cases.some((c) => c.query.includes('/'))).toBe(true)
    expect(cases.some((c) => c.query !== c.query.toLowerCase() && c.tier !== null)).toBe(true)
    expect(cases.length).toBeGreaterThanOrEqual(12)
  })
})

describe('rankFileMatches', () => {
  it('orders by tier, then changed-here first, keeping the given order otherwise', () => {
    expect(rankFileMatches(['a/foo.ts', 'b/foo.ts', 'foo'], 'foo', new Set(['b/foo.ts']))).toEqual(['foo', 'b/foo.ts', 'a/foo.ts'])
    expect(rankFileMatches(['a/foo.ts', 'b/foo.ts'], 'foo', new Set())).toEqual(['a/foo.ts', 'b/foo.ts'])
  })

  it('never lifts a changed tier-2 path above a tier-1 path, and drops non-matches', () => {
    expect(rankFileMatches(['src/myfoo.ts', 'src/foo.ts', 'src/zzz.ts'], 'foo', new Set(['src/myfoo.ts']))).toEqual(['src/foo.ts', 'src/myfoo.ts'])
  })
})

describe('matchRanges', () => {
  it('returns one range over the basename match', () => {
    const path = 'src/FooBar.ts'
    const ranges = matchRanges(path, 'bar')
    expect(ranges).toEqual([[7, 10]])
    expect(path.slice(...ranges[0])).toBe('Bar')
  })

  it('returns one range over the path match for tier 3', () => {
    const path = 'src/lib/foo.ts'
    const ranges = matchRanges(path, 'lib/foo')
    expect(ranges.map(([s, e]) => path.slice(s, e))).toEqual(['lib/foo'])
  })

  it('returns one range per matched character for a fuzzy match', () => {
    const path = 'src/lib/foo.ts'
    const ranges = matchRanges(path, 'slf')
    expect(ranges).toEqual([
      [0, 1],
      [4, 5],
      [8, 9],
    ])
  })

  it('returns nothing for a non-match', () => {
    expect(matchRanges('src/foo.ts', 'zzz')).toEqual([])
  })
})
