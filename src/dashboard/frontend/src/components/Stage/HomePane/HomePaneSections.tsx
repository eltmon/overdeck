import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { OverviewTab } from '../../CommandDeck/ZoneCOverviewTabs/OverviewTab'
import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import styles from '../stage.module.css'

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.collapsible}>
      <button
        type="button"
        className={styles.collapsibleHeader}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={14}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
        />
        {title}
      </button>
      {open && <div className={styles.collapsibleBody}>{children}</div>}
    </div>
  )
}

export interface HomePaneSectionsProps {
  issueId: string
}

/**
 * HomePaneSections — the HomePane lower detail area (PAN-1549). Collapsible
 * sections that re-home the tab bodies which do not get their own pane, so no
 * live content is orphaned when ProjectRightPaneTabs is deleted:
 *   Overview/Status → OverviewTab · Activity → ActivityTab ·
 *   Discussions → DiscussionsTab (D6) · Costs → CostsTab (D6).
 * Each renders the existing component unchanged.
 */
export function HomePaneSections({ issueId }: HomePaneSectionsProps) {
  return (
    <div className={styles.sections}>
      <CollapsibleSection title="Overview" defaultOpen>
        <OverviewTab issueId={issueId} />
      </CollapsibleSection>
      <CollapsibleSection title="Activity">
        <ActivityTab issueId={issueId} />
      </CollapsibleSection>
      <CollapsibleSection title="Discussions">
        <DiscussionsTab issueId={issueId} />
      </CollapsibleSection>
      <CollapsibleSection title="Costs">
        <CostsTab issueId={issueId} />
      </CollapsibleSection>
    </div>
  )
}
