import { afterEach, describe, expect, it } from 'vitest'
import { useActiveDock, type ActiveDock } from '../activeDock'

function dock(deckKey: string): ActiveDock {
  return {
    deckKey,
    activePaneId: null,
    rootId: `project:${deckKey}`,
    changedPaths: new Set<string>(),
    openFile: () => {},
    revealFile: () => {},
  }
}

describe('activeDock', () => {
  afterEach(() => {
    useActiveDock.setState({ current: null })
  })

  it('starts empty', () => {
    expect(useActiveDock.getState().current).toBeNull()
  })

  it('set publishes a dock and replaces it with the next one', () => {
    const a = dock('A')
    const b = dock('B')
    useActiveDock.getState().set(a)
    expect(useActiveDock.getState().current).toBe(a)
    useActiveDock.getState().set(b)
    expect(useActiveDock.getState().current).toBe(b)
  })

  it('clear only nulls the entry when it belongs to the same deck', () => {
    const a = dock('A')
    useActiveDock.getState().set(a)
    useActiveDock.getState().clear('B')
    expect(useActiveDock.getState().current).toBe(a)
    useActiveDock.getState().clear('A')
    expect(useActiveDock.getState().current).toBeNull()
  })
})
