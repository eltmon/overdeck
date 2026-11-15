// The four global work-dock shortcuts (PAN-5289 WI-2, §6.7, B-D4).
//
// Files (⌘⇧E / Ctrl+Shift+E), Changes (⌘⇧G / Ctrl+Shift+G), content search
// (⌘⇧F / Ctrl+Shift+F) and Go to file (⌘P / Ctrl+P) are `global` registry
// shortcuts with no when(): they run wherever focus is, including a textarea or
// Monaco, because the registry's capture-phase listener runs first (PAN-5284
// D-7). The registry calls preventDefault(), which stops the print dialog. The
// mounted WorkDock passes the handlers; null registers nothing.
//
// isQuickOpenKey / isContentSearchKey stay exported for later callers; the hook
// does not use them (they accept either modifier on every platform).

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { registerShortcut, type ShortcutDef } from '../../../lib/shortcuts/registry'

type KeyLike = Pick<ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function isQuickOpenKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p'
}

export function isContentSearchKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
}

export interface DockShortcutHandlers {
  onFiles(): void
  onChanges(): void
  onSearch(): void
  onQuickOpen(): void
}

const DOCK_SHORTCUTS: ReadonlyArray<Omit<ShortcutDef, 'run' | 'scope' | 'group'> & { handler: keyof DockShortcutHandlers }> = [
  { id: 'dock.files', keys: { mac: 'Meta+Shift+E', other: 'Ctrl+Shift+E' }, label: 'Show or hide Files', handler: 'onFiles' },
  { id: 'dock.changes', keys: { mac: 'Meta+Shift+G', other: 'Ctrl+Shift+G' }, label: 'Show or hide Changes', handler: 'onChanges' },
  { id: 'explorer.content-search', keys: { mac: 'Meta+Shift+F', other: 'Ctrl+Shift+F' }, label: 'Search file contents', handler: 'onSearch' },
  { id: 'explorer.quick-open', keys: { mac: 'Meta+P', other: 'Ctrl+P' }, label: 'Go to file', handler: 'onQuickOpen' },
]

export function useExplorerShortcuts(handlers: DockShortcutHandlers | null): void {
  // Handlers live in a ref so a re-render with new callbacks does not re-register.
  const ref = useRef(handlers)
  ref.current = handlers
  const enabled = handlers !== null

  useEffect(() => {
    if (!enabled) return undefined
    const unregister = DOCK_SHORTCUTS.map(({ handler, ...def }) =>
      registerShortcut({ ...def, scope: 'global', group: 'Files', run: () => ref.current?.[handler]() }),
    )
    return () => {
      for (const off of unregister) off()
    }
  }, [enabled])
}
