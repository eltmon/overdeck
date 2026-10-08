import { useState } from 'react'
import { Terminal, FileCode, Globe, GitCommit, ListTodo, FileText, Plus, Home } from 'lucide-react'
import type { PaneType } from '../../../lib/panesStore'
import styles from '../stage.module.css'

export interface ActionDockProps {
  /** Open (or focus) a pane of the given type. */
  onOpen: (paneType: PaneType) => void
  /**
   * Which actions to surface. Defaults to the full set. The project Home passes
   * a project-appropriate subset (terminal + web), since Files/Commits/Plan/Docs
   * are issue-scoped (PAN-1561).
   */
  actions?: PaneType[]
  /**
   * The project Home's **Main checkout** button: opens the project's main
   * workspace view (git, run command, files, conversations, memory). Omitted
   * elsewhere.
   */
  onOpenMainCheckout?: () => void
  /** True while the main checkout is being resolved or created. */
  mainCheckoutBusy?: boolean
}

const DEFAULT_ACTIONS: PaneType[] = ['terminal', 'files', 'browser', 'commits', 'plan', 'docs']

/**
 * ActionDock — the HomePane tool row (PAN-1549). Terminal, Files, Web, and
 * Commits buttons open their panes directly; a "+ Actions" overflow exposes
 * Plan and Docs. The Web button opens an (empty) browser pane. The `actions`
 * prop limits which buttons appear so issue-scoped actions don't show on the
 * project Home (PAN-1561).
 */
export function ActionDock({ onOpen, actions = DEFAULT_ACTIONS, onOpenMainCheckout, mainCheckoutBusy = false }: ActionDockProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const has = (a: PaneType) => actions.includes(a)
  const hasOverflow = has('plan') || has('docs')
  return (
    <div className={`${styles.dock} ${styles.actionDock}`} role="group" aria-label="Actions">
      {has('terminal') && (
        <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('terminal')}>
          <Terminal size={14} />
          Terminal
        </button>
      )}
      {has('files') && (
        <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('files')}>
          <FileCode size={14} />
          Files
        </button>
      )}
      {has('browser') && (
        <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('browser')}>
          <Globe size={14} />
          Web
        </button>
      )}
      {onOpenMainCheckout && (
        <button
          type="button"
          data-testid="action-dock-main-checkout"
          className={`${styles.pill} ${styles.pillTool}`}
          disabled={mainCheckoutBusy}
          title="Open the main checkout: git status, run command, files, conversations and memory"
          onClick={onOpenMainCheckout}
        >
          <Home size={14} />
          Main checkout
        </button>
      )}
      {has('commits') && (
        <button type="button" className={`${styles.pill} ${styles.pillTool}`} onClick={() => onOpen('commits')}>
          <GitCommit size={14} />
          Commits
        </button>
      )}
      {hasOverflow && (
        <button
          type="button"
          className={`${styles.pill} ${styles.pillGhost}`}
          aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((v) => !v)}
        >
          <Plus size={13} />
          Actions
        </button>
      )}
      {hasOverflow && overflowOpen && (
        <div className={styles.actionOverflow} role="menu">
          {has('plan') && (
            <button type="button" role="menuitem" className={styles.actionOverflowItem} onClick={() => onOpen('plan')}>
              <ListTodo size={14} />
              Plan
            </button>
          )}
          {has('docs') && (
            <button type="button" role="menuitem" className={styles.actionOverflowItem} onClick={() => onOpen('docs')}>
              <FileText size={14} />
              Docs
            </button>
          )}
        </div>
      )}
    </div>
  )
}
