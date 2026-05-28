import { Home, Bot, Terminal, FileCode, GitCommit, ListTodo, FileText, Globe, Plus, X } from 'lucide-react'
import type { PaneType, WorkspacePane, PaneId } from '../../lib/panesStore'
import styles from './stage.module.css'

const PANE_ICONS: Record<PaneType, typeof Home> = {
  home: Home,
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
  onAdd: () => void
}

/**
 * PaneBar — the Stage's persistent tab strip (PAN-1549). Pure presentation:
 * renders one tab per pane from the store, highlights the active tab, shows a
 * ⌘N hint for the first nine panes, and exposes close (×, non-HOME only) and
 * add (+) affordances via callbacks.
 */
export function PaneBar({ panes, activePaneId, onSelect, onClose, onAdd }: PaneBarProps) {
  return (
    <div className={styles.panebar} role="tablist" aria-label="Workspace panes">
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
      <button type="button" className={styles.add} aria-label="Open new pane" onClick={onAdd}>
        <Plus size={18} />
      </button>
    </div>
  )
}
