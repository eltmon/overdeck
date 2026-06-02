import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { VBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/VBriefTab'
import { BeadsTab } from '../../CommandDeck/ZoneCOverviewTabs/BeadsTab'
import { PrDiffTab } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import { usePlanningQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import DrawerArtifactsPanel from '../../drawer/DrawerArtifactsPanel'
import { StatusHistoryTab } from './StatusHistoryTab'

export type DigTab =
  | 'activity'
  | 'discussions'
  | 'costs'
  | 'prd'
  | 'state'
  | 'vbrief'
  | 'beads'
  | 'diff'
  | 'artifacts'
  | 'history'

const TABS: { id: DigTab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'diff', label: 'PR Diff' },
  { id: 'vbrief', label: 'vBRIEF' },
  { id: 'beads', label: 'Beads' },
  { id: 'prd', label: 'PRD' },
  { id: 'state', label: 'STATE' },
  { id: 'costs', label: 'Costs' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'history', label: 'History' },
]

function MarkdownDigTab({ issueId, field }: { issueId: string; field: 'prd' | 'state' }) {
  const planning = usePlanningQuery(issueId, { enabled: true })
  return (
    <MarkdownTab
      body={planning.data?.[field]}
      isLoading={planning.isLoading}
      emptyLabel={`No ${field.toUpperCase()} document.`}
    />
  )
}

/**
 * IssueDigTabs — the DIG layer of the cockpit: a tab bar that lazily reveals the
 * deep views (full activity, discussions, diff, vBRIEF, beads, PRD/STATE,
 * costs, artifacts, status history). Controlled so the ActivityCard's "full
 * feed" can deep-link here. Nothing renders below the bar until a tab is opened,
 * keeping the cockpit short by default. (Command Deck remodel S3.)
 */
export function IssueDigTabs({
  issueId,
  active,
  onChange,
}: {
  issueId: string
  active: DigTab | null
  onChange: (tab: DigTab | null) => void
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 rounded-[6px] border border-dashed border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          dig
        </span>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(active === t.id ? null : t.id)}
            className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
              active === t.id
                ? 'border-border bg-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active && (
        <div className="mt-3 rounded-[18px] border border-border bg-card p-4">
          {active === 'activity' && <ActivityTab issueId={issueId} />}
          {active === 'discussions' && <DiscussionsTab issueId={issueId} />}
          {active === 'costs' && <CostsTab issueId={issueId} />}
          {active === 'prd' && <MarkdownDigTab issueId={issueId} field="prd" />}
          {active === 'state' && <MarkdownDigTab issueId={issueId} field="state" />}
          {active === 'vbrief' && <VBriefTab issueId={issueId} />}
          {active === 'beads' && <BeadsTab issueId={issueId} />}
          {active === 'diff' && <PrDiffTab issueId={issueId} />}
          {active === 'artifacts' && <DrawerArtifactsPanel issueId={issueId} />}
          {active === 'history' && <StatusHistoryTab issueId={issueId} />}
        </div>
      )}
    </div>
  )
}
