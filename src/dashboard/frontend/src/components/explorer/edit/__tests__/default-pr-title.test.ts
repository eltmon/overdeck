import { describe, expect, it } from 'vitest'
import { defaultPrTitle } from '../default-pr-title'

describe('defaultPrTitle', () => {
  it('names files generically when there are no paths', () => {
    expect(defaultPrTitle([])).toBe('chore: edit files')
  })

  it('names the one changed file by its basename', () => {
    expect(defaultPrTitle(['README.md'])).toBe('chore: edit README.md')
    expect(defaultPrTitle(['docs/guide/setup.md'])).toBe('chore: edit setup.md')
  })

  it('names the first file and counts the rest, without duplicates', () => {
    expect(defaultPrTitle(['src/a.ts', 'b.ts', 'c.ts', 'src/a.ts'])).toBe('chore: edit a.ts and 2 more files')
  })

  it('is at most 100 characters', () => {
    expect(defaultPrTitle([`${'x'.repeat(200)}.ts`])).toHaveLength(100)
  })
})
