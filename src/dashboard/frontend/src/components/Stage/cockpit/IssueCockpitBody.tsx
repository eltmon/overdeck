import { useState } from 'react'
import styles from './cockpitBody.module.css'
import { ReviewVerificationCard } from './ReviewVerificationCard'
import { CodeCard } from './CodeCard'
import { PlanCard } from './PlanCard'
import { CostCard } from './CostCard'
import { WorkspaceCard } from './WorkspaceCard'
import { AgentCard, ActivityCard } from './AgentActivityCards'
import { IssueDigTabs, type DigTab } from './IssueDigTabs'

/**
 * IssueCockpitBody — the SCAN + DIG layers of the issue cockpit (Command Deck
 * remodel S3). Replaces the old "dump everything" HomePaneSections.
 *
 * SCAN: a two-column grid ordered by importance — left is the WORK
 * (Review & Verification · Code · Plan), right is the CONTEXT (Cost · Workspace
 * · Agent · Activity). Collapses to one column on narrow panes.
 *
 * DIG: a tab bar that lazily reveals the deep views; nothing shows until opened.
 */
export function IssueCockpitBody({ issueId }: { issueId: string }) {
  const [digTab, setDigTab] = useState<DigTab | null>(null)

  return (
    <div className={styles.wrap}>
      <div className={styles.scan}>
        {/* LEFT — the work */}
        <div className="flex flex-col gap-3.5">
          <ReviewVerificationCard issueId={issueId} />
          <CodeCard issueId={issueId} />
          <PlanCard issueId={issueId} />
        </div>
        {/* RIGHT — the context */}
        <div className="flex flex-col gap-3.5">
          <CostCard issueId={issueId} />
          <WorkspaceCard issueId={issueId} />
          <AgentCard issueId={issueId} />
          <ActivityCard issueId={issueId} onOpenFull={() => setDigTab('activity')} />
        </div>
      </div>

      <IssueDigTabs issueId={issueId} active={digTab} onChange={setDigTab} />
    </div>
  )
}
