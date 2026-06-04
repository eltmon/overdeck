import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { usePlanningSummaryQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitCard } from './CockpitCard'

interface BeadTask {
  id: string
  name?: string
  title?: string
  status: 'open' | 'closed'
}
interface BeadsResponse {
  issueId: string
  tasks: BeadTask[]
}

/**
 * PlanCard — the plan at a glance: acceptance-criteria progress + the beads
 * list (sourced from the authoritative /api/issues/:id/beads endpoint, shared
 * with the Beads dig tab's cache). The full Plan DAG is deliberately NOT mounted
 * here — it lives in the vBRIEF dig tab. (Command Deck remodel S3.)
 */
export function PlanCard({ issueId }: { issueId: string }) {
  const planning = usePlanningSummaryQuery(issueId)
  const ac = planning.data?.acceptanceProgress

  const beadsQuery = useQuery<BeadsResponse>({
    queryKey: ['beads', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/beads`)
      if (!res.ok) throw new Error('Failed to fetch beads')
      return res.json() as Promise<BeadsResponse>
    },
    refetchInterval: 30_000,
  })
  const tasks = beadsQuery.data?.tasks ?? []
  const closed = tasks.filter((t) => t.status === 'closed').length
  const shown = tasks.slice(0, 8)
  const rest = tasks.length - shown.length

  return (
    <CockpitCard
      tone="review"
      title="Plan"
      right={
        <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          {tasks.length > 0 && <>{closed}/{tasks.length} beads</>}
          {ac && ac.total > 0 && <> · {ac.completed}/{ac.total} AC</>}
        </span>
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

      {tasks.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">
          {beadsQuery.isLoading ? 'Loading…' : 'No beads yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map((t) => {
            const done = t.status === 'closed'
            return (
              <div key={t.id} className="flex items-center gap-2.5 text-[12px]">
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-foreground" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={`min-w-0 flex-1 truncate ${done ? 'text-muted-foreground line-through' : 'text-foreground/90'}`}>
                  {t.title ?? t.name ?? t.id}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{t.id}</span>
              </div>
            )
          })}
          {rest > 0 && <div className="pl-6 text-[11px] text-muted-foreground">+ {rest} more beads</div>}
        </div>
      )}
    </CockpitCard>
  )
}
