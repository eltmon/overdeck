import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const live = vi.hoisted(() => ({ items: [] as unknown[], needsYouIds: new Set<string>() }))
vi.mock('../ConversationDock', () => ({
  ConversationDock: () => null,
  useLiveDockItems: () => ({ items: live.items, needsYouIds: live.needsYouIds }),
}))

import { useLiveTab } from '../LiveTab'
import { useConvoDock } from '../../../lib/convoDock'
import { useWorkDockStore } from '../workDockStore'

const DECK = 'p'
const item = (issueId: string) => ({ type: 'issue', issueId, agents: [] })

beforeEach(() => {
  localStorage.clear()
  live.items = []
  live.needsYouIds = new Set()
  useConvoDock.setState({ items: [], expanded: false })
  useWorkDockStore.setState({ byDeck: {} })
})

describe('useLiveTab', () => {
  it('is hidden with nothing to watch', () => {
    const { result } = renderHook(() => useLiveTab(DECK))
    expect(result.current).toEqual({ visible: false, count: 0, needsYou: false })
  })

  it('is visible with a count, and flags needs-you', () => {
    live.items = [item('PAN-1'), item('PAN-2')]
    live.needsYouIds = new Set(['pan-2'])
    const { result } = renderHook(() => useLiveTab(DECK))
    expect(result.current).toEqual({ visible: true, count: 2, needsYou: true })
  })

  it('opens the deck dock on Live when an item was popped into the dock, and resets the flag', () => {
    live.items = [item('PAN-1')]
    useConvoDock.setState({ expanded: true })
    renderHook(() => useLiveTab(DECK))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ open: true, tab: 'live' })
    expect(useConvoDock.getState().expanded).toBe(false)
  })

  it('only resets the flag when there is nothing to show', () => {
    useConvoDock.setState({ expanded: true })
    renderHook(() => useLiveTab(DECK))
    expect(useConvoDock.getState().expanded).toBe(false)
    expect(useWorkDockStore.getState().byDeck[DECK]).toBeUndefined()
  })
})
