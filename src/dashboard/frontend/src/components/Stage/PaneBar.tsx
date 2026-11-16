import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Home, CircleDot, Bot, Terminal, FileCode, GitCommit, ListTodo, FileText, Globe, Pencil, Plus, X, ChevronDown, type LucideIcon } from 'lucide-react'
import type { PaneType, WorkspacePane, PaneId } from '../../lib/panesStore'
import { CodeTabDirtyDot } from '../explorer/code/CodeTabDirtyDot'
import styles from './stage.module.css'
import { useShortcutList } from '../../lib/shortcuts/registry'
import { currentPlatform, formatSpec } from '../../lib/shortcuts/keys'

export interface NewPaneAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  /** Registry id whose keycap shows beside the item (PAN-5295 D2-17); none when unbound on this platform. */
  shortcutId?: string
  /** Draw a separator above this item. */
  separatorBefore?: boolean
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
  editor: Pencil,
  code: FileCode,
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
  /** Drag a tab → host shows pane drop zones for split-by-drag (PAN-1591). */
  onTabDragStart?: (paneId: PaneId) => void
  onTabDragEnd?: () => void
  /** Drag a tab off the bar without landing on a drop zone → detach it. Only
   *  fires for agent panes that carry a `conversationId`. Mirrors the in-pane
   *  detach icon and the ⋮ → "Pop out to window" menu item. */
  onTabDetach?: (paneId: PaneId, conversationId: string) => void
  /** PAN-5343 H-D7: rendered after the tab list button (the All deck's Layout bar). */
  trailing?: ReactNode
  /** PAN-5343 H-D9: rendered before each tab's label (the All deck's project marks). */
  renderTabPrefix?: (pane: WorkspacePane) => ReactNode
}

/**
 * PaneBar — the Stage's persistent tab strip (PAN-1549). Pure presentation:
 * renders one tab per pane from the store, highlights the active tab, and
 * exposes close (×, non-HOME only) and add (+) affordances via callbacks.
 * Tabs are 120–230 px with an ellipsized label and the full label in `title`;
 * no shortcut chips (the keys stay in the registry and the `?` sheet), and an
 * "N tabs ▾" list after the strip reaches every tab (PAN-5295 D2-16).
 */
