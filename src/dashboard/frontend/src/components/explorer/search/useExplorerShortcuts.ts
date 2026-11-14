// Pane-scoped explorer shortcuts (PAN-5186, WI-B13; D-B11; PAN-5287 S-D10).
//
// Quick open (⌘P on macOS, Ctrl+P elsewhere) and content search (⌘⇧F / Ctrl+Shift+F)
// are global registry shortcuts whose when() holds only while focus is inside this
// explorer pane's root. As capture-phase shortcuts they win over Monaco. With no
// explorer pane focused the keys keep the browser default. The registry calls
// preventDefault(), which stops the print dialog.
//
// isQuickOpenKey / isContentSearchKey stay exported for later callers; the hook
// no longer uses them (they accept either modifier on every platform).

import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { focusElementOf, registerShortcut, type ShortcutDef } from '../../../lib/shortcuts/registry'

type KeyLike = Pick<ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function isQuickOpenKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p'
}

export function isContentSearchKey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
}

export function useExplorerShortcuts({
  rootRef,
  onQuickOpen,
  onContentSearch,
}: {
  rootRef: RefObject<HTMLElement | null>
  onQuickOpen(): void
  onContentSearch(): void
}): void {
  const handlers = useRef({ onQuickOpen, onContentSearch })
  handlers.current = { onQuickOpen, onContentSearch }

  const defs = useMemo((): ShortcutDef[] => {
    const focusInside = (event: KeyboardEvent) => !!rootRef.current?.contains(focusElementOf(event))
    return [
      {
        id: 'explorer.quick-open',
        keys: { mac: 'Meta+P', other: 'Ctrl+P' },
        scope: 'global',
        label: 'Go to file (in the explorer)',
        group: 'Files',
        when: focusInside,
        run: () => handlers.current.onQuickOpen(),
      },
      {
        id: 'explorer.content-search',
        keys: { mac: 'Meta+Shift+F', other: 'Ctrl+Shift+F' },
        scope: 'global',
        label: 'Search file contents (in the explorer)',
        group: 'Files',
        when: focusInside,
        run: () => handlers.current.onContentSearch(),
      },
    ]
  }, [rootRef])

  useEffect(() => {
    const unregister = defs.map((def) => registerShortcut(def))
    return () => {
      for (const off of unregister) off()
    }
  }, [defs])
}
