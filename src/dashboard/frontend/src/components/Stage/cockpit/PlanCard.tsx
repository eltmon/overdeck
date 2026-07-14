import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react'
import {
  usePlanningSummaryQuery,
  useWorkspacePlanQuery,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitCard } from './CockpitCard'

interface TaskTask {
  id: string
  name?: string
  title?: string
  status: 'open' | 'closed'
}
interface TasksResponse {
  issueId: string
  tasks: TaskTask[]
}

function tieredChipLabel(effective: boolean, source: string): string {
  const sourceLabel = source === 'issue-override' ? 'issue override' : source === 'plan-metadata' ? 'plan metadata' : 'global'
  return `tiered: ${effective ? 'on' : 'off'} (${sourceLabel})`
}

/**
 * PlanCard — the plan at a glance: acceptance-criteria progress + the tasks
 * list (sourced from the authoritative /api/issues/:id/tasks endpoint, shared
 * with the Tasks dig tab's cache). The full Plan DAG is deliberately NOT mounted
 * here — it lives in the vBRIEF dig tab. (Command Deck remodel S3.)
 */
export function PlanCard({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient()
  const planning = usePlanningSummaryQuery(issueId)
  const workspacePlan = useWorkspacePlanQuery(issueId)
  const ac = planning.data?.acceptanceProgress
  const tieredExecution = workspacePlan.data?.plan?.tieredExecution
  const tieredLabel = tieredExecution ? tieredChipLabel(tieredExecution.effective, tieredExecution.source) : 'tiered: (loading)'

  const updateTieredExecution = useMutation({
    mutationFn: async (override: 'on' | 'off' | null) => {
      const res = await fetch(`/api/workspaces/${issueId}/tiered-execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return res.json()
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['workspace-plan', issueId], updated)
    },
  })

  const tasksQuery = useQuery<TasksResponse>({
    queryKey: ['tasks', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/tasks`)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      return res.json() as Promise<TasksResponse>
    },
    refetchInterval: 30_000,
  })
  const tasks = tasksQuery.data?.tasks ?? []
  const closed = tasks.filter((t) => t.status === 'closed').length
  const shown = tasks.slice(0, 8)
  const rest = tasks.length - shown.length

  return (
    <CockpitCard
      tone="review"
      title="Plan"
      right={
        <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          {tasks.length > 0 && <>{closed}/{tasks.length} tasks</>}
          {ac && ac.total > 0 && <> · {ac.completed}/{ac.total} AC</>}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={tieredExecution?.override ?? 'inherit'}
          onChange={(e) => {
            const val = e.target.value
            updateTieredExecution.mutate(val === 'inherit' ? null : (val as 'on' | 'off'))
          }}
          disabled={updateTieredExecution.isPending}
          className="h-6 rounded-md border border-border bg-muted/20 px-2 font-mono text-[11px] text-muted-foreground disabled:opacity-50"
        >
          <option value="on">on</option>
          <option value="off">off</option>
          <option value="inherit">inherit</option>
        </select>
        <span className="font-mono text-[11px] text-muted-foreground">{tieredLabel}</span>
        <a
          href="https://github.com/eltmon/overdeck/blob/main/docs/TIERED-EXECUTION.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
          title="Tiered execution documentation"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

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
          {tasksQuery.isLoading ? 'Loading…' : 'No tasks yet.'}
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
          {rest > 0 && <div className="pl-6 text-[11px] text-muted-foreground">+ {rest} more tasks</div>}
        </div>
      )}
    </CockpitCard>
  )
}
