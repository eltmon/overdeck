import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Columns2, X } from 'lucide-react'
import menu from '../CommandDeck/styles/command-deck.module.css'

interface PaneTabMenuProps {
  /** Viewport coordinates (fixed positioning) — typically the cursor. */
  position: { top: number; left: number }
  onClose: () => void
  /** Open this pane in a side-by-side split (PAN-1591). */
  onOpenInSplit: () => void
  /** Close the tab — omitted for permanent panes (HOME). */
  onCloseTab?: () => void
}

/**
 * Lightweight right-click menu for non-conversation pane tabs (issue, plan,
 * docs, commits, files, browser, home). Conversation/agent tabs use the richer
 * {@link ConversationActionMenu} instead. Reuses the command-deck menu styling
 * so both menus look identical. Portaled + fixed-positioned to escape clips.
 */
export function PaneTabMenu({ position, onClose, onOpenInSplit, onCloseTab }: PaneTabMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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
      <div className={menu.headerMenuOverlay} onClick={onClose} />
      <div role="menu" className={menu.headerMenu} style={{ position: 'fixed', top: position.top, left: position.left, right: 'auto' }}>
        <button role="menuitem" className={menu.headerMenuItem} onClick={() => { onOpenInSplit(); onClose() }}>
          <Columns2 size={14} />
          Open in split right
        </button>
        {onCloseTab && (
          <>
            <div className={menu.headerMenuDivider} />
            <button role="menuitem" className={menu.headerMenuItem} onClick={() => { onCloseTab(); onClose() }}>
              <X size={14} />
              Close tab
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
