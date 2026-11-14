import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BackendConnectionBoundary } from '../../App/BackendConnectionBoundary'
import { useStageShortcuts } from './useStageShortcuts'
import { useConnectionState } from '../../lib/connectionState'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
} from '../../lib/panesStore'
import { useTerminalStateStore, selectThreadTerminalState } from '../terminal/terminalStateStore'
import { installShortcutListener, resetShortcutsForTests } from '../../lib/shortcuts/registry'

const WS = 'PAN-1549'

function Host() {
  useEffect(() => installShortcutListener(), [])
  useStageShortcuts(WS)
  return null
}

let platform: ReturnType<typeof vi.spyOn>
function onLinux() {
  platform.mockReturnValue('Linux x86_64')
}
function ctrlAlt(key: string) {
  fireEvent.keyDown(window, { key, ctrlKey: true, altKey: true })
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
  platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  usePanesStore.getState().ensureHome(WS)
})
afterEach(() => {
  // Drop focus so the text-entry guard test doesn't leak.
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  resetShortcutsForTests()
  vi.restoreAllMocks()
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

  it('does not switch panes on ⌘⇧N (Shift combos are left to the Launcher)', () => {
    const homeId = panes()[0].paneId
    usePanesStore.getState().addPane(WS, { paneType: 'terminal', label: 'T' })
    usePanesStore.getState().setActivePane(WS, homeId)
    render(<Host />)
    fireEvent.keyDown(window, { key: '2', metaKey: true, shiftKey: true })
    expect(activeId()).toBe(homeId) // ⌘⇧2 must NOT focus pane 2
  })

  it('⌘T toggles the terminal drawer (PAN-1561), not a deck tab', () => {
    render(<Host />)
    const open = () => selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, WS).terminalOpen
    expect(open()).toBe(false)
    expect(panes()).toHaveLength(1)
    meta('t')
    expect(open()).toBe(true)
    // No new deck tab is created — terminals live in the drawer.
    expect(panes()).toHaveLength(1)
    meta('t')
    expect(open()).toBe(false)
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

  it('keeps working during an outage, because degraded mode keeps the page visible (PAN-4279)', () => {
    const homeId = panes()[0].paneId
    usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'D' })
    useConnectionState.setState({ hasSnapshot: true, serverReachable: false })
    try {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BackendConnectionBoundary><Host /></BackendConnectionBoundary>
        </QueryClientProvider>,
      )

      meta('w')
      expect(panes()).toHaveLength(1)
      expect(activeId()).toBe(homeId)
    } finally {
      useConnectionState.setState({ hasSnapshot: false, serverReachable: true })
    }
  })

  it('Ctrl+Alt+N sets the active pane by index on Linux; ⌘N does nothing there', () => {
    onLinux()
    const homeId = panes()[0].paneId
    const t = usePanesStore.getState().addPane(WS, { paneType: 'terminal', label: 'T' })
    render(<Host />)

    ctrlAlt('1')
    expect(activeId()).toBe(homeId)
    meta('2')
    expect(activeId()).toBe(homeId)
    ctrlAlt('2')
    expect(activeId()).toBe(t)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    expect(activeId()).toBe(t) // Ctrl+1 alone is left to the browser
  })

  it('Ctrl+Alt+W closes the active pane on Linux, never HOME', () => {
    onLinux()
    const homeId = panes()[0].paneId
    usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'D' })
    render(<Host />)

    ctrlAlt('w')
    expect(panes()).toHaveLength(1)
    expect(activeId()).toBe(homeId)
    ctrlAlt('w')
    expect(panes()).toHaveLength(1)
  })

  it('⌘T does nothing on Linux (unbound there)', () => {
    onLinux()
    render(<Host />)
    const open = () => selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, WS).terminalOpen
    meta('t')
    fireEvent.keyDown(window, { key: 't', ctrlKey: true })
    ctrlAlt('t')
    expect(open()).toBe(false)
  })

  it('ignores combos without the meta key', () => {
    render(<Host />)
    fireEvent.keyDown(window, { key: 't' }) // no metaKey
    expect(panes()).toHaveLength(1)
  })
})
