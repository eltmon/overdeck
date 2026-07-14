import { useState } from 'react'
import { VBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/VBriefTab'
import { TasksTab } from '../../CommandDeck/ZoneCOverviewTabs/TasksTab'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

type PlanView = 'plan' | 'tasks'

/**
 * PlanPane — paneType='plan' (PAN-1549). A simple sub-toggle between the
 * existing VBriefTab (List/DAG/Raw) and TasksTab for the workspace issue.
 * Both tab bodies are reused as-is.
 */
export function PlanPane({ pane, ctx }: PaneWrapperProps) {
  // PAN-1561: project-scoped deck — prefer the pane's own issue id.
  const issueId = pane.issueId ?? ctx.workspaceId
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
          aria-selected={view === 'tasks'}
          className={`${styles.subTab} ${view === 'tasks' ? styles.subTabActive : ''}`}
          onClick={() => setView('tasks')}
        >
          Tasks
        </button>
      </div>
      <div className={styles.subBody}>
        {view === 'plan' ? (
          <VBriefTab issueId={issueId} />
        ) : (
          <TasksTab issueId={issueId} />
        )}
      </div>
    </div>
  )
}
