import { useEffect } from 'react'
import { usePanesStore, type WorkspaceId } from '../../lib/panesStore'
import { useTerminalStateStore, selectThreadTerminalState } from '../terminal/terminalStateStore'
import { registerShortcut, type ShortcutDef } from '../../lib/shortcuts/registry'

const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

function stageShortcuts(workspaceId: WorkspaceId): ShortcutDef[] {
  const panes = () => usePanesStore.getState().panesByWorkspace[workspaceId] ?? []
  const focusTabs = TAB_NUMBERS.map(
    (n): ShortcutDef => ({
      id: `stage.focus-tab-${n}`,
      keys: { mac: `Meta+${n}`, other: `Ctrl+Alt+${n}` },
      scope: 'not-editing',
      label: 'Go to tab 1–9',
      group: 'Tabs',
      hidden: n > 1,
      when: () => panes()[n - 1] !== undefined,
      run: () => {
        const pane = panes()[n - 1]
        if (pane) usePanesStore.getState().setActivePane(workspaceId, pane.paneId)
      },
    }),
  )
  return [
    ...focusTabs,
    {
      id: 'stage.close-tab',
      keys: { mac: 'Meta+W', other: 'Ctrl+Alt+W' },
      scope: 'not-editing',
      label: 'Close tab',
      group: 'Tabs',
      when: () => !!usePanesStore.getState().activePaneByWorkspace[workspaceId],
      run: () => {
        const store = usePanesStore.getState()
        const activeId = store.activePaneByWorkspace[workspaceId]
        if (activeId) store.closePane(workspaceId, activeId) // refuses HOME internally
      },
    },
    {
      // PAN-1561: terminals are drawer-only, not deck tabs. Unbound off macOS,
      // where Windows and GNOME take Super+T (PAN-5287 S-D6).
      id: 'stage.toggle-terminal',
      keys: { mac: 'Meta+T', other: null },
      scope: 'not-editing',
      label: 'Toggle terminal',
      group: 'Tabs',
      run: () => {
        const tStore = useTerminalStateStore.getState()
        const open = selectThreadTerminalState(tStore.terminalStateByThreadId, workspaceId).terminalOpen
        tStore.setTerminalOpen(workspaceId, !open)
      },
    },
  ]
}

/**
 * useStageShortcuts — Stage keyboard map (PAN-1549, PAN-5287), registered with
 * the shortcut registry while mounted:
 *  ⌘1..9 (Ctrl+Alt+1..9 off macOS)  focus pane N (no-op if absent)
 *  ⌘W    (Ctrl+Alt+W off macOS)     close the active pane (never HOME)
 *  ⌘T    (macOS only)               toggle the terminal drawer
 *
 * They are `not-editing` shortcuts, so a focused text field, terminal or code
 * editor keeps the keys. Chrome never delivers Ctrl+1..9 or Ctrl+W to the page
 * on Linux and Windows, hence Ctrl+Alt there.
 */
export function useStageShortcuts(workspaceId: WorkspaceId): void {
  useEffect(() => {
    const unregister = stageShortcuts(workspaceId).map(registerShortcut)
    return () => {
      for (const off of unregister) off()
    }
  }, [workspaceId])
}
