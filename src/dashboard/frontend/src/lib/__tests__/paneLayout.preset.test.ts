import { describe, expect, it } from 'vitest'
import { collectLeafIds, leaf, presetLayout, presetOf, splitAtLeaf, updateRatio, type LayoutPreset } from '../paneLayout'

const IDS = ['a', 'b', 'c', 'd']

describe('presetLayout (PAN-5343 H-D7)', () => {
  it('builds One as a single leaf', () => {
    expect(presetLayout(IDS, 1)).toEqual({ kind: 'leaf', paneId: 'a' })
  })

  it('builds Two side by side as a 50/50 row split', () => {
    expect(presetLayout(IDS, 2)).toEqual({ kind: 'split', dir: 'row', a: leaf('a'), b: leaf('b'), ratio: 0.5 })
  })

  it('builds Three columns as equal thirds', () => {
    expect(presetLayout(IDS, 3)).toEqual({
      kind: 'split',
      dir: 'row',
      a: leaf('a'),
      b: { kind: 'split', dir: 'row', a: leaf('b'), b: leaf('c'), ratio: 0.5 },
      ratio: 1 / 3,
    })
  })

  it('builds Grid of four as a 2×2 grid', () => {
    expect(presetLayout(IDS, 4)).toEqual({
      kind: 'split',
      dir: 'col',
      a: { kind: 'split', dir: 'row', a: leaf('a'), b: leaf('b'), ratio: 0.5 },
      b: { kind: 'split', dir: 'row', a: leaf('c'), b: leaf('d'), ratio: 0.5 },
      ratio: 0.5,
    })
  })

  it.each([1, 2, 3, 4] as LayoutPreset[])('keeps the ids in input order for preset %i', (n) => {
    expect(collectLeafIds(presetLayout(IDS, n))).toEqual(IDS.slice(0, n))
  })

  it('throws when given too few ids', () => {
    expect(() => presetLayout(['a', 'b'], 3)).toThrow(Error)
    expect(() => presetLayout(['a', 'b'], 3)).toThrow('presetLayout needs 3 panes')
  })
})

describe('presetOf (PAN-5343 H-D7)', () => {
  it.each([1, 2, 3, 4] as LayoutPreset[])('recognises preset %i', (n) => {
    expect(presetOf(presetLayout(IDS, n))).toBe(n)
  })

  it.each([2, 3, 4] as LayoutPreset[])('recognises preset %i after a ratio change', (n) => {
    expect(presetOf(updateRatio(presetLayout(IDS, n), [], 0.7))).toBe(n)
  })

  it('returns 1 for a null layout', () => {
    expect(presetOf(null)).toBe(1)
  })

  it('returns null for a 3-leaf tree from two splits of the same leaf', () => {
    const tree = splitAtLeaf(splitAtLeaf(leaf('a'), 'a', 'b', 'row'), 'a', 'c', 'row')
    expect(collectLeafIds(tree)).toHaveLength(3)
    expect(presetOf(tree)).toBeNull()
  })

  it('returns null for a 2-leaf column split', () => {
    expect(presetOf(splitAtLeaf(leaf('a'), 'a', 'b', 'col'))).toBeNull()
  })
})
