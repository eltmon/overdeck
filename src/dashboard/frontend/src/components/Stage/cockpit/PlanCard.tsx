import DrawerBeadsList from '../../drawer/DrawerBeadsList'
import { usePlanningSummaryQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitCard } from './CockpitCard'

/**
 * PlanCard — the plan at a glance: acceptance-criteria progress + the beads
 * list. The full Plan DAG is deliberately NOT mounted here (it used to eat
 * ~520px always-on); it lives in the vBRIEF dig tab. (Command Deck remodel S3.)
 */
export function PlanCard({ issueId }: { issueId: string }) {
  const planning = usePlanningSummaryQuery(issueId)
  const ac = planning.data?.acceptanceProgress

  return (
    <CockpitCard
      tone="review"
      title="Plan"
      right={
        ac && ac.total > 0 ? (
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            {ac.completed}/{ac.total} AC · {ac.percent}%
          </span>
        ) : undefined
      }
    >
      {ac && ac.total > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-signal-review transition-[width]"
            style={{ width: `${Math.max(2, ac.percent)}%` }}
          />
        </div>
      )}
      <DrawerBeadsList issueId={issueId} />
    </CockpitCard>
  )
}