export const PaneBar = memo(function PaneBar({ panes, activePaneId, onSelect, onClose, onAdd, newActions, onPaneContextMenu, onTabDragStart, onTabDragEnd, onTabDetach, trailing, renderTabPrefix }: PaneBarProps) {
  // One portaled menu at a time: the + create menu or the "N tabs" list.
  const [menu, setMenu] = useState<{ kind: 'add' | 'tabs'; top: number; left: number } | null>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const tabsBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const menuKind = menu?.kind ?? null
  const shortcuts = useShortcutList()
  const keycapOf = (id: string | undefined): { text: string; aria: string } | null => {
    if (!id) return null
    const platform = currentPlatform()
    const spec = shortcuts.find((def) => def.id === id)?.keys[platform]
    // aria-keyshortcuts names Ctrl "Control"; a chord's steps are space-separated.
    return spec ? { text: formatSpec(spec, platform), aria: spec.replace(/\bCtrl\b/g, 'Control') } : null
  }

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

  // Reveal the active tab when it changes (PAN-1591). Clicking a conversation
  // focuses its tab, but if the strip overflows that tab can be scrolled
  // off-screen — so the click looked like a no-op. Scroll it into view.
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activePaneId])

  const openMenu = (kind: 'add' | 'tabs') => {
    const r = (kind === 'add' ? addBtnRef : tabsBtnRef).current?.getBoundingClientRect()
    if (!r) return
    // The tab list sits at the strip's right edge, so it opens leftward.
    setMenu({ kind, top: r.bottom + 2, left: kind === 'add' ? r.left : Math.max(8, r.right - 240) })
  }
  const toggleMenu = (kind: 'add' | 'tabs') => (menu?.kind === kind ? setMenu(null) : openMenu(kind))
  // Close on outside click, scroll, resize, or Escape — the menu is portaled to
  // <body> so it escapes the PaneBar's overflow clip; reposition isn't tracked, so we
  // just dismiss on layout changes.
  useEffect(() => {
    if (!menuKind) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (addBtnRef.current?.contains(t) || tabsBtnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setMenu(null)
    }
    const dismiss = () => setMenu(null)
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null) }
    // Escape closes the menu and returns focus to its trigger, as the ⋯ and Send menus do (PAN-5408).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setMenu(null)
      ;(menuKind === 'add' ? addBtnRef : tabsBtnRef).current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuKind])

  return (
    <div className={styles.panebarWrap}>
      <div ref={barRef} className={styles.panebar} role="tablist" aria-label="Workspace panes">
      {panes.map((pane) => {
        const Icon = PANE_ICONS[pane.paneType] ?? Home
        const isActive = pane.paneId === activePaneId
        const closable = !pane.isPermanent && pane.paneType !== 'home'
        // A div (not a <button>) so the close control can be a real nested
        // <button> — HTML forbids interactive elements inside a <button>.
        return (
          <div
            key={pane.paneId}
            ref={isActive ? activeTabRef : undefined}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            draggable
            title={pane.label}
            data-tab-type={pane.paneType}
            className={`${styles.panetab} ${isActive ? styles.active : ''}`}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-pane-id', pane.paneId)
              onTabDragStart?.(pane.paneId)
            }}
            onDragEnd={(e) => {
              onTabDragEnd?.()
              // Detach: the drag ended without landing on a registered drop
              // zone (the pane layout's split overlays). dropEffect === 'none'
              // is the browser's signal that no target accepted the drag —
              // same affordance as Chrome/Firefox tab dragging. Only agent
              // panes backed by a conversation can be detached; session-backed
              // agent panes (work/review specialists) and other pane types
              // don't have a standalone window to open into.
              if (
                onTabDetach &&
                pane.paneType === 'agent' &&
                pane.conversationId &&
                e.dataTransfer.dropEffect === 'none'
              ) {
                onTabDetach(pane.paneId, pane.conversationId)
              }
            }}
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
            {renderTabPrefix?.(pane)}
            <span className={`${styles.panetabLabel} ${pane.paneType === 'code' && pane.explorerPreview ? 'italic' : ''}`}>{pane.label}</span>
            {pane.paneType === 'code' ? <CodeTabDirtyDot rootId={pane.explorerRootId} path={pane.explorerPath} /> : null}
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
          aria-expanded={menu?.kind === 'add'}
          onClick={() => toggleMenu('add')}
        >
          <Plus size={18} />
        </button>
      ) : (
        <button type="button" className={styles.add} aria-label="Open new pane" onClick={onAdd}>
          <Plus size={18} />
        </button>
      )}

      {/* Portaled to <body> so the PaneBar's overflow-x clip can't hide it. */}
      {menu?.kind === 'add' && newActions &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.addMenu}
            role="menu"
            style={{ position: 'fixed', top: menu.top, left: menu.left }}
          >
            {newActions.map((a) => {
              const ActionIcon = a.icon
              const keycap = keycapOf(a.shortcutId)
              return (
                <Fragment key={a.key}>
                  {a.separatorBefore && <div role="separator" className={styles.addMenuSeparator} />}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.addMenuItem}
                    aria-keyshortcuts={keycap?.aria}
                    onClick={() => { setMenu(null); a.onSelect() }}
                  >
                    <ActionIcon size={14} />
                    {a.label}
                    {keycap && <kbd className={`${styles.kbd} ml-auto`} aria-hidden="true">{keycap.text}</kbd>}
                  </button>
                </Fragment>
              )
            })}
          </div>,
          document.body,
        )}
      </div>
      {/* Outside the scrolling strip, so it never scrolls away (D2-16). */}
      <button
        ref={tabsBtnRef}
        type="button"
        className={styles.tabList}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'tabs'}
        aria-label={`${panes.length} tabs, list all tabs`}
        onClick={() => toggleMenu('tabs')}
      >
        {panes.length} tabs
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {menu?.kind === 'tabs' &&
        createPortal(
          <div
            ref={menuRef}
            className={`${styles.addMenu} ${styles.tabListMenu}`}
            role="menu"
            aria-label="All tabs"
            style={{ position: 'fixed', top: menu.top, left: menu.left }}
          >
            {panes.map((pane) => {
              const Icon = PANE_ICONS[pane.paneType] ?? Home
              return (
                <button
                  key={pane.paneId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={pane.paneId === activePaneId}
                  className={styles.addMenuItem}
                  title={pane.label}
                  onClick={() => { setMenu(null); onSelect(pane.paneId) }}
                >
                  <Icon size={14} />
                  {renderTabPrefix?.(pane)}
                  <span className={styles.panetabLabel}>{pane.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
      {trailing}
    </div>
  )
})
