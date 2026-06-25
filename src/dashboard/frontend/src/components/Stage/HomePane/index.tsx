import type { ReactNode } from 'react'
import type { WorkspaceId, PaneSpec } from '../../../lib/panesStore'
import styles from '../stage.module.css'

export interface HomePaneProps {
  workspaceId: WorkspaceId
  /** Open + activate another pane (used by docks, launcher, timeline). */
  openPane: (spec: PaneSpec) => void
  // Section content slots — filled by later beads (workspace-header, launcher,
  // agent-dock, action-dock, timeline, homepane-sections). Optional so the
  // scaffold renders standalone until those beads land.
  header?: ReactNode
  launcher?: ReactNode
  agentDock?: ReactNode
  actionDock?: ReactNode
  timeline?: ReactNode
  detail?: ReactNode
  wide?: boolean
}

/** Section render order — project detail/cockpit content sits above conversations. */
const SECTIONS = ['header', 'launcher', 'agentDock', 'actionDock', 'detail', 'timeline'] as const

/**
 * HomePane — the permanent paneType='home' body (PAN-1549). This bead lays out
 * the section scaffold (WorkspaceHeader, Launcher, AgentDock, ActionDock,
 * detail, Timeline) in a constrained content column. The sections themselves
 * are populated by later beads; each renders into its named slot here.
 */
export function HomePane(props: HomePaneProps) {
  return (
    <div className={props.wide ? `${styles.home} ${styles.homeWide}` : styles.home}>
      {SECTIONS.map((name) => (
        <section key={name} data-section={name} className={styles.homeSection}>
          {props[name]}
        </section>
      ))}
    </div>
  )
}
