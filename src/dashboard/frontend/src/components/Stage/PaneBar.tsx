import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Home, CircleDot, Bot, Terminal, FileCode, GitCommit, ListTodo, FileText, Globe, Plus, X, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import type { PaneType, WorkspacePane, PaneId } from '../../lib/panesStore'
import styles from './stage.module.css'

export interface NewPaneAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
}

const PANE_ICONS: Record<PaneType, typeof Home> = {
  home: Home,
  issue: CircleDot,
  agent: Bot,
  terminal: Terminal,
  files: FileCode,
  commits: GitCommit,
  plan: ListTodo,
  docs: FileText,
  browser: Globe,
}

export interface PaneBarProps {
  panes: readonly WorkspacePane[]
  activePaneId: PaneId | null
  onSelect: (paneId: PaneId) => void
  onClose: (paneId: PaneId) => void
  /** Fallback when no `newActions` menu is provided (e.g. ⌘T). */
  onAdd: () => void
  /** When provided, the "+" opens a menu of these create actions (PAN-1561). */
  newActions?: NewPaneAction[]
  /** Right-click on a tab → host opens the conversation action menu at cursor. */
  onPaneContextMenu?: (pane: WorkspacePane, e: React.MouseEvent) => void
}

/**
 * PaneBar — the Stage's persistent tab strip (PAN-1549). Pure presentation:
 * renders one tab per pane from the store, highlights the active tab, shows a
 * ⌘N hint for the first nine panes, and exposes close (×, non-HOME only) and
 * add (+) affordances via callbacks.
 */
export const PaneBar = memo(function PaneBar({ panes, activePaneId, onSelect, onClose, onAdd, newActions, onPaneContextMenu }: PaneBarProps) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const menuOpen = menuPos !== null

  // The tab strip scrolls horizontally on overflow, but its scrollbar is hidden
  // (a visible one bonks the tab height). Translate a vertical mouse wheel into
  // horizontal scroll so a plain mouse — not just a trackpad — can reach
  // overflowed tabs. Native non-passive listener so preventDefault sticks.
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // already horizontal
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Track overflow so we can show ‹ › scroll buttons — the *visible* affordance
  // that there are tabs off-screen (wheel-scroll alone gives no cue). Updated on
  // scroll, container resize, and when the tab set changes.
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const update = () => {
      setOverflow({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [panes.length])

  const scrollTabs = (dir: -1 | 1) => barRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' })

  const openMenu = () => {
    const r = addBtnRef.current?.getBoundingClientRect()
    if (r) setMenuPos({ top: r.bottom + 2, left: r.left })
  }
  // Close on outside click, scroll, or resize — the menu is portaled to <body>
  // so it escapes the PaneBar's overflow clip; reposition isn't tracked, so we
  // just dismiss on layout changes.
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (addBtnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setMenuPos(null)
    }
    const dismiss = () => setMenuPos(null)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [menuOpen])

  return (
    <div className={styles.panebarWrap}>
      {overflow.left && (
        <button type="button" className={`${styles.tabScrollBtn} ${styles.tabScrollLeft}`} aria-label="Scroll tabs left" onClick={() => scrollTabs(-1)}>
          <ChevronLeft size={16} />
        </button>
      )}
      {overflow.right && (
        <button type="button" className={`${styles.tabScrollBtn} ${styles.tabScrollRight}`} aria-label="Scroll tabs right" onClick={() => scrollTabs(1)}>
          <ChevronRight size={16} />
        </button>
      )}
      <div ref={barRef} className={styles.panebar} role="tablist" aria-label="Workspace panes">
      {panes.map((pane, index) => {
        const Icon = PANE_ICONS[pane.paneType] ?? Home
        const isActive = pane.paneId === activePaneId
        const closable = !pane.isPermanent && pane.paneType !== 'home'
        // A div (not a <button>) so the close control can be a real nested
        // <button> — HTML forbids interactive elements inside a <button>.
        return (
          <div
            key={pane.paneId}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            className={`${styles.panetab} ${isActive ? styles.active : ''}`}
            onClick={() => onSelect(pane.paneId)}
            onAuxClick={(e) => {
              // Middle-click closes the tab (standard browser/editor convention).
              if (e.button === 1 && closable) {
                e.preventDefault()
                onClose(pane.paneId)
              }
            }}
            onContextMenu={(e) => onPaneContextMenu?.(pane, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(pane.paneId)
              }
            }}
          >
            <span className={styles.panetabIcon}>
              <Icon size={14} />
            </span>
            <span>{pane.label}</span>
            {index < 9 && <span className={styles.kbd}>⌘{index + 1}</span>}
            {closable && (
              <button
                type="button"
                aria-label={`Close ${pane.label}`}
                className={styles.close}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(pane.paneId)
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )
      })}
      {newActions && newActions.length > 0 ? (
        <button
          ref={addBtnRef}
          type="button"
          className={styles.add}
          aria-label="Open new tab"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => (menuOpen ? setMenuPos(null) : openMenu())}
        >
          <Plus size={18} />
        </button>
      ) : (
        <button type="button" className={styles.add} aria-label="Open new pane" onClick={onAdd}>
          <Plus size={18} />
        </button>
      )}

      {/* Portaled to <body> so the PaneBar's overflow-x clip can't hide it. */}
      {menuOpen && menuPos && newActions &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.addMenu}
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          >
            {newActions.map((a) => {
              const ActionIcon = a.icon
              return (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  className={styles.addMenuItem}
                  onClick={() => { setMenuPos(null); a.onSelect() }}
                >
                  <ActionIcon size={14} />
                  {a.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
      </div>
    </div>
  )
})
