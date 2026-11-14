// App-level keyboard shortcuts (PAN-5287 §6.7/§6.8, WI-S9): the palette, the
// conversations palette, search, the `?` sheet and the `g` lens chords, registered with the
// shortcut registry. App calls this once; it also installs the registry's
// window listeners for the whole app.

import { useEffect, useMemo, useRef } from 'react'
import type { Tab } from '../../components/Header'
import { installShortcutListener, registerShortcut, type ShortcutDef } from '../../lib/shortcuts/registry'

export interface AppShortcutActions {
  isPaletteOpen: boolean
  activeTab: Tab
  openShortcutsSheet: () => void
  setActiveTab: (tab: Tab) => void
  setIsSearchOpen: (open: boolean) => void
  setIsPaletteOpen: (update: boolean | ((prev: boolean) => boolean)) => void
  setPaletteInitialScope: (scope: 'all' | 'conversations') => void
}

const LENSES: ReadonlyArray<{ id: string; key: string; tab: Tab; label: string }> = [
  { id: 'app.lens-pipeline', key: 'G P', tab: 'pipeline', label: 'Go to Pipeline' },
  { id: 'app.lens-board', key: 'G B', tab: 'kanban', label: 'Go to Board' },
  { id: 'app.lens-agents', key: 'G A', tab: 'agents', label: 'Go to Agents' },
  { id: 'app.lens-command-deck', key: 'G C', tab: 'command-deck', label: 'Go to Command Deck' },
]

export function useAppShortcuts(actions: AppShortcutActions): void {
  const { isPaletteOpen, activeTab, openShortcutsSheet, setActiveTab, setIsSearchOpen, setIsPaletteOpen, setPaletteInitialScope } =
    actions
  useEffect(() => installShortcutListener(), [])

  // The lens chords are disabled while the palette is open (PAN-1234).
  const paletteOpenRef = useRef(isPaletteOpen)
  paletteOpenRef.current = isPaletteOpen
  // God View uses ? for its own help (PAN-5287 S-D8).
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const defs = useMemo<ShortcutDef[]>(
    () => [
      {
        id: 'app.palette',
        keys: { mac: 'Meta+K', other: 'Ctrl+K' },
        scope: 'global',
        label: 'Command palette',
        group: 'General',
        run: () => {
          setPaletteInitialScope('all')
          setIsPaletteOpen((prev) => !prev)
        },
      },
      {
        // PAN-2908 C-CONVO: jump straight to conversations.
        id: 'app.palette-conversations',
        keys: { mac: 'Meta+J', other: 'Ctrl+J' },
        scope: 'global',
        label: 'Find a conversation',
        group: 'General',
        run: () => {
          setPaletteInitialScope('conversations')
          setIsPaletteOpen(true)
        },
      },
      {
        id: 'app.search',
        keys: { mac: '/', other: '/' },
        scope: 'not-editing',
        label: 'Search',
        group: 'General',
        run: () => setIsSearchOpen(true),
      },
      {
        id: 'app.shortcuts-sheet',
        keys: { mac: '?', other: '?' },
        scope: 'not-editing',
        label: 'Keyboard shortcuts',
        group: 'General',
        when: () => activeTabRef.current !== 'god-view',
        run: () => openShortcutsSheet(),
      },
      ...LENSES.map(
        (lens): ShortcutDef => ({
          id: lens.id,
          keys: { mac: lens.key, other: lens.key },
          scope: 'not-editing',
          label: lens.label,
          group: 'Navigation',
          when: () => !paletteOpenRef.current,
          run: () => setActiveTab(lens.tab),
        }),
      ),
    ],
    [openShortcutsSheet, setActiveTab, setIsSearchOpen, setIsPaletteOpen, setPaletteInitialScope],
  )

  useEffect(() => {
    const unregister = defs.map((def) => registerShortcut(def))
    return () => {
      for (const off of unregister) off()
    }
  }, [defs])
}
