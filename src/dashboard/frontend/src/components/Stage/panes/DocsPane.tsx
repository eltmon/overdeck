import { useState } from 'react'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import {
  usePlanningQuery,
  usePlanningSummaryQuery,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

type DocKey = 'prd' | 'state' | 'inference'

const DOC_TABS: { key: DocKey; label: string; empty: string }[] = [
  { key: 'prd', label: 'PRD', empty: 'No PRD recorded for this issue.' },
  { key: 'state', label: 'STATE', empty: 'No STATE recorded for this issue.' },
  { key: 'inference', label: 'INFERENCE', empty: 'No INFERENCE.md recorded for this issue.' },
]

/**
 * DocsPane — paneType='docs' (PAN-1549). A PRD / STATE / INFERENCE selector
 * feeding the existing MarkdownTab from the same planning query ZoneCOverview
 * uses. INFERENCE is hidden when no inference content exists. The pane's
 * `docFilePath` selects the initial doc.
 */
export function DocsPane({ pane, ctx }: PaneWrapperProps) {
  const issueId = ctx.workspaceId
  const summary = usePlanningSummaryQuery(issueId)
  const planning = usePlanningQuery(issueId)
  const hasInference = Boolean(summary.data?.hasInference)

  const tabs = DOC_TABS.filter((t) => t.key !== 'inference' || hasInference)
  const initial: DocKey =
    pane.docFilePath && tabs.some((t) => t.key === pane.docFilePath)
      ? (pane.docFilePath as DocKey)
      : 'prd'
  const [active, setActive] = useState<DocKey>(initial)
  // If INFERENCE was active but is no longer available, fall back to PRD.
  const activeKey = tabs.some((t) => t.key === active) ? active : 'prd'
  const activeTab = tabs.find((t) => t.key === activeKey)!

  return (
    <div className={styles.subPane}>
      <div className={styles.subTabs} role="tablist" aria-label="Docs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === activeKey}
            className={`${styles.subTab} ${t.key === activeKey ? styles.subTabActive : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.subBody}>
        <MarkdownTab
          body={planning.data?.[activeKey]}
          isLoading={planning.isLoading}
          emptyLabel={activeTab.empty}
        />
      </div>
    </div>
  )
}
