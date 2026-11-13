import { describe, it, expect, beforeEach } from 'vitest'
import { useExplorerStore } from '../explorerStore'

const ROOT = 'issue:PAN-1'
const state = () => useExplorerStore.getState()
const root = () => state().roots[ROOT]

function resetStore(): void {
  useExplorerStore.setState({ roots: {} })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

describe('explorerStore persistence', () => {
  it('starts with the defaults when nothing is stored', () => {
    state().ensureRoot(ROOT)
    expect(root().expanded).toEqual([])
    expect(root().showDotfiles).toBe(true)
    expect(root().changedOnly).toBe(false)
  })

  it('persists an expanded folder and reads it back after a store reset', () => {
    state().ensureRoot(ROOT)
    state().setExpanded(ROOT, 'src', true)
    state().setShowDotfiles(ROOT, false)
    expect(JSON.parse(localStorage.getItem(`overdeck.explorer.${ROOT}`) ?? '{}')).toEqual({
      expanded: ['src'],
      showDotfiles: false,
    })

    resetStore()
    state().ensureRoot(ROOT)
    expect(root().expanded).toEqual(['src'])
    expect(root().showDotfiles).toBe(false)
  })

  it('hydrates the defaults from corrupt JSON', () => {
    localStorage.setItem(`overdeck.explorer.${ROOT}`, '{not json')
    state().ensureRoot(ROOT)
    expect(root().expanded).toEqual([])
    expect(root().showDotfiles).toBe(true)
  })

  it('does not persist the Changed filter', () => {
    state().ensureRoot(ROOT)
    state().setChangedOnly(ROOT, true)
    resetStore()
    state().ensureRoot(ROOT)
    expect(root().changedOnly).toBe(false)
  })
})

describe('explorerStore expanded set', () => {
  it('setExpanded closes a folder', () => {
    state().ensureRoot(ROOT)
    state().setExpandedMany(ROOT, ['a', 'b'])
    state().setExpanded(ROOT, 'a', false)
    expect(root().expanded).toEqual(['b'])
  })

  it('collapseAll empties the expanded set', () => {
    state().ensureRoot(ROOT)
    state().setExpandedMany(ROOT, ['a', 'a/b', 'c'])
    state().collapseAll(ROOT)
    expect(root().expanded).toEqual([])
    expect(JSON.parse(localStorage.getItem(`overdeck.explorer.${ROOT}`) ?? '{}').expanded).toEqual([])
  })
})

describe('explorerStore selection', () => {
  const order = ['a', 'a/x.ts', 'a/y.ts', 'b', 'c.ts']

  it('range selects the visibleOrder slice between the anchor and the target', () => {
    state().ensureRoot(ROOT)
    state().select(ROOT, 'a/x.ts', 'replace', order)
    state().select(ROOT, 'b', 'range', order)
    expect(root().selection).toEqual(['a/x.ts', 'a/y.ts', 'b'])
    expect(root().anchor).toBe('a/x.ts')
    state().select(ROOT, 'a', 'range', order)
    expect(root().selection).toEqual(['a', 'a/x.ts'])
  })

  it('toggle adds and removes one path', () => {
    state().ensureRoot(ROOT)
    state().select(ROOT, 'a', 'replace', order)
    state().select(ROOT, 'c.ts', 'toggle', order)
    expect(root().selection).toEqual(['a', 'c.ts'])
    state().select(ROOT, 'a', 'toggle', order)
    expect(root().selection).toEqual(['c.ts'])
  })

  it('replace selects only the target and focuses it', () => {
    state().ensureRoot(ROOT)
    state().select(ROOT, 'a', 'toggle', order)
    state().select(ROOT, 'b', 'toggle', order)
    state().select(ROOT, 'c.ts', 'replace', order)
    expect(root().selection).toEqual(['c.ts'])
    expect(root().focused).toBe('c.ts')
  })
})

describe('explorerStore directories', () => {
  it('setDir stores a listing and removeDir drops it', () => {
    state().ensureRoot(ROOT)
    state().setDir(ROOT, '', { status: 'ready', entries: [], truncated: false, absPath: '/r' })
    expect(root().dirs[''].status).toBe('ready')
    state().removeDir(ROOT, '')
    expect(root().dirs['']).toBeUndefined()
  })
})
