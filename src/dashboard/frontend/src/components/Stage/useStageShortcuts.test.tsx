import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useStageShortcuts } from './useStageShortcuts'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
} from '../../lib/panesStore'

const WS = 'PAN-1549'

function Host() {
  useStageShortcuts(WS)
  return null
}

function panes() {
  return selectPanesForWorkspace(WS)(usePanesStore.getState())
}
function activeId() {
  return selectActivePaneId(WS)(usePanesStore.getState())
}
function meta(key: string) {
  fireEvent.keyDown(window, { key, metaKey: true })
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})
afterEach(() => {
  // Drop focus so the text-entry guard test doesn't leak.
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('useStageShortcuts', () => {
  it('⌘N sets the active pane by index; out-of-range is a no-op', () => {
    const homeId = panes()[0].paneId
    const t = usePanesStore.getState().addPane(WS, { paneType: 'terminal', label: 'T' })
    const d = usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'D' })
    render(<Host />)

    meta('1')
    expect(activeId()).toBe(homeId)
    meta('2')
    expect(activeId()).toBe(t)
    meta('3')
    expect(activeId()).toBe(d)

    // ⌘9 — no pane at index 8.
    meta('9')
    expect(activeId()).toBe(d)
  })

  it('⌘T adds a pane', () => {
    render(<Host />)
    expect(panes()).toHaveLength(1)
    meta('t')
    expect(panes()).toHaveLength(2)
    expect(panes()[1].paneType).toBe('terminal')
  })

  it('⌘W closes the active pane but never HOME', () => {
    const homeId = panes()[0].paneId
    const t = usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'D' })
    render(<Host />)
    expect(activeId()).toBe(t)

    meta('w') // closes the active docs pane → active falls back to HOME
    expect(panes()).toHaveLength(1)
    expect(activeId()).toBe(homeId)

    meta('w') // HOME is active now → refused
    expect(panes()).toHaveLength(1)
    expect(panes()[0].paneId).toBe(homeId)
  })

  it('does not fire while a text input is focused', () => {
    render(
      <>
        <Host />
        <input data-testid="field" />
      </>,
    )
    const field = document.querySelector('[data-testid="field"]') as HTMLInputElement
    field.focus()
    fireEvent.keyDown(field, { key: 't', metaKey: true })
    expect(panes()).toHaveLength(1) // ⌘T suppressed
  })

  it('ignores combos without the meta key', () => {
    render(<Host />)
    fireEvent.keyDown(window, { key: 't' }) // no metaKey
    expect(panes()).toHaveLength(1)
  })
})
