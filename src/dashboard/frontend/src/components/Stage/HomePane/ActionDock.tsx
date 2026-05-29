import { useState } from 'react'
import { Terminal, FileCode, Globe, GitCommit, ListTodo, FileText, Plus } from 'lucide-react'
import type { PaneType } from '../../../lib/panesStore'
import styles from '../stage.module.css'

export interface ActionDockProps {
  /** Open (or focus) a pane of the given type. */
  onOpen: (paneType: PaneType) => void
}

/**
 * ActionDock — the HomePane tool row (PAN-1549). Terminal, Files, Web, and
 * Commits buttons open their panes directly; a "+ Actions" overflow exposes
 * Plan and Docs. The Web button opens an (empty) browser pane.
 */
export function ActionDock({ onOpen }: ActionDockProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  return (
    <div className={`${styles.dock} ${styles.actionDock}`} role="group" aria-label="Actions">
      <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('terminal')}>
        <Terminal size={14} />
        Terminal
      </button>
      <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('files')}>
        <FileCode size={14} />
        Files
      </button>
      <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('browser')}>
        <Globe size={14} />
        Web
      </button>
      <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('commits')}>
        <GitCommit size={14} />
        Commits
      </button>
      <button
        type="button"
        className={`${styles.pill} ${styles.pillGhost}`}
        aria-expanded={overflowOpen}
        onClick={() => setOverflowOpen((v) => !v)}
      >
        <Plus size={13} />
        Actions
      </button>
      {overflowOpen && (
        <div className={styles.actionOverflow} role="menu">
          <button type="button" role="menuitem" className={styles.actionOverflowItem} onClick={() => onOpen('plan')}>
            <ListTodo size={14} />
            Plan
          </button>
          <button type="button" role="menuitem" className={styles.actionOverflowItem} onClick={() => onOpen('docs')}>
            <FileText size={14} />
            Docs
          </button>
        </div>
      )}
    </div>
  )
}
