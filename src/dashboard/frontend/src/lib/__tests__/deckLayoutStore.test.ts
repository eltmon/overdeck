import { beforeEach, describe, expect, it } from 'vitest'
import { layoutStorageKey, resetDeckLayoutStore, selectDeckLayout, useDeckLayoutStore } from '../deckLayoutStore'
import { leaf, presetLayout } from '../paneLayout'

const DECK = '__all-projects__'

beforeEach(() => {
  localStorage.clear()
  resetDeckLayoutStore()
})

describe('deckLayoutStore (PAN-5343 H-D14)', () => {
  it('uses the pan-layout:<deck> storage key', () => {
    expect(layoutStorageKey('overdeck')).toBe('pan-layout:overdeck')
  })

  it('setLayout writes a 2-leaf tree through to localStorage', () => {
    const tree = presetLayout(['a', 'b'], 2)
    useDeckLayoutStore.getState().setLayout(DECK, tree)
    expect(selectDeckLayout(DECK)(useDeckLayoutStore.getState())).toEqual(tree)
    expect(JSON.parse(localStorage.getItem(`pan-layout:${DECK}`) ?? 'null')).toEqual(tree)
  })

  it('setLayout with a single leaf stores null and removes the key', () => {
    useDeckLayoutStore.getState().setLayout(DECK, presetLayout(['a', 'b'], 2))
    useDeckLayoutStore.getState().setLayout(DECK, leaf('a'))
    expect(selectDeckLayout(DECK)(useDeckLayoutStore.getState())).toBeNull()
    expect(localStorage.getItem(`pan-layout:${DECK}`)).toBeNull()
  })

  it('hydrateLayout re-reads storage written behind the store', () => {
    expect(useDeckLayoutStore.getState().hydrateLayout(DECK)).toBeNull()
    const tree = presetLayout(['a', 'b', 'c'], 3)
    localStorage.setItem(`pan-layout:${DECK}`, JSON.stringify(tree))
    expect(useDeckLayoutStore.getState().hydrateLayout(DECK)).toEqual(tree)
    expect(selectDeckLayout(DECK)(useDeckLayoutStore.getState())).toEqual(tree)
  })

  it('hydrateLayout drops an invalid or single-leaf stored layout', () => {
    localStorage.setItem(`pan-layout:${DECK}`, JSON.stringify(leaf('a')))
    expect(useDeckLayoutStore.getState().hydrateLayout(DECK)).toBeNull()
    localStorage.setItem(`pan-layout:${DECK}`, '{not json')
    expect(useDeckLayoutStore.getState().hydrateLayout(DECK)).toBeNull()
  })

  it('getLayout hydrates a deck not yet in memory, then serves memory', () => {
    const tree = presetLayout(['a', 'b'], 2)
    localStorage.setItem(`pan-layout:${DECK}`, JSON.stringify(tree))
    expect(useDeckLayoutStore.getState().getLayout(DECK)).toEqual(tree)
    localStorage.removeItem(`pan-layout:${DECK}`)
    expect(useDeckLayoutStore.getState().getLayout(DECK)).toEqual(tree)
  })

  it('noteFocus keeps most-recent-first order without duplicates', () => {
    const { noteFocus } = useDeckLayoutStore.getState()
    noteFocus(DECK, 'a')
    noteFocus(DECK, 'b')
    noteFocus(DECK, 'a')
    noteFocus(DECK, 'c')
    noteFocus(DECK, 'c')
    expect(useDeckLayoutStore.getState().focusHistoryByDeck[DECK]).toEqual(['c', 'a', 'b'])
  })

  it('noteFocus caps the history at 32 ids', () => {
    const { noteFocus } = useDeckLayoutStore.getState()
    for (let i = 0; i < 40; i++) noteFocus(DECK, `p${i}`)
    const history = useDeckLayoutStore.getState().focusHistoryByDeck[DECK]
    expect(history).toHaveLength(32)
    expect(history[0]).toBe('p39')
    expect(history[31]).toBe('p8')
  })
})
