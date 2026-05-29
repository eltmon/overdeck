import { useEffect } from 'react'
import { usePanesStore, type WorkspaceId } from '../../lib/panesStore'
import { useTerminalStateStore, selectThreadTerminalState } from '../terminal/terminalStateStore'

/** True when focus is in a text-entry context where the Launcher / fields own
 * the keyboard (so the Stage must not hijack ⌘-combos). */
function isTextEntryFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * useStageShortcuts — Stage keyboard map (PAN-1549). Active only while mounted:
 *  ⌘1   focus HOME (index 0)
 *  ⌘2–9 focus pane N (no-op if absent)
 *  ⌘T   open a new pane
 *  ⌘W   close the active pane (never HOME)
 *
 * Shortcuts are suppressed while a text input / the Launcher is focused; the
 * ⌘↵ Launcher family is intentionally not handled here.
 */
export function useStageShortcuts(workspaceId: WorkspaceId): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey) return
      if (e.altKey || e.ctrlKey || e.shiftKey) return // leave ⌥/⌃/⇧ combos (Launcher etc.) alone
      if (isTextEntryFocused()) return

      const store = usePanesStore.getState()
      const panes = store.panesByWorkspace[workspaceId] ?? []

      // ⌘1..⌘9 — focus pane by index.
      if (/^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        const pane = panes[index]
        if (pane) {
          e.preventDefault()
          store.setActivePane(workspaceId, pane.paneId)
        }
        return
      }

      const key = e.key.toLowerCase()
      if (key === 't') {
        // PAN-1561: ⌘T toggles the terminal drawer (terminals are drawer-only,
        // not deck tabs).
        e.preventDefault()
        const tStore = useTerminalStateStore.getState()
        const open = selectThreadTerminalState(tStore.terminalStateByThreadId, workspaceId).terminalOpen
        tStore.setTerminalOpen(workspaceId, !open)
        return
      }
      if (key === 'w') {
        const activeId = store.activePaneByWorkspace[workspaceId]
        if (activeId) {
          e.preventDefault()
          store.closePane(workspaceId, activeId) // refuses HOME internally
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceId])
}
