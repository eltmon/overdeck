import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, Rows2, X } from 'lucide-react'
import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu'

interface PaneTabMenuProps {
  /** Viewport coordinates (fixed positioning) — typically the cursor. */
  position: { top: number; left: number }
  onClose: () => void
  /** Open this pane in a side-by-side (right) split (PAN-1591). */
  onOpenInSplit: () => void
  /** Open this pane in a stacked (below) split. */
  onSplitDown: () => void
  /** Close the tab — omitted for permanent panes (HOME). */
  onCloseTab?: () => void
  /** Close every closable tab (HOME stays). */
  onCloseAll: () => void
}

/**
 * Lightweight right-click menu for non-conversation pane tabs (issue, plan,
 * docs, commits, files, browser, home). Conversation/agent tabs use the richer
 * {@link ConversationActionMenu} instead. Uses the shared menu surface so pane,
 * conversation, and issue actions share one interaction vocabulary.
 */
export function PaneTabMenu({ position, onClose, onOpenInSplit, onSplitDown, onCloseTab, onCloseAll }: PaneTabMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }
    const dismiss = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [onClose])

  return createPortal(
    <>
      <MenuOverlay onClick={onClose} />
      <MenuSurface
        aria-label="Pane actions"
        onClose={onClose}
        className="fixed z-[1000] min-w-[220px]"
        style={{ position: 'fixed', top: position.top, left: position.left, right: 'auto' }}
      >
        <MenuItemButton onClick={() => { onOpenInSplit(); onClose() }}>
          <Columns2 size={14} />
          Split right
        </MenuItemButton>
        <MenuItemButton onClick={() => { onSplitDown(); onClose() }}>
          <Rows2 size={14} />
          Split down
        </MenuItemButton>
        <MenuSeparator />
        {onCloseTab && (
          <MenuItemButton onClick={() => { onCloseTab(); onClose() }}>
            <X size={14} />
            Close tab
          </MenuItemButton>
        )}
        <MenuItemButton onClick={() => { onCloseAll(); onClose() }}>
          <X size={14} />
          Close all tabs
        </MenuItemButton>
      </MenuSurface>
    </>,
    document.body,
  )
}
