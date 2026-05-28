import { useState } from 'react'
import { VBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/VBriefTab'
import { BeadsTab } from '../../CommandDeck/ZoneCOverviewTabs/BeadsTab'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

type PlanView = 'plan' | 'beads'

/**
 * PlanPane — paneType='plan' (PAN-1549). A simple sub-toggle between the
 * existing VBriefTab (List/DAG/Raw) and BeadsTab for the workspace issue.
 * Both tab bodies are reused as-is.
 */
export function PlanPane({ ctx }: PaneWrapperProps) {
  const [view, setView] = useState<PlanView>('plan')
  return (
    <div className={styles.subPane}>
      <div className={styles.subTabs} role="tablist" aria-label="Plan view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'plan'}
          className={`${styles.subTab} ${view === 'plan' ? styles.subTabActive : ''}`}
          onClick={() => setView('plan')}
        >
          Plan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'beads'}
          className={`${styles.subTab} ${view === 'beads' ? styles.subTabActive : ''}`}
          onClick={() => setView('beads')}
        >
          Beads
        </button>
      </div>
      <div className={styles.subBody}>
        {view === 'plan' ? (
          <VBriefTab issueId={ctx.workspaceId} />
        ) : (
          <BeadsTab issueId={ctx.workspaceId} />
        )}
      </div>
    </div>
  )
}
