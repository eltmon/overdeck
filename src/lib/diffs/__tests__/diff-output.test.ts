import { describe, expect, it } from 'vitest'
import { diffOptionArgs, diffOptionsFromSearchParams, parseNumstatWithStatus } from '../diff-output.js'

describe('diffOptionArgs', () => {
  it('adds no args by default', () => {
    expect(diffOptionArgs()).toEqual([])
    expect(diffOptionArgs({})).toEqual([])
  })

  it('maps ignoreWhitespace to git -w', () => {
    expect(diffOptionArgs({ ignoreWhitespace: true })).toEqual(['-w'])
  })
})

describe('diffOptionsFromSearchParams', () => {
  it.each(['1', 'true'])('turns ignoreWhitespace=%s on', (value) => {
    expect(diffOptionsFromSearchParams(new URLSearchParams(`ignoreWhitespace=${value}`))).toEqual({ ignoreWhitespace: true })
  })

  it.each(['ignoreWhitespace=0', 'ignoreWhitespace=yes', 'ignoreWhitespace=', 'file=a.ts'])('leaves %s off', (query) => {
    expect(diffOptionsFromSearchParams(new URLSearchParams(query))).toEqual({})
  })
})

describe('parseNumstatWithStatus', () => {
  it('joins numstat rows with their status and sorts by path', () => {
    const numstat = '3\t1\tsrc/z.ts\n0\t4\tsrc/a.ts\n-\t-\timg.png\n'
    const nameStatus = 'M\tsrc/z.ts\nD\tsrc/a.ts\nA\timg.png\n'
    expect(parseNumstatWithStatus(numstat, nameStatus)).toEqual([
      { path: 'img.png', kind: 'A', additions: 0, deletions: 0 },
      { path: 'src/a.ts', kind: 'D', additions: 0, deletions: 4 },
      { path: 'src/z.ts', kind: 'M', additions: 3, deletions: 1 },
    ])
  })

  it('leaves kind undefined when name-status has no row for the path', () => {
    expect(parseNumstatWithStatus('1\t0\tonly.txt\n', '')).toEqual([
      { path: 'only.txt', kind: undefined, additions: 1, deletions: 0 },
    ])
  })
})
